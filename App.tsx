
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
  History, Timer, FlaskConical, MapPin
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
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const addActionLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    const newLog: LogType = { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type };
    setActionLogs(prev => [newLog, ...prev.slice(0, 20)]);
  }, []);

  const fetchData = useCallback(async (phone: string) => {
    if (!isSupabaseConfigured()) return;
    
    // Fetch Doctor Appointments joined with Doctors
    const { data: drData, error: drError } = await supabase
      .from('doctor_appointments')
      .select('*, doctors(*)')
      .eq('patient_phone', phone)
      .order('appointment_time', { ascending: false });
    
    // Fetch Lab Appointments joined with Labs
    const { data: labData } = await supabase
      .from('lab_appointments')
      .select('*, labs(*)')
      .eq('patient_phone', phone)
      .order('appointment_time', { ascending: false });

    if (drError) addActionLog(`Sync Error: ${drError.message}`, 'error');
    
    const combined = [
      ...(drData || []).map(a => ({ ...a, type: 'doctor' })),
      ...(labData || []).map(a => ({ ...a, type: 'lab' }))
    ].sort((a, b) => new Date(b.appointment_time).getTime() - new Date(a.appointment_time).getTime());

    setAppointments(combined as any);

    // Fetch Summaries from user_call_summary
    const { data: summaryData } = await supabase
      .from('user_call_summary')
      .select('*')
      .eq('user_number', phone)
      .order('created_at', { ascending: false });
    
    if (summaryData) setSummaries(summaryData);
  }, [addActionLog]);

  useEffect(() => {
    if (patient) fetchData(patient.phone);
  }, [patient, fetchData]);

  const stopMaya = useCallback(async () => {
    setBotState('idle');
    setIsMayaActive(false);
    
    if (patient && sessionStartTime) {
      const transcript = actionLogs.filter(l => l.timestamp.getTime() > sessionStartTime).map(l => l.message).join('. ');
      if (transcript) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Summarize this interaction (max 15 words): ${transcript}`
          });
          const duration = Math.floor((Date.now() - sessionStartTime) / 1000);
          const newSummary = {
            user_number: patient.phone,
            user_name: patient.name,
            call_summary: response.text || "Routine medical session",
            duration: `${duration} seconds`,
            start_time: new Date(sessionStartTime).toISOString(),
            end_time: new Date().toISOString()
          };
          const { data } = await supabase.from('user_call_summary').insert([newSummary]).select().single();
          if (data) setSummaries(prev => [data, ...prev]);
        } catch (e) { console.error('Summary persist failed:', e); }
      }
    }

    setSessionStartTime(null);
    if (sessionRef.current) try { await sessionRef.current.close(); } catch(e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    addActionLog('Maya session concluded', 'info');
  }, [patient, sessionStartTime, actionLogs, addActionLog]);

  const startMaya = async () => {
    if (isMayaActive || !patient) return;
    
    await fetchData(patient.phone);

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
                
                if (fc.name === 'get_doctors') {
                  const { data } = await supabase.from('doctors').select('*');
                  result = data;
                  addActionLog('Maya checked Doctors database', 'tool');
                }
                else if (fc.name === 'get_labs') {
                  const { data } = await supabase.from('labs').select('*');
                  result = data;
                  addActionLog('Maya checked Lab database', 'tool');
                }
                else if (fc.name === 'get_opd_timings') {
                  const { data } = await supabase.from('opd_timings').select('*');
                  result = data;
                  addActionLog('Maya checked OPD timings', 'tool');
                }
                else if (fc.name === 'book_doctor_appointment') {
                  const newAppt = {
                    patient_phone: patient.phone,
                    doctor_id: fc.args.doctor_id,
                    appointment_time: fc.args.appointment_time,
                    status: 'scheduled'
                  };
                  const { data, error } = await supabase.from('doctor_appointments').insert([newAppt]).select('*, doctors(*)').single();
                  if (data) {
                    setAppointments(prev => [data as any, ...prev]);
                    result = `Success: Appointment booked for ${new Date(data.appointment_time).toLocaleString()}`;
                    addActionLog(`Maya booked Doctor visit`, 'tool');
                  } else result = `Error: ${error?.message}`;
                }
                else if (fc.name === 'book_lab_appointment') {
                  const newAppt = {
                    patient_phone: patient.phone,
                    lab_id: fc.args.lab_id,
                    appointment_time: fc.args.appointment_time,
                    status: 'scheduled'
                  };
                  const { data, error } = await supabase.from('lab_appointments').insert([newAppt]).select('*, labs(*)').single();
                  if (data) {
                    setAppointments(prev => [data as any, ...prev]);
                    result = `Success: Lab test booked for ${new Date(data.appointment_time).toLocaleString()}`;
                    addActionLog(`Maya booked Lab test`, 'tool');
                  } else result = `Error: ${error?.message}`;
                }
                else if (fc.name === 'get_patient_appointments') {
                  await fetchData(patient.phone);
                  result = appointments.length > 0 ? appointments : "No appointments found.";
                  addActionLog('Maya fetched live history', 'tool');
                }
                else if (fc.name === 'cancel_appointment') {
                  await supabase.from('doctor_appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                  setAppointments(prev => prev.map(a => a.id === fc.args.appointment_id ? { ...a, status: 'cancelled' } : a));
                  result = "Cancelled.";
                  addActionLog('Maya cancelled visit', 'tool');
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
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nUSER CONTEXT:\nName: ${patient.name}\nPhone: ${patient.phone}\nTime: ${new Date().toLocaleString()}`,
          tools: [{ functionDeclarations: TOOLS }]
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { 
      console.error('Session start failed:', e);
      stopMaya(); 
    }
  };

  const now = new Date();
  const upcoming = appointments.filter(a => new Date(a.appointment_time) >= now && a.status === 'scheduled');
  const past = appointments.filter(a => new Date(a.appointment_time) < now || a.status !== 'scheduled');

  if (!patient) return <div className="h-screen bg-slate-50 flex items-center justify-center p-6"><PatientSetup onComplete={setPatient} /></div>;

  return (
    <div className="h-screen bg-[#FDFDFE] flex flex-col overflow-hidden text-slate-900">
      <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 z-40">
        <div className="flex items-center space-x-4">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg">
            <HeartPulse className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black">Nurse Maya</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hospital Intelligence</p>
          </div>
        </div>
        <div className="flex items-center space-x-6">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-black">{patient.name}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{patient.phone}</p>
          </div>
          <button onClick={() => setPatient(null)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scroll-smooth">
        <div className="max-w-6xl mx-auto p-8 space-y-12 pb-32">
          
          <section className="relative">
            {!isMayaActive ? (
              <div className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-xl flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 md:space-x-12 animate-in fade-in slide-in-from-bottom-6">
                <div className="flex-1 space-y-6">
                  <div className="inline-flex items-center px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-xs font-black uppercase tracking-widest">
                    <Mic className="w-3 h-3 mr-2" /> Live Database Access
                  </div>
                  <h2 className="text-4xl font-black tracking-tight leading-tight">Professional voice assistant for your health.</h2>
                  <p className="text-lg text-slate-500 font-medium">Talk to Nurse Maya to browse specialists, schedule tests, or manage visits.</p>
                  <button 
                    onClick={startMaya}
                    className="flex items-center space-x-4 bg-slate-900 hover:bg-indigo-600 text-white px-10 py-6 rounded-[2rem] font-black text-xl transition-all shadow-2xl group"
                  >
                    <Mic className="w-6 h-6 group-hover:scale-110 transition-transform" />
                    <span>Talk to Maya</span>
                  </button>
                </div>
                <div className="w-64 h-64 bg-slate-50 rounded-[4rem] border-2 border-dashed border-slate-200 flex items-center justify-center shrink-0">
                   <HeartPulse className="w-20 h-20 text-slate-200" />
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[3rem] p-12 border border-slate-100 shadow-2xl flex flex-col items-center justify-center space-y-12 animate-in zoom-in">
                <PulseOrb state={botState} />
                <button 
                  onClick={stopMaya}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest transition-all border border-rose-100"
                >
                  End Conversation
                </button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <section className="space-y-6">
              <h3 className="text-xl font-black flex items-center px-2"><Calendar className="w-6 h-6 mr-3 text-indigo-600" /> Upcoming Visits</h3>
              <div className="space-y-4">
                {upcoming.length === 0 ? (
                  <div className="bg-slate-50 border-2 border-dashed border-slate-100 rounded-[2.5rem] p-12 text-center text-slate-400 font-bold">
                    No upcoming doctor or lab visits.
                  </div>
                ) : (
                  upcoming.map(app => (
                    <div key={app.id} className="bg-white border border-slate-100 p-6 rounded-[2rem] flex items-center justify-between hover:shadow-xl transition-all">
                      <div className="flex items-center space-x-6">
                        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                          {app.lab_id ? <FlaskConical className="w-8 h-8" /> : <User className="w-8 h-8" />}
                        </div>
                        <div>
                          <h4 className="font-black text-slate-900 text-lg">
                            {app.doctors?.name || app.labs?.test_name || 'Medical Visit'}
                          </h4>
                          <p className="text-xs font-bold text-indigo-600 uppercase mt-1">
                            {new Date(app.appointment_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-6">
              <h3 className="text-xl font-black text-slate-400 flex items-center px-2"><History className="w-6 h-6 mr-3" /> Past Records</h3>
              <div className="space-y-4">
                {past.length === 0 ? (
                  <div className="bg-slate-50 border-2 border-dashed border-slate-100 rounded-[2.5rem] p-12 text-center text-slate-400 font-bold opacity-50">
                    No history found.
                  </div>
                ) : (
                  past.map(app => (
                    <div key={app.id} className="bg-white/50 border border-slate-100 p-6 rounded-[2rem] flex items-center justify-between opacity-70">
                      <div className="flex items-center space-x-6">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                          {app.status === 'cancelled' ? <AlertCircle className="w-8 h-8" /> : <CheckCircle2 className="w-8 h-8" />}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-700">{app.doctors?.name || app.labs?.test_name}</h4>
                          <p className="text-[10px] font-black text-slate-400 uppercase mt-1">
                            {app.status.toUpperCase()} • {new Date(app.appointment_time).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="space-y-8 pb-20">
            <h3 className="text-xl font-black flex items-center px-2"><MessageSquare className="w-6 h-6 mr-3 text-indigo-600" /> Call Summaries</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {summaries.length === 0 ? (
                <div className="col-span-full bg-slate-50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-400 font-bold">
                  No saved summaries yet.
                </div>
              ) : (
                summaries.map(summary => (
                  <div key={summary.call_id} className="bg-white border border-slate-100 p-8 rounded-[2.5rem] space-y-4 hover:shadow-xl transition-all">
                    <div className="flex items-center justify-between">
                      <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600"><MessageSquare className="w-5 h-5" /></div>
                      <p className="text-[10px] font-black text-slate-400 uppercase">{new Date(summary.created_at).toLocaleDateString()}</p>
                    </div>
                    <p className="text-slate-700 font-medium italic">"{summary.call_summary}"</p>
                    <div className="text-[10px] font-black text-slate-400 uppercase">
                      <Timer className="w-3 h-3 inline mr-1" /> {summary.duration}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>
      </main>

      <div className="fixed bottom-8 right-8 z-50 group">
        <div className="absolute bottom-full right-0 mb-4 w-[350px] opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all translate-y-4 group-hover:translate-y-0">
          <div className="h-[400px] bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
            <ActionLog logs={actionLogs} />
          </div>
        </div>
        <button className="bg-slate-900 text-white p-5 rounded-2xl shadow-2xl hover:bg-indigo-600 transition-colors">
          <Activity className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

export default App;
