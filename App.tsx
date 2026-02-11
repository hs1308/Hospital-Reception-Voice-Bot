
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
  LogOut, 
  Mic, HeartPulse, 
  ChevronRight, AlertCircle, CheckCircle2,
  Activity, WifiOff, MessageSquare,
  History, Timer, FlaskConical
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

// Format as "Feb 20, 5:30 PM" in IST
const formatFriendlyIST = (dateStr: string | undefined) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date).replace(' at ', ', ');
};

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
  const transcriptRef = useRef<string[]>([]);

  // Session Persistence
  useEffect(() => {
    const saved = localStorage.getItem('nurse_maya_patient');
    if (saved) {
      try {
        setPatient(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('nurse_maya_patient');
      }
    }
  }, []);

  const handlePatientLogin = (p: Patient) => {
    setPatient(p);
    localStorage.setItem('nurse_maya_patient', JSON.stringify(p));
  };

  const handleLogout = () => {
    setPatient(null);
    localStorage.removeItem('nurse_maya_patient');
  };

  const addActionLog = useCallback((message: string, type: 'tool' | 'info' | 'error' = 'info') => {
    const newLog: LogType = { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), message, type };
    setActionLogs(prev => [newLog, ...prev.slice(0, 20)]);
  }, []);

  const logToDebug = useCallback(async (event: string, metadata: any = {}) => {
    if (!isSupabaseConfigured() || !patient) return;
    try {
      await supabase.from('maya_debug_logs').insert([{
        patient_phone: patient.phone,
        event,
        metadata,
        timestamp: new Date().toISOString()
      }]);
    } catch (e) {
      console.warn('Debug logging failed', e);
    }
  }, [patient]);

  const fetchData = useCallback(async (phone: string) => {
    if (!isSupabaseConfigured()) return;
    
    const { data: drData, error: drError } = await supabase
      .from('doctor_appointments')
      .select('*, doctors(*)')
      .eq('patient_phone', phone)
      .order('appointment_time', { ascending: false });
    
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
    
    const finalTranscript = transcriptRef.current.join(' ');
    const startTime = sessionStartTime;
    const endTime = Date.now();
    const phone = patient?.phone;
    const name = patient?.name;

    if (phone && startTime) {
      const durationVal = Math.floor((endTime - startTime) / 1000);
      const durationStr = durationVal > 60 
        ? `${Math.floor(durationVal / 60)}m ${durationVal % 60}s` 
        : `0m ${durationVal}s`;

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = finalTranscript.length > 20 
          ? `Summarize this medical receptionist conversation briefly (max 20 words): ${finalTranscript}`
          : `Provide a very short status for this session: ${actionLogs.filter(l => l.timestamp.getTime() > startTime).map(l => l.message).join('. ')}`;

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt
        });

        const summaryText = response.text?.trim() || "Brief session recorded.";
        
        const newSummary = {
          user_number: phone,
          user_name: name || "Unknown",
          call_summary: summaryText,
          duration: durationStr,
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
          tech_issue_detected: false
        };

        const { data, error } = await supabase.from('user_call_summary').insert([newSummary]).select().single();
        if (error) {
          addActionLog(`Summary DB Error: ${error.message}`, 'error');
          logToDebug('SUMMARY_SAVE_ERROR', { error: error.message, data: newSummary });
        } else if (data) {
          setSummaries(prev => [data, ...prev]);
          logToDebug('SUMMARY_SAVED', { summary_id: data.call_id });
        }
      } catch (e: any) {
        addActionLog(`Summary AI Error: ${e.message}`, 'error');
        logToDebug('SUMMARY_AI_ERROR', { error: e.message });
      }
    }

    setSessionStartTime(null);
    transcriptRef.current = [];
    if (sessionRef.current) try { await sessionRef.current.close(); } catch(e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    addActionLog('Maya session concluded', 'info');
    logToDebug('SESSION_ENDED', { duration_seconds: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0 });
  }, [patient, sessionStartTime, actionLogs, addActionLog, logToDebug]);

  const startMaya = async () => {
    if (isMayaActive || !patient) return;
    
    await fetchData(patient.phone);

    setIsMayaActive(true);
    setBotState('initiating');
    setSessionStartTime(Date.now());
    transcriptRef.current = [];
    logToDebug('SESSION_STARTED');
    
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
            logToDebug('WEBSOCKET_OPEN');
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
            if (msg.serverContent?.inputTranscription) {
              transcriptRef.current.push(`User: ${msg.serverContent.inputTranscription.text}`);
            }
            if (msg.serverContent?.outputTranscription) {
              transcriptRef.current.push(`Maya: ${msg.serverContent.outputTranscription.text}`);
            }

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
                logToDebug('TOOL_CALL', { name: fc.name, args: fc.args });
                
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
                    result = `Success: Appointment booked for ${formatFriendlyIST(data.appointment_time)}`;
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
                    result = `Success: Lab test booked for ${formatFriendlyIST(data.appointment_time)}`;
                    addActionLog(`Maya booked Lab test`, 'tool');
                  } else result = `Error: ${error?.message}`;
                }
                else if (fc.name === 'get_patient_appointments') {
                  await fetchData(patient.phone);
                  result = appointments.length > 0 ? appointments : "No appointments found.";
                  addActionLog('Maya fetched live history', 'tool');
                }
                else if (fc.name === 'cancel_doctor_appointment') {
                  await supabase.from('doctor_appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                  setAppointments(prev => prev.map(a => a.id === fc.args.appointment_id ? { ...a, status: 'cancelled' } : a));
                  result = "Doctor appointment cancelled.";
                  addActionLog('Maya cancelled doctor visit', 'tool');
                }
                else if (fc.name === 'cancel_lab_appointment') {
                  await supabase.from('lab_appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                  setAppointments(prev => prev.map(a => a.id === fc.args.appointment_id ? { ...a, status: 'cancelled' } : a));
                  result = "Lab appointment cancelled.";
                  addActionLog('Maya cancelled lab test', 'tool');
                }
                else if (fc.name === 'reschedule_doctor_appointment') {
                  const { data: oldAppt } = await supabase.from('doctor_appointments').select('*').eq('id', fc.args.appointment_id).single();
                  if (oldAppt) {
                    await supabase.from('doctor_appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                    const newAppt = {
                      patient_phone: patient.phone,
                      doctor_id: oldAppt.doctor_id,
                      appointment_time: fc.args.new_time,
                      status: 'scheduled'
                    };
                    const { data, error } = await supabase.from('doctor_appointments').insert([newAppt]).select('*, doctors(*)').single();
                    if (data) {
                      setAppointments(prev => [data as any, ...prev.filter(a => a.id !== fc.args.appointment_id)]);
                      result = `Success: Doctor appointment rescheduled to ${formatFriendlyIST(data.appointment_time)}`;
                      addActionLog(`Maya rescheduled doctor visit`, 'tool');
                    } else result = `Error: ${error?.message}`;
                  } else result = "Could not find the original appointment.";
                }
                else if (fc.name === 'reschedule_lab_appointment') {
                  const { data: oldAppt } = await supabase.from('lab_appointments').select('*').eq('id', fc.args.appointment_id).single();
                  if (oldAppt) {
                    await supabase.from('lab_appointments').update({ status: 'cancelled' }).eq('id', fc.args.appointment_id);
                    const newAppt = {
                      patient_phone: patient.phone,
                      lab_id: oldAppt.lab_id,
                      appointment_time: fc.args.new_time,
                      status: 'scheduled'
                    };
                    const { data, error } = await supabase.from('lab_appointments').insert([newAppt]).select('*, labs(*)').single();
                    if (data) {
                      setAppointments(prev => [data as any, ...prev.filter(a => a.id !== fc.args.appointment_id)]);
                      result = `Success: Lab test rescheduled to ${formatFriendlyIST(data.appointment_time)}`;
                      addActionLog(`Maya rescheduled lab test`, 'tool');
                    } else result = `Error: ${error?.message}`;
                  } else result = "Could not find the original appointment.";
                }
                else if (fc.name === 'hang_up') {
                  // Wait briefly for the "Thank you" audio to finish before ending session
                  addActionLog('Maya is concluding the call...', 'info');
                  setTimeout(() => {
                    stopMaya();
                  }, 3500);
                }
                
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
              }
            }
          },
          onerror: (e: any) => { 
            console.error('Gemini error:', e); 
            logToDebug('WEBSOCKET_ERROR', { message: e.message || 'Unknown error' });
            stopMaya(); 
          },
          onclose: (e) => { 
            logToDebug('WEBSOCKET_CLOSED', { code: e.code, reason: e.reason });
            stopMaya(); 
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: SYSTEM_INSTRUCTION + `\n\nUSER CONTEXT:\nName: ${patient.name}\nPhone: ${patient.phone}\nHospital Time (IST): ${formatFriendlyIST(new Date().toISOString())}`,
          tools: [{ functionDeclarations: TOOLS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e: any) { 
      console.error('Session start failed:', e);
      logToDebug('SESSION_INIT_FAILED', { error: e.message });
      stopMaya(); 
    }
  };

  const now = new Date();
  const upcoming = appointments.filter(a => new Date(a.appointment_time) >= now && a.status === 'scheduled');
  const past = appointments.filter(a => new Date(a.appointment_time) < now || a.status !== 'scheduled');

  if (!patient) {
    return (
      <div className="min-h-screen bg-white flex items-start justify-center overflow-y-auto">
        <div className="w-full">
          <PatientSetup onComplete={handlePatientLogin} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFDFE] flex flex-col text-slate-900">
      <header className="sticky top-0 px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-white/95 backdrop-blur-sm shrink-0 z-50 shadow-sm">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-base font-black leading-tight">Nurse Maya</h1>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hospital Intelligence (IST)</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-black">{patient.name}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{patient.phone}</p>
          </div>
          <button onClick={handleLogout} className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8 pb-32">
          
          <section className="relative">
            {!isMayaActive ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-lg flex flex-col md:flex-row items-center justify-between space-y-6 md:space-y-0 md:space-x-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex-1 space-y-3 order-2 md:order-1 text-center md:text-left">
                  <p className="text-[14px] text-slate-500 font-medium leading-normal max-w-xl">
                    Talk to Receptionist Maya to browse OPD, doctors, labs; schedule appointments or lab tests, manage visits.
                  </p>
                </div>
                <div className="order-1 md:order-2 shrink-0">
                  <button 
                    onClick={startMaya}
                    className="flex items-center space-x-3 bg-slate-900 hover:bg-indigo-600 text-white px-8 py-4 rounded-xl font-black text-[17px] transition-all shadow-xl group mx-auto md:mx-0"
                  >
                    <Mic className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    <span>Talk to Maya</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-xl flex flex-col items-center justify-center space-y-8 animate-in zoom-in">
                <div className="scale-75 origin-center">
                   <PulseOrb state={botState} />
                </div>
                <button 
                  onClick={stopMaya}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest transition-all border border-rose-100"
                >
                  End Conversation
                </button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="space-y-4">
              <h3 className="text-lg font-black flex items-center px-1"><Calendar className="w-5 h-5 mr-2.5 text-indigo-600" /> Upcoming</h3>
              <div className="space-y-3">
                {upcoming.length === 0 ? (
                  <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold">
                    No upcoming visits.
                  </div>
                ) : (
                  upcoming.map(app => (
                    <div key={app.id} className="bg-white border border-slate-100 p-4 rounded-xl flex items-center justify-between hover:shadow-md transition-all group">
                      <div className="flex items-center space-x-4 min-w-0">
                        <div className="w-11 h-11 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                          {app.lab_id ? <FlaskConical className="w-6 h-6" /> : <User className="w-6 h-6" />}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-900 text-[15px] truncate leading-tight">
                            {app.doctors ? `${app.doctors.name}, ${app.doctors.specialty}` : (app.labs?.test_name || 'Medical Visit')}
                          </h4>
                          <p className="text-[11px] font-black text-indigo-600 uppercase tracking-tight mt-1">
                            {formatFriendlyIST(app.appointment_time)}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-200 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-black text-slate-400 flex items-center px-1"><History className="w-5 h-5 mr-2.5" /> Past Records</h3>
              <div className="space-y-3">
                {past.length === 0 ? (
                  <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold opacity-50">
                    No history found.
                  </div>
                ) : (
                  past.map(app => (
                    <div key={app.id} className="bg-white/50 border border-slate-100 p-4 rounded-xl flex items-center justify-between opacity-75 hover:opacity-100 transition-all">
                      <div className="flex items-center space-x-4 min-w-0">
                        <div className="w-11 h-11 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                          {app.status === 'cancelled' ? <AlertCircle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-600 text-[15px] truncate leading-tight">
                            {app.doctors ? `${app.doctors.name}, ${app.doctors.specialty}` : (app.labs?.test_name || 'Medical Visit')}
                          </h4>
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-tighter mt-1">
                            {app.status.toUpperCase()} • {formatFriendlyIST(app.appointment_time)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="space-y-5">
            <h3 className="text-lg font-black flex items-center px-1"><MessageSquare className="w-5 h-5 mr-2.5 text-indigo-600" /> Call Summaries</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {summaries.length === 0 ? (
                <div className="col-span-full bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold">
                  No summaries yet.
                </div>
              ) : (
                summaries.map(summary => (
                  <div key={summary.call_id} className="bg-white border border-slate-100 p-5 rounded-xl space-y-3 hover:shadow-lg transition-all border-b-2 hover:border-indigo-200 relative">
                    <div className="flex items-center justify-between">
                      <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><MessageSquare className="w-3.5 h-3.5" /></div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                        {formatFriendlyIST(summary.start_time)}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-slate-700 font-medium italic leading-relaxed line-clamp-4">"{summary.call_summary}"</p>
                    </div>
                    <div className="flex items-center text-[9px] font-black text-slate-400 uppercase tracking-tighter pt-1 border-t border-slate-50">
                      <Timer className="w-3 h-3 mr-1.5" /> {summary.duration}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-50 group">
        <div className="absolute bottom-full right-0 mb-4 w-[320px] opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all translate-y-4 group-hover:translate-y-0">
          <div className="h-[350px] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
            <ActionLog logs={actionLogs} />
          </div>
        </div>
        <button className="bg-slate-900 text-white p-4 rounded-xl shadow-2xl hover:bg-indigo-600 transition-colors">
          <Activity className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default App;
