
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Patient, Appointment, BotState, ActionLog as LogType, ChatSummary } from './types';
import { SYSTEM_INSTRUCTION, TOOLS } from './constants';
import PatientSetup from './components/PatientSetup';
import PulseOrb from './components/PulseOrb';
import ActionLog from './components/ActionLog';
import { 
  Calendar, Clock, User, 
  Stethoscope, LogOut, 
  Mic, HeartPulse, ShieldCheck,
  ChevronRight, AlertCircle, CheckCircle2,
  Activity, WifiOff, Volume2, MessageSquare,
  History, Timer
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
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
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

  const addActionLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    const newLog: LogType = { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type };
    setActionLogs(prev => [newLog, ...prev.slice(0, 15)]);
  }, []);

  const fetchData = useCallback(async (patientId: string) => {
    if (!isSupabaseConfigured()) return;
    
    const { data: apptData, error: apptError } = await supabase
      .from('appointments')
      .select('*')
      .eq('patient_id', patientId)
      .order('appointment_time', { ascending: false });
    
    if (!apptError && apptData) setAppointments(apptData);

    const { data: summaryData } = await supabase
      .from('user_chat_summaries')
      .select('*')
      .eq('patient_id', patientId)
      .order('timestamp', { ascending: false });
    
    if (summaryData) setSummaries(summaryData);
  }, []);

  useEffect(() => {
    if (patient) fetchData(patient.id);
  }, [patient, fetchData]);

  const stopMaya = useCallback(async () => {
    setBotState('idle');
    setIsMayaActive(false);
    
    // Auto-save summary
    if (patient && sessionStartTime) {
      const transcript = actionLogs.filter(l => l.timestamp.getTime() > sessionStartTime).map(l => l.message).join('. ');
      if (transcript) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Summarize this interaction (max 15 words): ${transcript}`
          });
          const newSummary = {
            patient_id: patient.id,
            summary: response.text || "Routine session",
            duration_seconds: Math.floor((Date.now() - sessionStartTime) / 1000),
            timestamp: new Date().toISOString()
          };
          const { data } = await supabase.from('user_chat_summaries').insert([newSummary]).select().single();
          if (data) setSummaries(prev => [data, ...prev]);
        } catch (e) { console.error(e); }
      }
    }

    setSessionStartTime(null);
    if (sessionRef.current) try { await sessionRef.current.close(); } catch(e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    addActionLog('Maya session ended', 'info');
  }, [patient, sessionStartTime, actionLogs, addActionLog]);

  const startMaya = async () => {
    if (isMayaActive || !patient) return;
    
    // Refresh context before starting
    await fetchData(patient.id);

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
                
                if (fc.name === 'book_appointment') {
                  const newAppt = {
                    patient_id: patient.id,
                    department: fc.args.department || 'General Medicine',
                    doctor_name: fc.args.doctor_name || 'Dr. Smith',
                    appointment_time: fc.args.appointment_time,
                    reason: fc.args.reason || 'Routine Checkup',
                    status: 'scheduled'
                  };
                  const { data } = await supabase.from('appointments').insert([newAppt]).select().single();
                  if (data) {
                    setAppointments(prev => [data, ...prev]);
                    result = `Confirmed: ${data.department} at ${new Date(data.appointment_time).toLocaleString()}`;
                    addActionLog(`Maya booked ${data.department}`, 'tool');
                  } else result = "Failed to save to database.";
                } 
                else if (fc.name === 'get_patient_appointments') {
                  // FRESH FETCH to avoid hallucinations
                  const { data } = await supabase.from('appointments').select('*').eq('patient_id', patient.id).order('appointment_time', { ascending: false });
                  result = data && data.length > 0 
                    ? data.map(a => `ID: ${a.id} | ${a.department} w/ ${a.doctor_name} on ${new Date(a.appointment_time).toLocaleString()} (${a.status})`).join('\n')
                    : "No appointments found.";
                  addActionLog('Maya fetched live history', 'tool');
                }
                else if (fc.name === 'reschedule_appointment') {
                   const { data } = await supabase.from('appointments').update({ appointment_time: fc.args.new_appointment_time }).eq('id', fc.args.appointment_id).select().single();
                   if (data) {
                     setAppointments(prev => prev.map(a => a.id === data.id ? data : a));
                     result = "Updated to " + new Date(data.appointment_time).toLocaleString();
                     addActionLog(`Maya rescheduled appointment ${data.id}`, 'tool');
                   } else result = "Appointment ID not found.";
                }
                else if (fc.name === 'cancel_appointment') {
                  await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                  setAppointments(prev => prev.map(a => a.id === fc.args.appointment_id ? { ...a, status: 'cancelled' } : a));
                  result = "Appointment cancelled.";
                  addActionLog(`Maya cancelled appointment ${fc.args.appointment_id}`, 'tool');
                }
                else if (fc.name === 'hang_up') {
                  stopMaya();
                }
                
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
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nCONTEXT:\nPatient: ${patient.name}\nTime: ${new Date().toLocaleString()}`,
          tools: [{ functionDeclarations: TOOLS }]
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { stopMaya(); }
  };

  const now = new Date();
  const upcoming = appointments.filter(a => new Date(a.appointment_time) >= now && a.status === 'scheduled');
  const past = appointments.filter(a => new Date(a.appointment_time) < now || a.status !== 'scheduled');

  if (!patient) return <div className="h-screen bg-slate-50 flex items-center justify-center p-6"><PatientSetup onComplete={setPatient} /></div>;

  return (
    <div className="h-screen bg-[#FDFDFE] flex flex-col overflow-hidden">
      {!isSupabaseConfigured() && (
        <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-center space-x-2 text-xs font-black uppercase tracking-widest shrink-0">
          <WifiOff className="w-4 h-4" />
          <span>Database Keys Missing</span>
        </div>
      )}

      <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center space-x-4">
          <div className="bg-indigo-600 p-3 rounded-2xl"><HeartPulse className="w-6 h-6 text-white" /></div>
          <div><h1 className="text-xl font-black">Nurse Maya</h1><p className="text-[10px] font-black text-slate-400 uppercase">City General</p></div>
        </div>
        <button onClick={() => setPatient(null)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all"><LogOut className="w-5 h-5" /></button>
      </header>

      <main className="flex-1 overflow-y-auto scroll-smooth">
        <div className="max-w-6xl mx-auto p-8 space-y-12">
          
          <section>
            {!isMayaActive ? (
              <div className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-xl flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 md:space-x-12 animate-in fade-in slide-in-from-bottom-6">
                <div className="flex-1 space-y-6">
                  <div className="inline-flex items-center px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-xs font-black uppercase tracking-widest"><Mic className="w-3 h-3 mr-2" /> AI Voice Assistant</div>
                  <h2 className="text-4xl font-black tracking-tight leading-tight">Manage your appointments by voice.</h2>
                  <button onClick={startMaya} className="flex items-center space-x-4 bg-slate-900 hover:bg-indigo-600 text-white px-10 py-6 rounded-[2rem] font-black text-xl transition-all shadow-2xl group">
                    <Mic className="w-6 h-6 group-hover:scale-110" /><span>Talk to Maya</span>
                  </button>
                </div>
                <div className="w-64 h-64 bg-slate-50 rounded-[4rem] border-2 border-dashed border-slate-200 flex items-center justify-center shrink-0"><Mic className="w-20 h-20 text-slate-200" /></div>
              </div>
            ) : (
              <div className="bg-white rounded-[3rem] p-12 border border-slate-100 shadow-2xl flex flex-col items-center space-y-12 animate-in zoom-in">
                <PulseOrb state={botState} />
                <button onClick={stopMaya} className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest border border-rose-100">End Conversation</button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <section className="space-y-6">
              <h3 className="text-xl font-black px-2 flex items-center"><Calendar className="w-6 h-6 mr-3 text-indigo-600" /> Upcoming Visits</h3>
              <div className="space-y-4">
                {upcoming.length === 0 ? <div className="bg-slate-50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-400 font-bold">No upcoming visits.</div> : 
                  upcoming.map(app => (
                    <div key={app.id} className="bg-white border border-slate-100 p-6 rounded-[2rem] flex items-center justify-between group hover:border-indigo-200 hover:shadow-xl transition-all">
                      <div className="flex items-center space-x-6">
                        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600"><User className="w-8 h-8" /></div>
                        <div>
                          <h4 className="font-black text-slate-900 text-lg">{app.doctor_name}</h4>
                          <p className="text-xs text-slate-500 font-bold">{app.department} • {new Date(app.appointment_time).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            <section className="space-y-6">
              <h3 className="text-xl font-black px-2 flex items-center text-slate-400"><History className="w-6 h-6 mr-3" /> History</h3>
              <div className="space-y-4">
                {past.length === 0 ? <div className="bg-slate-50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-400 font-bold opacity-50">No history found.</div> : 
                  past.map(app => (
                    <div key={app.id} className="bg-white/50 border border-slate-100 p-6 rounded-[2rem] flex items-center justify-between opacity-70">
                      <div className="flex items-center space-x-6">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">{app.status === 'cancelled' ? <AlertCircle className="w-8 h-8" /> : <CheckCircle2 className="w-8 h-8" />}</div>
                        <div><h4 className="font-bold text-slate-700">{app.doctor_name}</h4><p className="text-[10px] font-black text-slate-400 uppercase mt-1">{app.status.toUpperCase()} • {new Date(app.appointment_time).toLocaleDateString()}</p></div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          <section className="space-y-8 pb-20">
            <h3 className="text-xl font-black px-2 flex items-center"><MessageSquare className="w-6 h-6 mr-3 text-indigo-600" /> Maya Call Summaries</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {summaries.length === 0 ? <div className="col-span-full bg-slate-50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-400 font-bold">No archived conversations.</div> : 
                summaries.map(summary => (
                  <div key={summary.id} className="bg-white border border-slate-100 p-8 rounded-[2.5rem] space-y-4 hover:shadow-xl transition-all">
                    <div className="flex items-center justify-between"><div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600"><MessageSquare className="w-5 h-5" /></div><p className="text-[10px] font-black text-slate-400 uppercase">{new Date(summary.timestamp).toLocaleDateString()}</p></div>
                    <p className="text-slate-700 font-medium italic">"{summary.summary}"</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest"><Timer className="w-3 h-3 inline mr-1" /> {summary.duration_seconds}s call</p>
                  </div>
                ))}
            </div>
          </section>
        </div>
      </main>

      <div className="fixed bottom-8 right-8 z-50 group">
        <div className="absolute bottom-full right-0 mb-4 w-[350px] opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all translate-y-4 group-hover:translate-y-0">
          <div className="h-[400px] bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden"><ActionLog logs={actionLogs} /></div>
        </div>
        <button className="bg-slate-900 text-white p-5 rounded-2xl shadow-2xl hover:bg-indigo-600 transition-colors"><Activity className="w-6 h-6" /></button>
      </div>
    </div>
  );
};

export default App;
