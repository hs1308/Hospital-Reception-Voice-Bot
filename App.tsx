
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { supabase } from './supabaseClient';
import { Patient, BotState, ActionLog as LogType } from './types';
import { SYSTEM_INSTRUCTION, TOOLS } from './constants';
import PulseOrb from './components/PulseOrb';
import ActionLog from './components/ActionLog';
import PatientSetup from './components/PatientSetup';
import { Mic, MicOff, LogOut, Activity, Calendar, Search, MapPin } from 'lucide-react';

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [botState, setBotState] = useState<BotState>('idle');
  const [logs, setLogs] = useState<LogType[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEmergency, setIsEmergency] = useState(false);

  // Refs for audio hardware
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  // Refs for conversation state
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isStartingRef = useRef(false);
  const hangupPendingRef = useRef(false);

  // Call Summary Tracking Refs
  const callStartTimeRef = useRef<Date | null>(null);
  const transcriptHistoryRef = useRef<{ role: 'user' | 'maya'; text: string }[]>([]);
  const currentTurnRef = useRef<{ user?: string; maya?: string }>({});

  const addLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    setLogs((prev) => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type },
      ...prev.slice(0, 49)
    ]);
  }, []);

  const saveCallSummary = async (techIssue: boolean = false) => {
    if (!callStartTimeRef.current || !patient) return;

    const endTime = new Date();
    const durationMs = endTime.getTime() - callStartTimeRef.current.getTime();
    const durationSeconds = Math.floor(durationMs / 1000);
    const durationString = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
    
    // Prepare conversation for AI summarization
    const fullTranscript = transcriptHistoryRef.current
      .map(entry => `${entry.role.toUpperCase()}: ${entry.text}`)
      .join('\n');

    let summaryText = "Call ended before significant conversation.";

    if (transcriptHistoryRef.current.length > 0) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Analyze this hospital call transcript and provide a brief summary including: 
          1. Why the user called.
          2. What the resolution was.
          3. Mention any technical issues if detected or if the call ended abruptly.
          
          Transcript:
          ${fullTranscript}
          
          ${techIssue ? 'NOTE: A technical socket error was reported during this call.' : ''}`,
          config: {
            systemInstruction: "You are a quality assurance auditor for a hospital. Keep summaries concise (max 3 sentences).",
          }
        });
        summaryText = response.text || "Summary generation failed.";
      } catch (e) {
        summaryText = "Technical failure during summary generation. Transcript available in debug logs.";
      }
    } else if (techIssue) {
      summaryText = "Technical issue prevented conversation from starting.";
    }

    try {
      await supabase.from('user_call_summary').insert([{
        user_number: patient.phone,
        user_name: patient.name,
        start_time: callStartTimeRef.current.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationString,
        call_summary: summaryText,
        tech_issue_detected: techIssue
      }]);
      console.log('Call summary saved successfully.');
    } catch (dbErr) {
      console.error('Failed to save call summary to database:', dbErr);
    }
  };

  const stopAssistant = useCallback((techIssue: boolean = false) => {
    // Save summary before cleaning up refs
    saveCallSummary(techIssue);
    
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch (e) {}
    }
    sourcesRef.current.clear();

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }

    setIsActive(false);
    setBotState('idle');
    isStartingRef.current = false;
    hangupPendingRef.current = false;
    callStartTimeRef.current = null;
    transcriptHistoryRef.current = [];
    addLog('Call completed.', 'info');
  }, [addLog, patient]);

  useEffect(() => {
    return () => stopAssistant();
  }, [stopAssistant]);

  const toolHandlers = {
    update_patient_name: async (args: { name: string }) => {
      if (!patient) return "ERROR: No patient session.";
      addLog(`Updating record for: ${args.name}`, 'tool');
      try {
        const { error } = await supabase
          .from('patients')
          .update({ name: args.name })
          .eq('phone', patient.phone);
        
        if (error) throw error;
        setPatient(prev => prev ? ({ ...prev, name: args.name }) : null);
        return "SUCCESS: Record updated. I will now refer to you as " + args.name;
      } catch (err: any) {
        return `ERROR: ${err.message}`;
      }
    },
    get_doctors: async () => {
      addLog('Fetching provider list...', 'tool');
      const { data, error } = await supabase.from('doctors').select('*');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_my_appointments: async () => {
      if (!patient) return "ERROR: No session.";
      addLog('Accessing your records...', 'tool');
      const { data, error } = await supabase
        .from('doctor_appointments')
        .select('id, appointment_time, status, doctors(name, specialty)')
        .eq('patient_phone', patient.phone)
        .eq('status', 'scheduled');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_available_slots: async (args: { doctor_id: string; start_date: string; days_to_check?: number }) => {
      const days = Math.min(args.days_to_check || 1, 7);
      addLog(`Checking next ${days} days...`, 'tool');
      const endDate = new Date(args.start_date);
      endDate.setDate(endDate.getDate() + days);
      const { data, error } = await supabase
        .from('doctor_slots')
        .select('id, start_time')
        .eq('doctor_id', args.doctor_id)
        .eq('is_available', true)
        .gte('start_time', `${args.start_date}T00:00:00Z`)
        .lte('start_time', `${endDate.toISOString().split('T')[0]}T23:59:59Z`)
        .order('start_time', { ascending: true })
        .limit(20);
      return error ? `ERROR: ${error.message}` : data;
    },
    book_appointment: async (args: { doctor_id: string; slot_id: string; time_string: string }) => {
      addLog(`Reserving slot for ${args.time_string}...`, 'tool');
      try {
        const { data: appt, error: apptErr } = await supabase.from('doctor_appointments').insert([{ 
          patient_phone: patient?.phone, doctor_id: args.doctor_id, appointment_time: args.time_string, status: 'scheduled' 
        }]).select().single();
        if (apptErr) throw apptErr;
        await supabase.from('doctor_slots').update({ is_available: false, booked_by_phone: patient?.phone, appointment_id: appt.id }).eq('id', args.slot_id);
        return `SUCCESS: Booked.`;
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    cancel_appointment: async (args: { appointment_id: string }) => {
      addLog(`Cancelling booking...`, 'tool');
      try {
        await supabase.from('doctor_appointments').update({ status: 'cancelled' }).eq('id', args.appointment_id);
        await supabase.from('doctor_slots').update({ is_available: true, booked_by_phone: null, appointment_id: null }).eq('appointment_id', args.appointment_id);
        return "SUCCESS: Booking cancelled.";
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    get_opd_timings: async (args: { department?: string }) => {
      addLog('Consulting department list...', 'tool');
      let query = supabase.from('opd_timings').select('*');
      if (args.department) query = query.ilike('department', `%${args.department}%`);
      const { data, error } = await query;
      return error ? `ERROR: ${error.message}` : data;
    },
    hang_up: async () => {
      addLog('Farewell pending...', 'info');
      hangupPendingRef.current = true;
      setTimeout(() => {
        if (hangupPendingRef.current) stopAssistant();
      }, 5000);
      return "SUCCESS: Hanging up after message.";
    }
  };

  const startAssistant = async () => {
    if (!patient || isStartingRef.current) return;
    
    isStartingRef.current = true;
    setError(null);
    setIsEmergency(false);
    transcriptHistoryRef.current = [];
    currentTurnRef.current = {};
    
    try {
      setIsActive(true);
      setBotState('processing');
      addLog('Waking Maya...', 'info');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            callStartTimeRef.current = new Date();
            setBotState('listening');
            addLog('Maya is ready.', 'info');
            
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Track Transcriptions for Summary
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentTurnRef.current.maya = (currentTurnRef.current.maya || '') + text;
              if (text.toLowerCase().includes('emergency')) setIsEmergency(true);
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentTurnRef.current.user = (currentTurnRef.current.user || '') + text;
            }

            if (message.serverContent?.turnComplete) {
              if (currentTurnRef.current.user) {
                transcriptHistoryRef.current.push({ role: 'user', text: currentTurnRef.current.user });
              }
              if (currentTurnRef.current.maya) {
                transcriptHistoryRef.current.push({ role: 'maya', text: currentTurnRef.current.maya });
              }
              currentTurnRef.current = {};
            }

            const modelParts = message.serverContent?.modelTurn?.parts;
            if (modelParts?.[0]?.inlineData?.data && outputAudioContextRef.current) {
              setBotState('speaking');
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(modelParts[0].inlineData.data), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) {
                  setBotState('listening');
                  if (hangupPendingRef.current) {
                    addLog('Farewell complete. Disconnecting.', 'info');
                    stopAssistant();
                  }
                }
              };

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                const result = await (toolHandlers as any)[fc.name]?.(fc.args);
                sessionPromise.then(s => s.sendToolResponse({ 
                  functionResponses: { id: fc.id, name: fc.name, response: { result } } 
                }));
              }
            }
          },
          onerror: (e) => {
            setError('Maya is experiencing high traffic. Please try again.');
            stopAssistant(true);
          },
          onclose: (e) => {
            stopAssistant();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nPatient Name: ${patient.name}\nPatient Phone: ${patient.phone}`,
          tools: [{ functionDeclarations: TOOLS }],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      setError(`Hardware link failed: ${err.message}`);
      stopAssistant(true);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-1000 ${isEmergency ? 'bg-red-50' : 'bg-slate-50'}`}>
      <nav className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className={`${isEmergency ? 'bg-red-600' : 'bg-indigo-600'} p-2 rounded-xl`}>
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-black text-lg text-slate-900 leading-none">Maya AI</h1>
            <p className="text-[10px] text-indigo-600 font-black uppercase tracking-widest mt-1">HSR Sector 7</p>
          </div>
        </div>
        {patient && (
          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold text-slate-500 hidden sm:inline-block">Logged in: <span className="text-slate-900">{patient.name}</span></span>
            <button onClick={() => { setPatient(null); stopAssistant(); }} className="p-2 hover:bg-slate-100 rounded-lg">
              <LogOut className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        )}
      </nav>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col relative overflow-y-auto">
          {!patient ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <PatientSetup onComplete={setPatient} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-4xl mx-auto w-full">
              {!isActive ? (
                <div className="w-full space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-4xl font-black text-slate-900">Hello, <span className="text-indigo-600">{patient.name}</span>.</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm text-left group hover:border-indigo-200 transition-all cursor-pointer">
                      <Calendar className="w-8 h-8 text-blue-500 mb-4" />
                      <h3 className="font-bold text-slate-800">Booking</h3>
                      <p className="text-xs text-slate-500 mt-2">Specialist appointments.</p>
                    </div>
                    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm text-left group hover:border-emerald-200 transition-all cursor-pointer">
                      <Search className="w-8 h-8 text-emerald-500 mb-4" />
                      <h3 className="font-bold text-slate-800">Timings</h3>
                      <p className="text-xs text-slate-500 mt-2">OPD schedule info.</p>
                    </div>
                    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm text-left group hover:border-orange-200 transition-all cursor-pointer">
                      <MapPin className="w-8 h-8 text-orange-500 mb-4" />
                      <h3 className="font-bold text-slate-800">Locate</h3>
                      <p className="text-xs text-slate-500 mt-2">Ward & Lab directions.</p>
                    </div>
                  </div>
                  <button onClick={startAssistant} className="inline-flex items-center justify-center px-10 py-5 font-black text-lg text-white bg-slate-900 rounded-[2rem] hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-100/50">
                    <Mic className="w-6 h-6 mr-3" />
                    Connect to Maya
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full space-y-12 w-full">
                  <PulseOrb state={botState} isEmergency={isEmergency} />
                  <div className="w-full max-w-lg space-y-8">
                    <div className="bg-white px-8 py-6 rounded-[2.5rem] border border-slate-200 shadow-2xl flex items-center space-x-6">
                      <div className={`w-3 h-3 rounded-full animate-pulse ${isEmergency ? 'bg-red-600' : 'bg-indigo-500'}`} />
                      <p className="text-lg text-slate-800 font-bold">
                        {botState === 'listening' ? "Maya is listening..." : botState === 'speaking' ? "Maya is responding..." : "Processing..."}
                      </p>
                    </div>
                    {error && <p className="text-rose-600 font-bold text-sm bg-rose-50 p-4 rounded-2xl border border-rose-100">{error}</p>}
                    <button onClick={() => stopAssistant()} className="bg-slate-100 text-slate-600 px-8 py-4 rounded-full font-black text-sm hover:bg-rose-50 hover:text-rose-600 transition-all">
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="hidden lg:block w-[340px] bg-white border-l border-slate-200">
          <ActionLog logs={logs} />
        </aside>
      </main>
    </div>
  );
};

export default App;
