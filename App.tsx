
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Patient, Appointment, BotState, ActionLog as LogType, DebugLog, ChatSummary } from './types';
import { SYSTEM_INSTRUCTION, TOOLS } from './constants';
import PatientSetup from './components/PatientSetup';
import PulseOrb from './components/PulseOrb';
import ActionLog from './components/ActionLog';
import { 
  Calendar, Clock, User, 
  Stethoscope, Phone, LogOut, 
  Mic, HeartPulse, ShieldCheck,
  ChevronRight, AlertCircle, CheckCircle2,
  Activity, WifiOff, Volume2, Trash2
} from 'lucide-react';

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const App: React.FC = () => {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [botState, setBotState] = useState<BotState>('idle');
  const [actionLogs, setActionLogs] = useState<LogType[]>([]);
  const [isMayaActive, setIsMayaActive] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyzerRef = useRef<AnalyserNode | null>(null);

  const persistLog = useCallback(async (message: string, type: 'tool' | 'info' | 'error', patientId?: string) => {
    if (!isSupabaseConfigured()) return;
    try {
      await supabase.from('maya_debug_logs').insert([{
        patient_id: patientId,
        message,
        type,
        timestamp: new Date().toISOString()
      }]);
    } catch (e) { console.error(e); }
  }, []);

  const addActionLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    const newLog: LogType = { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type };
    setActionLogs(prev => [newLog, ...prev.slice(0, 15)]);
    persistLog(message, type, patient?.id);
  }, [patient, persistLog]);

  const fetchAppointments = useCallback(async (patientId: string) => {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .order('appointment_time', { ascending: true });
    if (!error && data) setAppointments(data);
  }, []);

  const rescheduleAppointment = async (id: string, newTime: string) => {
    const { data, error } = await supabase
      .from('appointments')
      .update({ appointment_time: newTime })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      addActionLog(`Reschedule failed: ${error.message}`, 'error');
      return "Error updating appointment: " + error.message;
    }

    setAppointments(prev => prev.map(a => a.id === id ? data : a));
    addActionLog(`Rescheduled appointment ${id} to ${new Date(newTime).toLocaleString()}`, 'tool');
    return "Appointment successfully moved to " + new Date(newTime).toLocaleString();
  };

  const cancelAppointment = async (id: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (error) {
      addActionLog(`Cancellation failed: ${error.message}`, 'error');
      return "Error cancelling: " + error.message;
    }

    setAppointments(prev => prev.filter(a => a.id !== id));
    addActionLog(`Cancelled appointment ${id}`, 'tool');
    return "Appointment has been successfully cancelled.";
  };

  const bookAppointment = async (details: Partial<Appointment>) => {
    if (!patient) return "Error: No patient identified";
    const newAppointment = {
      patient_id: patient.id,
      department: details.department || 'General Medicine',
      doctor_name: details.doctor_name || 'Dr. Smith',
      appointment_time: details.appointment_time || new Date(Date.now() + 86400000).toISOString(),
      reason: details.reason || 'Routine Checkup',
      status: 'scheduled'
    };

    const { data, error } = await supabase.from('appointments').insert([newAppointment]).select().single();
    if (error) return "Booking failed: " + error.message;

    setAppointments(prev => [...prev, data].sort((a,b) => a.appointment_time.localeCompare(b.appointment_time)));
    addActionLog(`Booked new appointment for ${data.department}`, 'tool');
    return `Confirmed: ${data.department} at ${new Date(data.appointment_time).toLocaleString()}`;
  };

  const generateAndSaveSummary = async () => {
    if (!patient || !sessionStartTime) return;
    const transcript = actionLogs.filter(l => l.timestamp.getTime() > sessionStartTime).map(l => l.message).join('. ');
    if (!transcript) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Summarize this interaction (max 15 words): ${transcript}`
      });
      await supabase.from('user_chat_summaries').insert([{
        patient_id: patient.id,
        summary: response.text || "Routine session",
        duration_seconds: Math.floor((Date.now() - sessionStartTime) / 1000),
        timestamp: new Date().toISOString()
      }]);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (patient) fetchAppointments(patient.id);
  }, [patient, fetchAppointments]);

  useEffect(() => {
    let animationFrame: number;
    const updateNoise = () => {
      if (analyzerRef.current) {
        const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getByteFrequencyData(dataArray);
        setNoiseLevel(dataArray.reduce((a, b) => a + b) / dataArray.length);
      }
      animationFrame = requestAnimationFrame(updateNoise);
    };
    updateNoise();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const stopMaya = useCallback(async () => {
    setBotState('idle');
    setIsMayaActive(false);
    generateAndSaveSummary();
    setSessionStartTime(null);
    if (sessionRef.current) try { await sessionRef.current.close(); } catch(e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    addActionLog('Maya session ended', 'info');
  }, [addActionLog]);

  const startMaya = async () => {
    if (isMayaActive) return;
    setIsMayaActive(true);
    setBotState('initiating');
    setSessionStartTime(Date.now());
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setBotState('listening');
            const source = inCtx.createMediaStreamSource(stream);
            const analyzer = inCtx.createAnalyser();
            analyzer.fftSize = 256;
            source.connect(analyzer);
            analyzerRef.current = analyzer;

            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setBotState('speaking');
              const buffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outCtx.destination);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setBotState('listening');
              };
              const startTime = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourcesRef.current.add(source);
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                let result: any = "OK";
                if (fc.name === 'book_appointment') result = await bookAppointment(fc.args);
                else if (fc.name === 'reschedule_appointment') result = await rescheduleAppointment(fc.args.appointment_id, fc.args.new_appointment_time);
                else if (fc.name === 'cancel_appointment') result = await cancelAppointment(fc.args.appointment_id);
                else if (fc.name === 'hang_up') stopMaya();
                else if (fc.name === 'get_patient_appointments') result = appointments.map(a => `[ID: ${a.id}] ${a.department} w/ ${a.doctor_name} on ${new Date(a.appointment_time).toLocaleString()}`).join('\n');
                
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
              }
            }
          },
          onerror: (e) => { console.error(e); stopMaya(); },
          onclose: () => stopMaya()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nPatient: ${patient?.name}\nAppointments: ${JSON.stringify(appointments)}`,
          tools: [{ functionDeclarations: TOOLS }]
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { stopMaya(); }
  };

  if (!patient) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><PatientSetup onComplete={setPatient} /></div>;

  return (
    <div className="min-h-screen bg-white flex flex-col md:flex-row overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        {!isSupabaseConfigured() && <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-center space-x-2 text-xs font-black uppercase tracking-widest z-50"><WifiOff className="w-4 h-4" /><span>Database Keys Missing</span></div>}

        <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-30">
          <div className="flex items-center space-x-4">
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg"><HeartPulse className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-xl font-black text-slate-900 leading-none">Nurse Maya</h1><p className="text-xs font-bold text-slate-400 mt-1 uppercase">City Reception</p></div>
          </div>
          <button onClick={() => setPatient(null)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:text-red-500 transition-all"><LogOut className="w-5 h-5" /></button>
        </header>

        <div className="p-8 max-w-5xl mx-auto w-full space-y-12">
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-slate-50 p-6 rounded-[2rem] flex items-center space-x-4 border border-slate-100">
              <div className="bg-white p-3 rounded-2xl text-indigo-600 shadow-sm"><Calendar className="w-6 h-6" /></div>
              <div><p className="text-[10px] font-black text-slate-400 uppercase">Active Bookings</p><p className="text-2xl font-black text-slate-900">{appointments.length}</p></div>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-lg font-black text-slate-900 px-2">Scheduled Visits</h2>
            <div className="space-y-4">
              {appointments.length === 0 ? <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-12 text-center text-slate-400 font-bold">No upcoming appointments.</div> : 
                appointments.map(app => (
                  <div key={app.id} className="bg-white border border-slate-100 p-6 rounded-[2rem] flex items-center justify-between group hover:border-indigo-200 hover:shadow-xl transition-all">
                    <div className="flex items-center space-x-6">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-indigo-50 flex items-center justify-center text-indigo-600"><User className="w-8 h-8" /></div>
                      <div>
                        <h4 className="font-black text-slate-900 text-lg">{app.doctor_name}</h4>
                        <p className="text-xs text-slate-400 uppercase font-black">{app.department} • {new Date(app.appointment_time).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>
      </div>

      <aside className="w-full md:w-[400px] border-l border-slate-100 bg-white flex flex-col">
        <div className="p-8 flex-1 flex flex-col items-center justify-center space-y-12">
          <div className="w-full px-4 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400"><span><Volume2 className="w-3 h-3 inline mr-1" /> Mic Noise</span><span className={noiseLevel > 60 ? 'text-rose-500' : 'text-emerald-500'}>{noiseLevel > 60 ? 'High' : 'Normal'}</span></div>
            <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full transition-all duration-300 ${noiseLevel > 60 ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(noiseLevel, 100)}%` }} /></div>
          </div>

          {!isMayaActive ? (
            <div className="text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="w-48 h-48 rounded-[3.5rem] bg-slate-50 flex items-center justify-center border-2 border-dashed border-slate-200 mx-auto"><Mic className="w-16 h-16 text-slate-300" /></div>
              <h3 className="text-2xl font-black text-slate-900">Nurse Maya AI</h3>
              <button onClick={startMaya} className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-black py-5 rounded-[2rem] transition-all flex items-center justify-center space-x-3"><Mic className="w-5 h-5" /><span>Start Session</span></button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full animate-in zoom-in duration-500"><PulseOrb state={botState} /><button onClick={stopMaya} className="mt-12 text-rose-500 font-black text-xs uppercase hover:bg-rose-50 px-6 py-2 rounded-full transition-all">End Session</button></div>
          )}
        </div>
        <div className="h-[300px] border-t border-slate-100"><ActionLog logs={actionLogs} /></div>
      </aside>
    </div>
  );
};

export default App;
