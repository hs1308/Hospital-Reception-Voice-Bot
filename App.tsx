
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
  const heartbeatIntervalRef = useRef<number | null>(null);

  const addLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    setLogs((prev) => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type },
      ...prev.slice(0, 49)
    ]);
  }, []);

  const logTechnicalEvent = async (event: string, metadata: any = {}) => {
    console.log(`[MAYA TECH] ${event}`, metadata);
    try {
      await supabase.from('maya_debug_logs').insert([{
        event,
        metadata,
        patient_phone: patient?.phone || 'unknown',
        timestamp: new Date().toISOString()
      }]);
    } catch (e) {}
  };

  const stopAssistant = useCallback(() => {
    logTechnicalEvent('Session Shutdown');
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {});
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {});
    }
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    setIsActive(false);
    setBotState('idle');
    addLog('Call disconnected.', 'info');
  }, [addLog, patient]);

  useEffect(() => {
    return () => stopAssistant();
  }, [stopAssistant]);

  const toolHandlers = {
    get_doctors: async () => {
      addLog('Accessing Provider Database...', 'tool');
      const { data, error } = await supabase.from('doctors').select('*');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_my_appointments: async () => {
      if (!patient) return "ERROR: No patient identified.";
      addLog('Retrieving your schedule...', 'tool');
      const { data, error } = await supabase
        .from('doctor_appointments')
        .select('id, appointment_time, status, doctors(name, specialty)')
        .eq('patient_phone', patient.phone)
        .eq('status', 'scheduled');
      return error ? `ERROR: ${error.message}` : data;
    },
    get_available_slots: async (args: { doctor_id: string; date: string }) => {
      addLog(`Querying slots for ${args.date}...`, 'tool');
      const { data, error } = await supabase
        .from('doctor_slots')
        .select('id, start_time')
        .eq('doctor_id', args.doctor_id)
        .eq('is_available', true)
        .gte('start_time', `${args.date}T00:00:00Z`)
        .lte('start_time', `${args.date}T23:59:59Z`)
        .order('start_time', { ascending: true });
      
      if (data?.length === 0) {
        logTechnicalEvent('No Slots Found', { doctor: args.doctor_id, date: args.date });
      }
      return error ? `ERROR: ${error.message}` : data;
    },
    book_appointment: async (args: { doctor_id: string; slot_id: string; time_string: string }) => {
      addLog(`Confirming booking for ${args.time_string}...`, 'tool');
      try {
        const { data: appt, error: apptErr } = await supabase
          .from('doctor_appointments')
          .insert([{ 
            patient_phone: patient?.phone, 
            doctor_id: args.doctor_id, 
            appointment_time: args.time_string, 
            status: 'scheduled' 
          }])
          .select().single();
        if (apptErr) throw apptErr;
        await supabase.from('doctor_slots').update({ 
          is_available: false, 
          booked_by_phone: patient?.phone, 
          appointment_id: appt.id 
        }).eq('id', args.slot_id);
        return `SUCCESS: Appointment confirmed.`;
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    cancel_appointment: async (args: { appointment_id: string, type: string }) => {
      addLog(`Cancelling appointment ${args.appointment_id}...`, 'tool');
      try {
        await supabase.from('doctor_appointments').update({ status: 'cancelled' }).eq('id', args.appointment_id);
        await supabase.from('doctor_slots').update({ is_available: true, booked_by_phone: null, appointment_id: null }).eq('appointment_id', args.appointment_id);
        return "SUCCESS: Appointment cancelled.";
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    reschedule_appointment: async (args: { appointment_id: string, new_slot_id: string }) => {
      addLog(`Rescheduling to new slot...`, 'tool');
      try {
        const { data: slot } = await supabase.from('doctor_slots').select('start_time').eq('id', args.new_slot_id).single();
        await supabase.from('doctor_slots').update({ is_available: true, booked_by_phone: null, appointment_id: null }).eq('appointment_id', args.appointment_id);
        await supabase.from('doctor_appointments').update({ appointment_time: slot.start_time }).eq('id', args.appointment_id);
        await supabase.from('doctor_slots').update({ is_available: false, booked_by_phone: patient?.phone, appointment_id: args.appointment_id }).eq('id', args.new_slot_id);
        return "SUCCESS: Rescheduled.";
      } catch (err: any) { return `ERROR: ${err.message}`; }
    },
    get_opd_timings: async (args: { department?: string }) => {
      addLog('Consulting department schedule...', 'tool');
      let query = supabase.from('opd_timings').select('*');
      if (args.department) query = query.ilike('department', `%${args.department}%`);
      const { data, error } = await query;
      return error ? `ERROR: ${error.message}` : data;
    },
    hang_up: async () => {
      addLog('Maya is hanging up. Goodbye!', 'info');
      logTechnicalEvent('Hang Up Requested');
      setTimeout(() => stopAssistant(), 1000);
      return "SUCCESS: Hanging up.";
    }
  };

  const startAssistant = async () => {
    if (!patient) return;
    setError(null);
    setIsEmergency(false);
    
    try {
      setIsActive(true);
      setBotState('processing');
      addLog('Starting Voice Session...', 'info');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      const resumeAudio = async () => {
        if (inCtx.state === 'suspended') await inCtx.resume();
        if (outCtx.state === 'suspended') await outCtx.resume();
      };
      await resumeAudio();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setBotState('listening');
            addLog('Maya is online.', 'info');
            logTechnicalEvent('Connection Open');
            
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            
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

            // SILENT HEARTBEAT: Prevent server drop during long silences
            heartbeatIntervalRef.current = window.setInterval(() => {
              resumeAudio();
              sessionPromise.then(s => {
                s.sendRealtimeInput({
                  media: {
                    data: encode(new Uint8Array(100)), // Tiny silent packet
                    mimeType: 'audio/pcm;rate=16000'
                  }
                });
              });
              logTechnicalEvent('Heartbeat');
            }, 20000);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text.toLowerCase();
              if (text.includes('emergency') || text.includes('102')) setIsEmergency(true);
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
              source.onended = () => sourcesRef.current.delete(source);
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

            if (message.serverContent?.turnComplete && sourcesRef.current.size === 0) {
              setBotState('listening');
            }
          },
          onerror: (e) => {
            logTechnicalEvent('Error', { msg: e.message });
            setError('Connection glitch. Try speaking again.');
            stopAssistant();
          },
          onclose: (e) => {
            logTechnicalEvent('Close', { code: e.code, reason: e.reason });
            stopAssistant();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nPatient: ${patient.name} (${patient.phone})`,
          tools: [{ functionDeclarations: TOOLS }],
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      setError(`Maya couldn't start: ${err.message}`);
      setIsActive(false);
      stopAssistant();
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-1000 ${isEmergency ? 'bg-red-50' : 'bg-slate-50'}`}>
      <nav className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <div className={`${isEmergency ? 'bg-red-600' : 'bg-indigo-600'} p-2 rounded-xl`}>
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl text-slate-900">Maya Front Desk</h1>
            <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">HSR Layout • Sector 7</p>
          </div>
        </div>
        {patient && (
          <button onClick={() => { setPatient(null); stopAssistant(); }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <LogOut className="w-5 h-5 text-slate-400" />
          </button>
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
                  <h2 className="text-5xl font-black text-slate-900 leading-tight">
                    Welcome, <span className="text-indigo-600">{patient.name}</span>.
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm text-left">
                      <Calendar className="w-8 h-8 text-blue-500 mb-3" />
                      <h3 className="font-bold text-slate-800">Appointments</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">Book, reschedule or cancel in seconds.</p>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm text-left">
                      <Search className="w-8 h-8 text-emerald-500 mb-3" />
                      <h3 className="font-bold text-slate-800">OPD Hours</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">Check department timings in real-time.</p>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm text-left">
                      <MapPin className="w-8 h-8 text-orange-500 mb-3" />
                      <h3 className="font-bold text-slate-800">Hospital Map</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">Find any ward or lab in Sector 7.</p>
                    </div>
                  </div>
                  <button onClick={startAssistant} className="inline-flex items-center justify-center px-10 py-5 font-black text-lg text-white bg-slate-900 rounded-[2rem] hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-100">
                    <Mic className="w-6 h-6 mr-3" />
                    Speak to Maya
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full space-y-12 w-full py-12">
                  <PulseOrb state={botState} isEmergency={isEmergency} />
                  <div className="w-full max-w-xl">
                    <div className="bg-white px-8 py-6 rounded-[2.5rem] border border-slate-200 shadow-2xl flex items-center space-x-6">
                      <div className={`w-3 h-3 rounded-full animate-pulse ${isEmergency ? 'bg-red-600' : 'bg-indigo-500'}`} />
                      <p className="text-lg text-slate-800 font-bold">
                        {botState === 'listening' ? "Maya is listening..." : botState === 'speaking' ? "Maya is talking..." : "Maya is processing..."}
                      </p>
                    </div>
                    {error && <p className="mt-4 text-rose-600 font-bold text-sm bg-rose-50 p-3 rounded-xl">{error}</p>}
                    <button onClick={stopAssistant} className="mt-8 bg-rose-50 text-rose-600 px-8 py-4 rounded-full font-bold border border-rose-100 hover:bg-rose-100 transition-all">
                      End Session
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="hidden lg:block w-[350px] bg-white border-l border-slate-200">
          <ActionLog logs={logs} />
        </aside>
      </main>
    </div>
  );
};

export default App;
