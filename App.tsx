
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

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);

  const addLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    setLogs((prev) => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type },
      ...prev.slice(0, 49)
    ]);
  }, []);

  const stopAssistant = useCallback(() => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close().catch(console.error);
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close().catch(console.error);
    }
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    setIsActive(false);
    setBotState('idle');
    addLog('Assistant session ended.', 'info');
  }, [addLog]);

  useEffect(() => {
    return () => stopAssistant();
  }, [stopAssistant]);

  const toolHandlers = {
    get_doctors: async () => {
      addLog('Consulting Physician Registry...', 'tool');
      const { data, error } = await supabase.from('doctors').select('*');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_my_appointments: async () => {
      if (!patient) return "ERROR: No patient identified.";
      addLog('Retrieving patient history...', 'tool');
      const { data, error } = await supabase
        .from('doctor_appointments')
        .select('id, appointment_time, status, doctors(name, specialty)')
        .eq('patient_phone', patient.phone)
        .order('appointment_time', { ascending: false });
      return error ? `ERROR: ${error.message}` : data;
    },
    get_available_slots: async (args: { doctor_id: string; date: string }) => {
      addLog(`Searching doctor slots for ${args.date}...`, 'tool');
      const { data, error } = await supabase
        .from('doctor_slots')
        .select('id, start_time')
        .eq('doctor_id', args.doctor_id)
        .eq('is_available', true)
        .gte('start_time', `${args.date}T00:00:00Z`)
        .lte('start_time', `${args.date}T23:59:59Z`)
        .order('start_time', { ascending: true });
      return error ? `ERROR: ${error.message}` : data;
    },
    book_appointment: async (args: { doctor_id: string; slot_id: string; time_string: string }) => {
      addLog(`Processing Doctor Booking: ${args.time_string}...`, 'tool');
      try {
        if (!patient) throw new Error('Patient ID missing.');
        const { data: slot } = await supabase.from('doctor_slots').select('start_time').eq('id', args.slot_id).single();
        const { data: appt, error: apptErr } = await supabase
          .from('doctor_appointments')
          .insert([{ patient_phone: patient.phone, doctor_id: args.doctor_id, appointment_time: slot?.start_time, status: 'scheduled' }])
          .select().single();
        if (apptErr) throw apptErr;
        await supabase.from('doctor_slots').update({ is_available: false, booked_by_phone: patient.phone, appointment_id: appt.id }).eq('id', args.slot_id);
        return `SUCCESS: Doctor visit confirmed for ${args.time_string}.`;
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    get_lab_info: async () => {
      addLog('Syncing Lab Test Prices...', 'tool');
      const { data, error } = await supabase.from('labs').select('*');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_lab_slots: async (args: { lab_id: string; date: string }) => {
      addLog(`Checking Lab Availability: ${args.date}...`, 'tool');
      const { data, error } = await supabase
        .from('lab_slots')
        .select('id, slot_time')
        .eq('lab_id', args.lab_id)
        .eq('is_available', true)
        .gte('slot_time', `${args.date}T00:00:00Z`)
        .lte('slot_time', `${args.date}T23:59:59Z`)
        .order('slot_time', { ascending: true });
      return error ? `ERROR: ${error.message}` : data;
    },
    book_lab_test: async (args: { lab_id: string; slot_id: string; time_string: string }) => {
      addLog(`Processing Lab Booking: ${args.time_string}...`, 'tool');
      try {
        if (!patient) throw new Error('Patient ID missing.');
        const { data: slot } = await supabase.from('lab_slots').select('slot_time').eq('id', args.slot_id).single();
        const { data: appt, error: apptErr } = await supabase
          .from('lab_appointments')
          .insert([{ patient_phone: patient.phone, lab_id: args.lab_id, appointment_time: slot?.slot_time, status: 'scheduled' }])
          .select().single();
        if (apptErr) throw apptErr;
        await supabase.from('lab_slots').update({ is_available: false, booked_by_phone: patient.phone, appointment_id: appt.id }).eq('id', args.slot_id);
        return `SUCCESS: Lab test scheduled for ${args.time_string}.`;
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    get_opd_timings: async (args: { department?: string }) => {
      addLog('Consulting OPD Schedule...', 'tool');
      let query = supabase.from('opd_timings').select('*');
      if (args.department) query = query.ilike('department', `%${args.department}%`);
      const { data, error } = await query;
      return error ? `ERROR: ${error.message}` : data;
    }
  };

  const startAssistant = async () => {
    if (!patient) return;
    setError(null);
    setIsEmergency(false);
    
    try {
      setIsActive(true);
      setBotState('processing');
      addLog('Initializing Voice Link...', 'info');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      await inCtx.resume();
      await outCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog('Microphone connected.', 'info');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setBotState('listening');
            addLog('Maya is online.', 'info');
            
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = { 
                data: encode(new Uint8Array(int16.buffer)), 
                mimeType: 'audio/pcm;rate=16000' 
              };
              
              sessionPromise.then(s => {
                if (s) s.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Use transcription updates to transition out of 'listening' faster
            if (message.serverContent?.outputTranscription) {
              setBotState('processing');
              const text = message.serverContent.outputTranscription.text?.toLowerCase();
              if (text && (text.includes('emergency') || text.includes('102') || text.includes('er in sector 3'))) {
                setIsEmergency(true);
              }
            } else if (message.serverContent?.inputTranscription) {
              // Bot is hearing user, keep it in listening or processing state
              setBotState('listening');
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setBotState('speaking');
              const ctx = outputAudioContextRef.current;
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) {
                  // Wait for turnComplete or more model audio
                }
              };

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.toolCall && message.toolCall.functionCalls) {
              setBotState('processing');
              for (const fc of message.toolCall.functionCalls) {
                if (!fc.name) continue;
                const handler = (toolHandlers as any)[fc.name];
                if (handler) {
                  const result = await handler(fc.args);
                  sessionPromise.then(s => {
                    if (s) s.sendToolResponse({ 
                      functionResponses: [{ id: fc.id || '', name: fc.name || '', response: { result } }] 
                    });
                  });
                }
              }
            }

            // Signal end of model's turn to go back to listening
            if (message.serverContent?.turnComplete) {
              if (sourcesRef.current.size === 0) {
                setBotState('listening');
              }
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setBotState('listening');
            }
          },
          onerror: (e) => {
            console.error('Gemini Live Error:', e);
            setError('Maya is having trouble connecting right now. Please try again.');
            stopAssistant();
          },
          onclose: () => {
            stopAssistant();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nCONTEXT:\nPatient Name: ${patient.name}\nPatient Phone: ${patient.phone}\n\nIMPORTANT: Be concise and respond immediately.`,
          tools: [{ functionDeclarations: TOOLS }],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: 'Zephyr' } 
            } 
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Activation Failed:', err);
      setError(`Activation Failed: ${err.message}`);
      setIsActive(false);
      stopAssistant();
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-1000 ${isEmergency ? 'bg-red-50' : 'bg-slate-50'}`}>
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <div className={`${isEmergency ? 'bg-red-600' : 'bg-indigo-600'} p-2.5 rounded-2xl shadow-xl shadow-indigo-100`}>
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-black text-2xl text-slate-900 tracking-tight leading-none">Maya</h1>
            <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest mt-1">HSR Layout • Front Desk</p>
          </div>
        </div>
        {patient && (
          <div className="flex items-center space-x-6">
            <div className="hidden lg:flex flex-col items-end border-r border-slate-100 pr-6">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Verified Record</span>
              <p className="text-sm font-bold text-slate-800">{patient.name}</p>
            </div>
            <button onClick={() => { setPatient(null); stopAssistant(); }} className="p-3 hover:bg-slate-100 rounded-xl text-slate-400 group transition-all">
              <LogOut className="w-5 h-5 group-hover:text-rose-500" />
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
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-5xl mx-auto w-full">
              {!isActive ? (
                <div className="w-full space-y-12 animate-in fade-in duration-700">
                  <div className="space-y-6">
                    <div className="inline-flex items-center space-x-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border border-indigo-100">
                      <Activity className="w-4 h-4" />
                      <span>Live Sync Active</span>
                    </div>
                    <h2 className="text-6xl font-black text-slate-900 leading-[1.1] tracking-tight">
                      Hospital Front Desk, <br/>
                      <span className="text-indigo-600 italic">powered by Maya</span>.
                    </h2>
                    <p className="text-xl text-slate-500 max-w-2xl mx-auto font-medium leading-relaxed">
                      Manage appointments, check OPD hours, or get laboratory instructions for City Health Hospital.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                      { icon: <Calendar className="text-blue-500" />, title: 'Doctor Visits', desc: 'Sync with physician slots' },
                      { icon: <Search className="text-emerald-500" />, title: 'Lab Tests', desc: 'Schedule scans and bloodwork' },
                      { icon: <MapPin className="text-orange-500" />, title: 'Sector 7 Office', desc: 'Direct HSR Layout coverage' }
                    ].map((feat, i) => (
                      <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm text-left">
                        <div className="mb-6 bg-slate-50 w-12 h-12 rounded-2xl flex items-center justify-center">{feat.icon}</div>
                        <h3 className="font-black text-slate-800 mb-2 text-lg">{feat.title}</h3>
                        <p className="text-sm text-slate-500 leading-relaxed">{feat.desc}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={startAssistant} className="inline-flex items-center justify-center px-12 py-6 font-black text-lg text-white bg-slate-900 rounded-[2rem] hover:bg-indigo-600 transition-all shadow-2xl">
                    <Mic className="w-6 h-6 mr-4" />
                    Speak with Maya
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full space-y-20 w-full py-12">
                  <PulseOrb state={botState} isEmergency={isEmergency} />
                  <div className="w-full max-w-xl space-y-10">
                    <div className="bg-white/80 backdrop-blur-2xl px-10 py-8 rounded-[3rem] border border-slate-200 shadow-2xl flex items-center space-x-6">
                      <div className={`w-4 h-4 rounded-full animate-ping ${isEmergency ? 'bg-red-600' : botState === 'speaking' ? 'bg-emerald-500' : botState === 'processing' ? 'bg-amber-500' : 'bg-indigo-500'}`} />
                      <p className="text-xl text-slate-800 font-bold">
                        {isEmergency ? "EMERGENCY TRIAGE" : botState === 'listening' ? "Maya is listening..." : botState === 'processing' ? "Maya is thinking..." : "Maya is responding..."}
                      </p>
                    </div>
                    {error && (
                      <div className="p-6 bg-rose-50 border border-rose-100 rounded-[2rem] text-rose-600 font-bold max-w-md animate-in fade-in slide-in-from-top-4">
                        {error}
                      </div>
                    )}
                    <button onClick={stopAssistant} className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-100 px-12 py-5 rounded-[2rem] font-black shadow-lg mx-auto flex items-center transition-colors">
                      <MicOff className="w-5 h-5 mr-4" />
                      End Call
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="hidden xl:block w-[400px] bg-white border-l border-slate-200 shadow-2xl overflow-hidden">
          <ActionLog logs={logs} />
        </aside>
      </main>
      <footer className="bg-white border-t border-slate-100 py-4 px-10 flex justify-between items-center text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">
        <span>City Health Hospital • HSR Layout</span>
        <div className="flex items-center space-x-3 text-rose-500">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          </span>
          <span>ER Line: 102</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
