import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Patient, Appointment, BotState, ActionLog as LogType, ChatSummary } from './types';
import { SYSTEM_INSTRUCTION, TOOLS } from './constants';
import { DB_TABLES } from './dbTables';
import PatientSetup from './components/PatientSetup';
import PulseOrb from './components/PulseOrb';
import ActionLog from './components/ActionLog';
import { 
  Calendar, Clock, User, 
  LogOut, 
  Mic, HeartPulse, 
  ChevronRight, AlertCircle, CheckCircle2,
  Activity, WifiOff, MessageSquare,
  History, Timer, FlaskConical,
  ChevronLeft
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

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const fraction = pos - index;
    if (index + 1 < input.length) {
      result[i] = input[index] * (1 - fraction) + input[index + 1] * fraction;
    } else {
      result[i] = input[index];
    }
  }
  return result;
}

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

const ITEMS_PER_PAGE = 4;

type ToolResult =
  | { success: true; data: any; message?: string }
  | { success: false; error: { code: string; message: string }; data?: any };

const createToolSuccess = (data: any, message?: string): ToolResult => ({ success: true, data, message });

const createToolError = (code: string, message: string, data?: any): ToolResult => ({
  success: false,
  error: { code, message },
  data,
});

const normalizeAppointmentRecord = (appointment: any, type: 'doctor' | 'lab') => ({
  id: appointment.id,
  type,
  status: appointment.status,
  appointment_time: appointment.appointment_time,
  doctor_id: appointment.doctor_id ?? null,
  lab_id: appointment.lab_id ?? null,
  doctor_name: appointment.doctors?.name ?? null,
  doctor_specialty: appointment.doctors?.specialty ?? null,
  lab_test_name: appointment.labs?.test_name ?? null,
});

const normalizeDoctorSlotRecord = (slot: any) => ({
  id: slot.id,
  doctor_id: slot.doctor_id,
  start_time: slot.start_time,
  is_available: slot.is_available,
  booked_by_phone: slot.booked_by_phone ?? null,
  appointment_id: slot.appointment_id ?? null,
  doctor_name: slot.doctor?.name ?? null,
  doctor_specialty: slot.doctor?.specialty ?? null,
});

const normalizeLabSlotRecord = (slot: any) => ({
  id: slot.id,
  lab_id: slot.lab_id,
  start_time: slot.start_time,
  is_available: slot.is_available,
  booked_by_phone: slot.booked_by_phone ?? null,
  appointment_id: slot.appointment_id ?? null,
  lab_test_name: slot.lab?.test_name ?? null,
});

const formatDoctorName = (name: string, specialty: string) => {
  const cleanName = name.replace(/^Dr\.?\s*/i, '');
  return `Dr. ${cleanName}, ${specialty}`;
};

const clearDoctorSlotBookingFields = {
  is_available: true,
  booked_by_phone: null,
  appointment_id: null,
};

const SkeletonCard = () => (
  <div className="space-y-3">
    {[1, 2].map(i => (
      <div key={i} className="bg-white border border-slate-100 p-4 rounded-xl flex items-center space-x-4 animate-pulse">
        <div className="w-11 h-11 rounded-lg bg-slate-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-slate-100 rounded w-3/4" />
          <div className="h-2 bg-slate-100 rounded w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

const SummarySkeletonCard = () => (
  <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {[1, 2, 3].map(i => (
      <div key={i} className="bg-white border border-slate-100 p-5 rounded-xl space-y-3 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="w-8 h-8 rounded-lg bg-slate-100" />
          <div className="h-2 bg-slate-100 rounded w-1/3" />
        </div>
        <div className="space-y-2">
          <div className="h-2 bg-slate-100 rounded w-full" />
          <div className="h-2 bg-slate-100 rounded w-5/6" />
          <div className="h-2 bg-slate-100 rounded w-4/6" />
        </div>
        <div className="h-2 bg-slate-100 rounded w-1/4 pt-1" />
      </div>
    ))}
  </div>
);

const App: React.FC = () => {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  const [botState, setBotState] = useState<BotState>('idle');
  const [actionLogs, setActionLogs] = useState<LogType[]>([]);
  const [isMayaActive, setIsMayaActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Pagination State
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [pastPage, setPastPage] = useState(1);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptRef = useRef<string[]>([]);
  const sessionStartTimeRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastUserTranscriptAtRef = useRef<number | null>(null);
  const awaitingFirstResponseRef = useRef(false);
  const lastTranscriptEventAtRef = useRef<number | null>(null);
  const transcriptFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBufferRef = useRef<{ speaker: 'user' | 'maya'; text: string }[]>([]);
  // Accumulates partial word fragments per speaker until turnComplete fires
  const pendingUserTranscriptRef = useRef<string>('');
  const pendingMayaTranscriptRef = useRef<string>('');
  const sessionActiveRef = useRef<boolean>(false);

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

  const logToDebug = useCallback((event: string, metadata: any = {}) => {
    if (!isSupabaseConfigured() || !patient) return;
    supabase.from(DB_TABLES.mayaDebugLogs).insert([{
      patient_phone: patient.phone,
      event,
      metadata: {
        session_id: sessionIdRef.current,
        ...metadata,
      },
      timestamp: new Date().toISOString()
    }]).then(({ error }) => {
      if (error) console.warn('Debug logging failed', error);
    });
  }, [patient]);

  const recordToolLatency = useCallback((event: string, extra: any = {}) => {
    if (!lastUserTranscriptAtRef.current) return;
    const latencyMs = Date.now() - lastUserTranscriptAtRef.current;
    logToDebug(event, { latency_ms: latencyMs, ...extra });
  }, [logToDebug]);

  // Flushes the accumulated transcript buffer to Supabase in a single insert
  const flushTranscriptBuffer = useCallback(async () => {
    if (!isSupabaseConfigured() || !patient || !sessionIdRef.current) return;
    const turns = transcriptBufferRef.current;
    if (turns.length === 0) return;
    transcriptBufferRef.current = [];

    const now = new Date();
    const rows = turns.map(turn => ({
      session_id: sessionIdRef.current!,
      speaker: turn.speaker,
      patient_phone: patient.phone,
      patient_name: patient.name,
      started_at: now.toISOString(),
      ended_at: now.toISOString(),
      language: navigator.language || 'unknown',
      transcript: turn.text,
    }));

    supabase.from(DB_TABLES.sessionTranscripts).insert(rows).then(({ error }) => {
      if (error) console.warn('Transcript flush failed', error);
    });
  }, [patient]);

  // Appends a partial transcription fragment to the pending buffer for that speaker.
  // The full turn is only written to DB when turnComplete fires.
  const accumulateTranscript = useCallback((speaker: 'user' | 'maya', fragment: string) => {
    if (!fragment.trim()) return;
    if (speaker === 'user') {
      pendingUserTranscriptRef.current += (pendingUserTranscriptRef.current ? ' ' : '') + fragment.trim();
    } else {
      pendingMayaTranscriptRef.current += (pendingMayaTranscriptRef.current ? ' ' : '') + fragment.trim();
    }
  }, []);

  // Called when turnComplete fires — flushes both pending transcripts as one batch insert
  const flushPendingTurnTranscripts = useCallback(() => {
    if (!isSupabaseConfigured() || !patient || !sessionIdRef.current) return;
    const rows: any[] = [];
    const now = new Date().toISOString();

    if (pendingUserTranscriptRef.current.trim()) {
      rows.push({
        session_id: sessionIdRef.current,
        speaker: 'user',
        patient_phone: patient.phone,
        patient_name: patient.name,
        started_at: now,
        ended_at: now,
        language: navigator.language || 'unknown',
        transcript: pendingUserTranscriptRef.current.trim(),
      });
      pendingUserTranscriptRef.current = '';
    }

    if (pendingMayaTranscriptRef.current.trim()) {
      rows.push({
        session_id: sessionIdRef.current,
        speaker: 'maya',
        patient_phone: patient.phone,
        patient_name: patient.name,
        started_at: now,
        ended_at: now,
        language: navigator.language || 'unknown',
        transcript: pendingMayaTranscriptRef.current.trim(),
      });
      pendingMayaTranscriptRef.current = '';
    }

    if (rows.length === 0) return;
    supabase.from(DB_TABLES.sessionTranscripts).insert(rows).then(({ error }) => {
      if (error) console.warn('Transcript turn flush failed', error);
    });
  }, [patient]);

  const fetchData = useCallback(async (phone: string) => {
    if (!isSupabaseConfigured()) return;

    setIsLoading(true);
    try {
      const [
        { data: drData, error: drError },
        { data: labData },
        { data: summaryData },
      ] = await Promise.all([
        supabase
          .from(DB_TABLES.doctorAppointments)
          .select(`*, ${DB_TABLES.doctors}(*)`)
          .eq('patient_phone', phone)
          .order('appointment_time', { ascending: false }),
        supabase
          .from(DB_TABLES.labAppointments)
          .select(`*, ${DB_TABLES.labs}(*)`)
          .eq('patient_phone', phone)
          .order('appointment_time', { ascending: false }),
        supabase
          .from(DB_TABLES.userCallSummary)
          .select('*')
          .eq('user_number', phone)
          .order('created_at', { ascending: false }),
      ]);

      if (drError) addActionLog(`Sync Error: ${drError.message}`, 'error');

      const combined = [
        ...(drData || []).map(a => ({ ...a, type: 'doctor', doctors: (a as any).maya_doctors ?? (a as any).doctors ?? null })),
        ...(labData || []).map(a => ({ ...a, type: 'lab', labs: (a as any).maya_labs ?? (a as any).labs ?? null }))
      ].sort((a, b) => new Date(b.appointment_time).getTime() - new Date(a.appointment_time).getTime());

      setAppointments(combined as any);
      if (summaryData) setSummaries(summaryData);
    } finally {
      setIsLoading(false);
    }
  }, [addActionLog]);

  useEffect(() => {
    if (patient) fetchData(patient.phone);
  }, [patient, fetchData]);

  const stopMaya = useCallback(async () => {
    if (!sessionStartTimeRef.current) return;

    setBotState('idle');
    setIsMayaActive(false);
    sessionActiveRef.current = false;
    
    const finalTranscript = transcriptRef.current.join(' ');
    const startTime = sessionStartTimeRef.current;
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
          : `Provide a very short status for this session: Conversation ended quickly.`;

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

        const { data, error } = await supabase.from(DB_TABLES.userCallSummary).insert([newSummary]).select().single();
        if (error) {
          addActionLog(`Summary DB Error: ${error.message}`, 'error');
          logToDebug('SUMMARY_SAVE_ERROR', { error_code: error.code, error_message: error.message, data: newSummary });
        } else if (data) {
          setSummaries(prev => [data, ...prev]);
        }
      } catch (e: any) {
        addActionLog(`Summary AI Error: ${e.message}`, 'error');
      }
    }

    sessionStartTimeRef.current = null;
    sessionIdRef.current = null;
    lastUserTranscriptAtRef.current = null;
    awaitingFirstResponseRef.current = false;
    lastTranscriptEventAtRef.current = null;
    transcriptRef.current = [];
    // Flush any remaining transcript turns then reset all transcript state
    if (transcriptFlushTimerRef.current) clearTimeout(transcriptFlushTimerRef.current);
    flushPendingTurnTranscripts();
    await flushTranscriptBuffer();
    transcriptBufferRef.current = [];
    pendingUserTranscriptRef.current = '';
    pendingMayaTranscriptRef.current = '';
    if (sessionRef.current) try { await sessionRef.current.close(); } catch(e) {}
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    if (inputAudioContextRef.current) {
      try { await inputAudioContextRef.current.close(); } catch(e) {}
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try { await outputAudioContextRef.current.close(); } catch(e) {}
      outputAudioContextRef.current = null;
    }

    addActionLog('Maya session concluded', 'info');
    logToDebug('SESSION_ENDED');
  }, [patient, addActionLog, logToDebug, flushTranscriptBuffer, flushPendingTurnTranscripts]);

  const executeToolCall = useCallback(async (fc: any): Promise<ToolResult> => {
    if (!patient) {
      return createToolError('PATIENT_MISSING', 'No patient is active for this session.');
    }

    const startedAt = Date.now();
    logToDebug('TOOL_CALL_RECEIVED', { tool_name: fc.name, args: fc.args ?? {} });
    addActionLog(`Maya requested ${fc.name}`, 'tool');

    try {
      let result: ToolResult;

      if (fc.name === 'get_doctors') {
        const { data, error } = await supabase.from(DB_TABLES.doctors).select('*');
        result = error
          ? createToolError('DOCTORS_FETCH_FAILED', error.message)
          : createToolSuccess(data ?? []);
      } else if (fc.name === 'get_doctor_slots') {
        if (!fc.args?.doctor_id) {
          result = createToolError('DOCTOR_ID_REQUIRED', 'A doctor_id is required to check doctor slots.');
        } else {
          const startDate =
            typeof fc.args.start_date === 'string' && fc.args.start_date.trim().length > 0
              ? new Date(fc.args.start_date).toISOString()
              : new Date().toISOString();

          const { data, error } = await supabase
            .from(DB_TABLES.doctorSlots)
            .select(`*, doctor:${DB_TABLES.doctors}(id, name, specialty)`)
            .eq('doctor_id', fc.args.doctor_id)
            .eq('is_available', true)
            .gte('start_time', startDate)
            .order('start_time', { ascending: true });

          result = error
            ? createToolError('DOCTOR_SLOTS_FETCH_FAILED', error.message)
            : createToolSuccess((data ?? []).map(normalizeDoctorSlotRecord));
        }
      } else if (fc.name === 'get_lab_slots') {
        if (!fc.args?.lab_id) {
          result = createToolError('LAB_ID_REQUIRED', 'A lab_id is required to check lab slots.');
        } else {
          const startDate =
            typeof fc.args.start_date === 'string' && fc.args.start_date.trim().length > 0
              ? new Date(fc.args.start_date).toISOString()
              : new Date().toISOString();

          const { data, error } = await supabase
            .from(DB_TABLES.labSlots)
            .select(`*, lab:${DB_TABLES.labs}(id, test_name)`)
            .eq('lab_id', fc.args.lab_id)
            .eq('is_available', true)
            .gte('start_time', startDate)
            .order('start_time', { ascending: true });

          result = error
            ? createToolError('LAB_SLOTS_FETCH_FAILED', error.message)
            : createToolSuccess((data ?? []).map(normalizeLabSlotRecord));
        }
      } else if (fc.name === 'get_labs') {
        const { data, error } = await supabase.from(DB_TABLES.labs).select('*');
        result = error
          ? createToolError('LABS_FETCH_FAILED', error.message)
          : createToolSuccess(data ?? []);
      } else if (fc.name === 'get_opd_timings') {
        const { data, error } = await supabase.from(DB_TABLES.opdTimings).select('*');
        result = error
          ? createToolError('OPD_FETCH_FAILED', error.message)
          : createToolSuccess(data ?? []);
      } else if (fc.name === 'get_patient_appointments') {
        const [{ data: drData, error: drError }, { data: labData, error: labError }] = await Promise.all([
          supabase
            .from(DB_TABLES.doctorAppointments)
            .select(`*, ${DB_TABLES.doctors}(*)`)
            .eq('patient_phone', patient.phone)
            .order('appointment_time', { ascending: true }),
          supabase
            .from(DB_TABLES.labAppointments)
            .select(`*, ${DB_TABLES.labs}(*)`)
            .eq('patient_phone', patient.phone)
            .order('appointment_time', { ascending: true }),
        ]);

        if (drError || labError) {
          result = createToolError(
            'APPOINTMENTS_FETCH_FAILED',
            drError?.message || labError?.message || 'Could not fetch appointments.',
          );
        } else {
          const combined = [
            ...(drData ?? []).map((appointment) => normalizeAppointmentRecord(appointment, 'doctor')),
            ...(labData ?? []).map((appointment) => normalizeAppointmentRecord(appointment, 'lab')),
          ].sort((a, b) => new Date(a.appointment_time).getTime() - new Date(b.appointment_time).getTime());

          const nowIso = new Date().toISOString();
          result = createToolSuccess({
            appointments: combined,
            upcoming: combined.filter((appointment) => appointment.status === 'scheduled' && appointment.appointment_time >= nowIso),
            past: combined.filter((appointment) => appointment.status !== 'scheduled' || appointment.appointment_time < nowIso),
          });
        }
      } else if (fc.name === 'book_doctor_appointment') {
        if (!fc.args?.doctor_id) {
          result = createToolError('DOCTOR_ID_REQUIRED', 'A valid doctor_id is required to book a doctor appointment.');
        }
        else {
          const requestedTime =
            typeof fc.args.appointment_time === 'string' && fc.args.appointment_time.trim().length > 0
              ? new Date(fc.args.appointment_time).toISOString()
              : null;

          let slotQuery = supabase
            .from(DB_TABLES.doctorSlots)
            .select('*')
            .eq('doctor_id', fc.args.doctor_id)
            .eq('is_available', true);

          if (fc.args.slot_id) {
            slotQuery = slotQuery.eq('id', fc.args.slot_id);
          } else if (requestedTime) {
            slotQuery = slotQuery.eq('start_time', requestedTime);
          } else {
            result = createToolError(
              'DOCTOR_SLOT_REQUIRED',
              'A real doctor slot is required before booking. Please check doctor slots first.',
            );
            logToDebug('TOOL_CALL_FAILED', {
              tool_name: fc.name,
              duration_ms: Date.now() - startedAt,
              args: fc.args ?? {},
              result,
            });
            addActionLog(`${fc.name} failed: ${result.error.message}`, 'error');
            return result;
          }

          const { data: slot, error: slotError } = await slotQuery.single();

          if (slotError || !slot) {
            result = createToolError(
              'DOCTOR_SLOT_NOT_AVAILABLE',
              'The requested doctor slot is not available. Please choose one of the real available slots.',
            );
          } else if (slot.doctor_id !== fc.args.doctor_id) {
            result = createToolError(
              'DOCTOR_SLOT_MISMATCH',
              'The requested slot does not belong to the selected doctor.',
            );
          } else {
            const appointmentTime = slot.start_time;
            const newAppt = {
              patient_phone: patient.phone,
              doctor_id: fc.args.doctor_id,
              appointment_time: appointmentTime,
              status: 'scheduled',
            };

            const { data: appointment, error: appointmentError } = await supabase
              .from(DB_TABLES.doctorAppointments)
              .insert([newAppt])
              .select(`*, ${DB_TABLES.doctors}(*)`)
              .single();

            if (appointmentError || !appointment) {
              result = createToolError(
                'DOCTOR_BOOK_FAILED',
                appointmentError?.message || 'Unable to book doctor appointment.',
              );
            } else {
              const { error: slotUpdateError } = await supabase
                .from(DB_TABLES.doctorSlots)
                .update({
                  is_available: false,
                  booked_by_phone: patient.phone,
                  appointment_id: appointment.id,
                })
                .eq('id', slot.id)
                .eq('is_available', true);

              if (slotUpdateError) {
                result = createToolError(
                  'DOCTOR_SLOT_UPDATE_FAILED',
                  `Appointment was created but the slot could not be marked booked: ${slotUpdateError.message}`,
                  {
                    appointment: normalizeAppointmentRecord(appointment, 'doctor'),
                    slot: normalizeDoctorSlotRecord(slot),
                  },
                );
              } else {
                setAppointments((prev) => [appointment as any, ...prev]);
                result = createToolSuccess(
                  {
                    appointment: normalizeAppointmentRecord(appointment, 'doctor'),
                    slot: normalizeDoctorSlotRecord({
                      ...slot,
                      is_available: false,
                      booked_by_phone: patient.phone,
                      appointment_id: appointment.id,
                    }),
                  },
                  'Doctor appointment booked successfully.',
                );
              }
            }
          }
        }
      } else if (fc.name === 'book_lab_appointment') {
        if (!fc.args?.lab_id) {
          result = createToolError('LAB_ID_REQUIRED', 'A valid lab_id is required to book a lab appointment.');
        } else {
          const requestedTime =
            typeof fc.args.appointment_time === 'string' && fc.args.appointment_time.trim().length > 0
              ? new Date(fc.args.appointment_time).toISOString()
              : null;

          let slotQuery = supabase
            .from(DB_TABLES.labSlots)
            .select('*')
            .eq('lab_id', fc.args.lab_id)
            .eq('is_available', true);

          if (fc.args.slot_id) {
            slotQuery = slotQuery.eq('id', fc.args.slot_id);
          } else if (requestedTime) {
            slotQuery = slotQuery.eq('start_time', requestedTime);
          } else {
            result = createToolError(
              'LAB_SLOT_REQUIRED',
              'A real lab slot is required before booking. Please check lab slots first.',
            );
            logToDebug('TOOL_CALL_FAILED', { tool_name: fc.name, duration_ms: Date.now() - startedAt, args: fc.args ?? {}, result });
            addActionLog(`${fc.name} failed: ${result.error.message}`, 'error');
            return result;
          }

          const { data: slot, error: slotError } = await slotQuery.single();

          if (slotError || !slot) {
            result = createToolError('LAB_SLOT_NOT_AVAILABLE', 'The requested lab slot is not available. Please choose a real available slot.');
          } else if (slot.lab_id !== fc.args.lab_id) {
            result = createToolError('LAB_SLOT_MISMATCH', 'The requested slot does not belong to the selected lab.');
          } else {
            const { data: appointment, error: appointmentError } = await supabase
              .from(DB_TABLES.labAppointments)
              .insert([{ patient_phone: patient.phone, lab_id: fc.args.lab_id, appointment_time: slot.start_time, status: 'scheduled' }])
              .select(`*, ${DB_TABLES.labs}(*)`)
              .single();

            if (appointmentError || !appointment) {
              result = createToolError('LAB_BOOK_FAILED', appointmentError?.message || 'Unable to book lab appointment.');
            } else {
              const { error: slotUpdateError } = await supabase
                .from(DB_TABLES.labSlots)
                .update({ is_available: false, booked_by_phone: patient.phone, appointment_id: appointment.id })
                .eq('id', slot.id)
                .eq('is_available', true);

              if (slotUpdateError) {
                result = createToolError('LAB_SLOT_UPDATE_FAILED', `Appointment created but slot could not be marked booked: ${slotUpdateError.message}`,
                  { appointment: normalizeAppointmentRecord(appointment, 'lab'), slot: normalizeLabSlotRecord(slot) });
              } else {
                setAppointments(prev => [appointment as any, ...prev]);
                result = createToolSuccess(
                  { appointment: normalizeAppointmentRecord(appointment, 'lab'), slot: normalizeLabSlotRecord({ ...slot, is_available: false, booked_by_phone: patient.phone, appointment_id: appointment.id }) },
                  'Lab appointment booked successfully.',
                );
              }
            }
          }
        }
      } else if (fc.name === 'cancel_doctor_appointment') {
        const { data, error } = await supabase
          .from(DB_TABLES.doctorAppointments)
          .update({ status: 'cancelled' })
          .eq('id', fc.args.appointment_id)
          .eq('patient_phone', patient.phone)
          .select(`*, ${DB_TABLES.doctors}(*)`)
          .single();

        if (error || !data) {
          result = createToolError('DOCTOR_CANCEL_FAILED', error?.message || 'Unable to cancel doctor appointment.');
        } else {
          const { error: slotReleaseError } = await supabase
            .from(DB_TABLES.doctorSlots)
            .update(clearDoctorSlotBookingFields)
            .eq('appointment_id', data.id);

          if (slotReleaseError) {
            result = createToolError(
              'DOCTOR_SLOT_RELEASE_FAILED',
              `Appointment was cancelled but the slot could not be released: ${slotReleaseError.message}`,
              { appointment: normalizeAppointmentRecord(data, 'doctor') },
            );
          } else {
            await fetchData(patient.phone);
            result = createToolSuccess(normalizeAppointmentRecord(data, 'doctor'), 'Doctor appointment cancelled successfully.');
          }
        }
      } else if (fc.name === 'cancel_lab_appointment') {
        const { data, error } = await supabase
          .from(DB_TABLES.labAppointments)
          .update({ status: 'cancelled' })
          .eq('id', fc.args.appointment_id)
          .eq('patient_phone', patient.phone)
          .select(`*, ${DB_TABLES.labs}(*)`)
          .single();

        if (error || !data) {
          result = createToolError('LAB_CANCEL_FAILED', error?.message || 'Unable to cancel lab appointment.');
        } else {
          const { error: slotReleaseError } = await supabase
            .from(DB_TABLES.labSlots)
            .update({ is_available: true, booked_by_phone: null, appointment_id: null })
            .eq('appointment_id', data.id);

          if (slotReleaseError) {
            result = createToolError('LAB_SLOT_RELEASE_FAILED',
              `Appointment was cancelled but the slot could not be released: ${slotReleaseError.message}`,
              { appointment: normalizeAppointmentRecord(data, 'lab') });
          } else {
            await fetchData(patient.phone);
            result = createToolSuccess(normalizeAppointmentRecord(data, 'lab'), 'Lab appointment cancelled successfully.');
          }
        }
      } else if (fc.name === 'reschedule_doctor_appointment') {
        const { data: currentAppointment, error: currentAppointmentError } = await supabase
          .from(DB_TABLES.doctorAppointments)
          .select(`*, ${DB_TABLES.doctors}(*)`)
          .eq('id', fc.args.appointment_id)
          .eq('patient_phone', patient.phone)
          .single();

        if (currentAppointmentError || !currentAppointment) {
          result = createToolError(
            'DOCTOR_APPOINTMENT_NOT_FOUND',
            currentAppointmentError?.message || 'Unable to find doctor appointment to reschedule.',
          );
        } else {
          const requestedTime =
            typeof fc.args.new_time === 'string' && fc.args.new_time.trim().length > 0
              ? new Date(fc.args.new_time).toISOString()
              : null;

          let slotQuery = supabase
            .from(DB_TABLES.doctorSlots)
            .select('*')
            .eq('doctor_id', currentAppointment.doctor_id)
            .eq('is_available', true);

          if (fc.args.slot_id) {
            slotQuery = slotQuery.eq('id', fc.args.slot_id);
          } else if (requestedTime) {
            slotQuery = slotQuery.eq('start_time', requestedTime);
          } else {
            result = createToolError(
              'DOCTOR_SLOT_REQUIRED',
              'A real available slot is required before rescheduling. Please check doctor slots first.',
            );
            logToDebug('TOOL_CALL_FAILED', {
              tool_name: fc.name,
              duration_ms: Date.now() - startedAt,
              args: fc.args ?? {},
              result,
            });
            addActionLog(`${fc.name} failed: ${result.error.message}`, 'error');
            return result;
          }

          const { data: newSlot, error: newSlotError } = await slotQuery.single();

          if (newSlotError || !newSlot) {
            result = createToolError(
              'DOCTOR_SLOT_NOT_AVAILABLE',
              'The requested new doctor slot is not available. Please choose one of the real available slots.',
            );
          } else {
            const { data: updatedAppointment, error: updateAppointmentError } = await supabase
              .from(DB_TABLES.doctorAppointments)
              .update({ appointment_time: newSlot.start_time, status: 'scheduled' })
              .eq('id', fc.args.appointment_id)
              .eq('patient_phone', patient.phone)
              .select(`*, ${DB_TABLES.doctors}(*)`)
              .single();

            if (updateAppointmentError || !updatedAppointment) {
              result = createToolError(
                'DOCTOR_RESCHEDULE_FAILED',
                updateAppointmentError?.message || 'Unable to reschedule doctor appointment.',
              );
            } else {
              const { error: releaseOldSlotError } = await supabase
                .from(DB_TABLES.doctorSlots)
                .update(clearDoctorSlotBookingFields)
                .eq('appointment_id', currentAppointment.id);

              if (releaseOldSlotError) {
                result = createToolError(
                  'DOCTOR_OLD_SLOT_RELEASE_FAILED',
                  `Appointment was moved but the old slot could not be released: ${releaseOldSlotError.message}`,
                  { appointment: normalizeAppointmentRecord(updatedAppointment, 'doctor') },
                );
              } else {
                const { error: reserveNewSlotError } = await supabase
                  .from(DB_TABLES.doctorSlots)
                  .update({
                    is_available: false,
                    booked_by_phone: patient.phone,
                    appointment_id: updatedAppointment.id,
                  })
                  .eq('id', newSlot.id)
                  .eq('is_available', true);

                if (reserveNewSlotError) {
                  result = createToolError(
                    'DOCTOR_NEW_SLOT_RESERVE_FAILED',
                    `Appointment was moved but the new slot could not be reserved: ${reserveNewSlotError.message}`,
                    {
                      appointment: normalizeAppointmentRecord(updatedAppointment, 'doctor'),
                      slot: normalizeDoctorSlotRecord(newSlot),
                    },
                  );
                } else {
                  await fetchData(patient.phone);
                  result = createToolSuccess(
                    {
                      appointment: normalizeAppointmentRecord(updatedAppointment, 'doctor'),
                      slot: normalizeDoctorSlotRecord({
                        ...newSlot,
                        is_available: false,
                        booked_by_phone: patient.phone,
                        appointment_id: updatedAppointment.id,
                      }),
                    },
                    'Doctor appointment rescheduled successfully.',
                  );
                }
              }
            }
          }
        }
      } else if (fc.name === 'reschedule_lab_appointment') {
        const { data: currentAppointment, error: currentAppointmentError } = await supabase
          .from(DB_TABLES.labAppointments)
          .select('*')
          .eq('id', fc.args.appointment_id)
          .eq('patient_phone', patient.phone)
          .single();

        if (currentAppointmentError || !currentAppointment) {
          result = createToolError('LAB_APPOINTMENT_NOT_FOUND', currentAppointmentError?.message || 'Unable to find lab appointment to reschedule.');
        } else {
          const requestedTime =
            typeof fc.args.new_time === 'string' && fc.args.new_time.trim().length > 0
              ? new Date(fc.args.new_time).toISOString()
              : null;

          let slotQuery = supabase
            .from(DB_TABLES.labSlots)
            .select('*')
            .eq('lab_id', currentAppointment.lab_id)
            .eq('is_available', true);

          if (fc.args.slot_id) {
            slotQuery = slotQuery.eq('id', fc.args.slot_id);
          } else if (requestedTime) {
            slotQuery = slotQuery.eq('start_time', requestedTime);
          } else {
            result = createToolError('LAB_SLOT_REQUIRED', 'A real available slot is required before rescheduling. Please check lab slots first.');
            logToDebug('TOOL_CALL_FAILED', { tool_name: fc.name, duration_ms: Date.now() - startedAt, args: fc.args ?? {}, result });
            addActionLog(`${fc.name} failed: ${result.error.message}`, 'error');
            return result;
          }

          const { data: newSlot, error: newSlotError } = await slotQuery.single();

          if (newSlotError || !newSlot) {
            result = createToolError('LAB_SLOT_NOT_AVAILABLE', 'The requested new lab slot is not available. Please choose a real available slot.');
          } else {
            const { data: updatedAppointment, error: updateError } = await supabase
              .from(DB_TABLES.labAppointments)
              .update({ appointment_time: newSlot.start_time, status: 'scheduled' })
              .eq('id', fc.args.appointment_id)
              .eq('patient_phone', patient.phone)
              .select(`*, ${DB_TABLES.labs}(*)`)
              .single();

            if (updateError || !updatedAppointment) {
              result = createToolError('LAB_RESCHEDULE_FAILED', updateError?.message || 'Unable to reschedule lab appointment.');
            } else {
              const { error: releaseOldSlotError } = await supabase
                .from(DB_TABLES.labSlots)
                .update({ is_available: true, booked_by_phone: null, appointment_id: null })
                .eq('appointment_id', currentAppointment.id);

              if (releaseOldSlotError) {
                result = createToolError('LAB_OLD_SLOT_RELEASE_FAILED',
                  `Appointment was moved but the old slot could not be released: ${releaseOldSlotError.message}`,
                  { appointment: normalizeAppointmentRecord(updatedAppointment, 'lab') });
              } else {
                const { error: reserveNewSlotError } = await supabase
                  .from(DB_TABLES.labSlots)
                  .update({ is_available: false, booked_by_phone: patient.phone, appointment_id: updatedAppointment.id })
                  .eq('id', newSlot.id)
                  .eq('is_available', true);

                if (reserveNewSlotError) {
                  result = createToolError('LAB_NEW_SLOT_RESERVE_FAILED',
                    `Appointment was moved but the new slot could not be reserved: ${reserveNewSlotError.message}`,
                    { appointment: normalizeAppointmentRecord(updatedAppointment, 'lab'), slot: normalizeLabSlotRecord(newSlot) });
                } else {
                  await fetchData(patient.phone);
                  result = createToolSuccess(
                    { appointment: normalizeAppointmentRecord(updatedAppointment, 'lab'), slot: normalizeLabSlotRecord({ ...newSlot, is_available: false, booked_by_phone: patient.phone, appointment_id: updatedAppointment.id }) },
                    'Lab appointment rescheduled successfully.',
                  );
                }
              }
            }
          }
        }
      } else if (fc.name === 'hang_up') {
        addActionLog('Maya is concluding the call...', 'info');
        setTimeout(stopMaya, 3500);
        result = createToolSuccess({ ended: true }, 'Call ended.');
      } else {
        result = createToolError('TOOL_NOT_IMPLEMENTED', `Tool '${fc.name}' is not implemented by the app.`);
      }

      logToDebug(result.success ? 'TOOL_CALL_SUCCEEDED' : 'TOOL_CALL_FAILED', {
        tool_name: fc.name,
        duration_ms: Date.now() - startedAt,
        args: fc.args ?? {},
        result,
      });
      addActionLog(
        result.success ? `${fc.name} completed` : `${fc.name} failed: ${result.error.message}`,
        result.success ? 'tool' : 'error',
      );
      return result;
    } catch (error: any) {
      const result = createToolError('TOOL_EXECUTION_EXCEPTION', error?.message || 'Unexpected tool execution error.');
      logToDebug('TOOL_CALL_EXCEPTION', {
        tool_name: fc.name,
        args: fc.args ?? {},
        error_message: error?.message || 'Unknown error',
      });
      addActionLog(`${fc.name} failed unexpectedly`, 'error');
      return result;
    }
  }, [patient, logToDebug, addActionLog, fetchData, stopMaya]);

  const startMaya = async () => {
    if (isMayaActive || !patient) return;
    
    await fetchData(patient.phone);

    setIsMayaActive(true);
    setBotState('initiating');
    sessionActiveRef.current = true;
    sessionStartTimeRef.current = Date.now();
    sessionIdRef.current = Math.random().toString(36).slice(2);
    lastUserTranscriptAtRef.current = null;
    awaitingFirstResponseRef.current = false;
    lastTranscriptEventAtRef.current = sessionStartTimeRef.current;
    transcriptRef.current = [];
    logToDebug('SESSION_STARTED');
    
    try {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const inCtx = new AudioContextClass({ sampleRate: 16000 });
      const outCtx = new AudioContextClass({ sampleRate: 24000 });
      
      await inCtx.resume();
      await outCtx.resume();
      
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setBotState('speaking');
            logToDebug('WEBSOCKET_OPEN');
            addActionLog('Maya is connected and listening', 'info');
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(2048, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (!sessionActiveRef.current) return;
              const rawInput = e.inputBuffer.getChannelData(0);
              const resampledData = resample(rawInput, inCtx.sampleRate, 16000);
              const int16 = new Int16Array(resampledData.length);
              for (let i = 0; i < resampledData.length; i++) int16[i] = resampledData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ 
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } 
              }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);

            // Trigger Maya's greeting immediately so she speaks first before the user says anything
            sessionPromise.then(s => s.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: '__GREET__' }] }],
              turnComplete: true,
            }));
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.inputTranscription?.text) {
              const userText = msg.serverContent.inputTranscription.text;
              transcriptRef.current.push(`User: ${userText}`);
              lastUserTranscriptAtRef.current = Date.now();
              awaitingFirstResponseRef.current = true;
              setBotState('processing');
              addActionLog(`You said: ${userText}`, 'info');
              logToDebug('USER_TRANSCRIPTION_RECEIVED', { text: userText });
              accumulateTranscript('user', userText);
            }

            if (msg.serverContent?.outputTranscription?.text) {
              const mayaText = msg.serverContent.outputTranscription.text;
              transcriptRef.current.push(`Maya: ${mayaText}`);
              if (awaitingFirstResponseRef.current) {
                awaitingFirstResponseRef.current = false;
                recordToolLatency('FIRST_MODEL_RESPONSE_SENT', { text: mayaText });
              }
              logToDebug('MODEL_TRANSCRIPTION_RECEIVED', { text: mayaText });
              accumulateTranscript('maya', mayaText);
            }

            // turnComplete signals the end of a full conversational turn — flush accumulated transcripts
            if (msg.serverContent?.turnComplete) {
              flushPendingTurnTranscripts();
            }

            // User interrupted Maya mid-speech — stop all queued audio immediately
            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setBotState('listening');
              addActionLog('Interrupted by user', 'info');
            }

            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setBotState('speaking');
              if (awaitingFirstResponseRef.current) {
                awaitingFirstResponseRef.current = false;
                recordToolLatency('FIRST_AUDIO_RESPONSE_STARTED');
              }
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
              setBotState('processing');
              recordToolLatency('MODEL_REQUESTED_TOOL', { tool_count: msg.toolCall.functionCalls.length });
              for (const fc of msg.toolCall.functionCalls) {
                const result = await executeToolCall(fc);
                logToDebug('TOOL_RESPONSE_SENT', { tool_name: fc.name, result });
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: result } }));
              }
            }
          },
          onerror: (e) => {
            addActionLog('Voice session error occurred', 'error');
            logToDebug('WEBSOCKET_ERROR', { error: String((e as any)?.message || e) });
            stopMaya();
          },
          onclose: (e) => {
            logToDebug('WEBSOCKET_CLOSED', { code: (e as any)?.code, reason: (e as any)?.reason });
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
      stopMaya(); 
    }
  };

  const now = new Date();
  const upcoming = appointments.filter(a => new Date(a.appointment_time) >= now && a.status === 'scheduled');
  const past = appointments.filter(a => new Date(a.appointment_time) < now || a.status !== 'scheduled');

  // Pagination Logic
  const paginatedUpcoming = upcoming.slice((upcomingPage - 1) * ITEMS_PER_PAGE, upcomingPage * ITEMS_PER_PAGE);
  const totalUpcomingPages = Math.max(1, Math.ceil(upcoming.length / ITEMS_PER_PAGE));

  const paginatedPast = past.slice((pastPage - 1) * ITEMS_PER_PAGE, pastPage * ITEMS_PER_PAGE);
  const totalPastPages = Math.max(1, Math.ceil(past.length / ITEMS_PER_PAGE));

  if (!patient) return <div className="min-h-screen bg-white flex items-start justify-center"><PatientSetup onComplete={handlePatientLogin} /></div>;

  return (
    <div className="min-h-screen bg-[#FDFDFE] flex flex-col text-slate-900">
      <header className="sticky top-0 px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-white/95 backdrop-blur-sm shrink-0 z-50 shadow-sm">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-base font-black leading-tight">Maya Voice AI</h1>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hospital Receptionist</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-black">{patient.name}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{patient.phone}</p>
          </div>
          <button onClick={handleLogout} className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8 pb-32">
          <section className="relative">
            {!isMayaActive ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-lg flex flex-col md:flex-row items-center justify-between space-y-6 md:space-y-0 md:space-x-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex-1 text-center md:text-left">
                  <p className="text-[14px] text-slate-500 font-medium leading-normal max-w-xl">
                    Talk to Receptionist Maya to browse OPD, doctors, labs; schedule appointments or lab tests, manage visits.
                  </p>
                </div>
                <div className="shrink-0">
                  <button onClick={startMaya} className="flex items-center space-x-3 bg-slate-900 hover:bg-indigo-600 text-white px-8 py-4 rounded-xl font-black text-[17px] transition-all shadow-xl group">
                    <Mic className="w-5 h-5 group-hover:scale-110" />
                    <span>Talk to Maya</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-xl flex flex-col items-center justify-center space-y-8 animate-in zoom-in">
                <div className="scale-75 origin-center"><PulseOrb state={botState} /></div>
                <button onClick={stopMaya} className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest transition-all border border-rose-100">End Conversation</button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="space-y-4">
              <h3 className="text-lg font-black flex items-center px-1"><Calendar className="w-5 h-5 mr-2.5 text-indigo-600" /> Upcoming</h3>
              <div className="space-y-3">
                {isLoading ? <SkeletonCard /> : paginatedUpcoming.length === 0 ? <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold">No upcoming visits.</div> : 
                paginatedUpcoming.map(app => (
                  <div key={app.id} className="bg-white border border-slate-100 p-4 rounded-xl flex items-center justify-between hover:shadow-md transition-all group">
                    <div className="flex items-center space-x-4 min-w-0">
                      <div className="w-11 h-11 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">{app.lab_id ? <FlaskConical className="w-6 h-6" /> : <User className="w-6 h-6" />}</div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-900 text-[15px] truncate">{app.doctors?.name ? formatDoctorName(app.doctors.name, app.doctors.specialty) : app.labs?.test_name ? app.labs.test_name : 'Medical Visit'}</h4>
                        <p className="text-[11px] font-black text-indigo-600 uppercase mt-1">{formatFriendlyIST(app.appointment_time)}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {totalUpcomingPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-slate-50 mt-2">
                    <button 
                      onClick={() => setUpcomingPage(p => Math.max(1, p - 1))}
                      disabled={upcomingPage === 1}
                      className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 disabled:opacity-30 transition-all hover:bg-slate-50"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-tighter text-slate-400">Page {upcomingPage} of {totalUpcomingPages}</span>
                    <button 
                      onClick={() => setUpcomingPage(p => Math.min(totalUpcomingPages, p + 1))}
                      disabled={upcomingPage === totalUpcomingPages}
                      className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 disabled:opacity-30 transition-all hover:bg-slate-50"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </section>
            
            <section className="space-y-4">
              <h3 className="text-lg font-black text-slate-400 flex items-center px-1"><History className="w-5 h-5 mr-2.5" /> Past Records</h3>
              <div className="space-y-3">
                {isLoading ? <SkeletonCard /> : paginatedPast.length === 0 ? <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold opacity-50">No history found.</div> : 
                paginatedPast.map(app => (
                  <div key={app.id} className="bg-white/50 border border-slate-100 p-4 rounded-xl flex items-center justify-between opacity-75">
                    <div className="flex items-center space-x-4 min-w-0">
                      <div className="w-11 h-11 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">{app.status === 'cancelled' ? <AlertCircle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}</div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-600 text-[15px] truncate">{app.doctors?.name ? formatDoctorName(app.doctors.name, app.doctors.specialty) : app.labs?.test_name ? app.labs.test_name : 'Medical Visit'}</h4>
                        <p className="text-[11px] font-black text-slate-400 uppercase mt-1">{app.status.toUpperCase()} • {formatFriendlyIST(app.appointment_time)}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {totalPastPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-slate-50 mt-2">
                    <button 
                      onClick={() => setPastPage(p => Math.max(1, p - 1))}
                      disabled={pastPage === 1}
                      className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 disabled:opacity-30 transition-all hover:bg-slate-50"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-tighter text-slate-400">Page {pastPage} of {totalPastPages}</span>
                    <button 
                      onClick={() => setPastPage(p => Math.min(totalPastPages, p + 1))}
                      disabled={pastPage === totalPastPages}
                      className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 disabled:opacity-30 transition-all hover:bg-slate-50"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="space-y-5">
            <h3 className="text-lg font-black flex items-center px-1"><MessageSquare className="w-5 h-5 mr-2.5 text-indigo-600" /> Call Summaries</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {isLoading ? <SummarySkeletonCard /> : summaries.length === 0 ? <div className="col-span-full bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm font-bold">No summaries yet.</div> : 
              summaries.map(summary => (
                <div key={summary.call_id} className="bg-white border border-slate-100 p-5 rounded-xl space-y-3 hover:shadow-lg transition-all border-b-2 hover:border-indigo-200">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><MessageSquare className="w-3.5 h-3.5" /></div>
                    <p className="text-[10px] font-black text-slate-400 uppercase">{formatFriendlyIST(summary.start_time)}</p>
                  </div>
                  <p className="text-xs text-slate-700 font-medium italic leading-relaxed line-clamp-4">"{summary.call_summary}"</p>
                  <div className="flex items-center text-[9px] font-black text-slate-400 uppercase pt-1 border-t border-slate-50"><Timer className="w-3 h-3 mr-1.5" /> {summary.duration}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-50 group">
        <div className="absolute bottom-full right-0 mb-4 w-[320px] opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all translate-y-4 group-hover:translate-y-0">
          <div className="h-[350px] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden"><ActionLog logs={actionLogs} /></div>
        </div>
        <button className="bg-slate-900 text-white p-4 rounded-xl shadow-2xl hover:bg-indigo-600 transition-colors"><Activity className="w-5 h-5" /></button>
      </div>
    </div>
  );
};

export default App;
