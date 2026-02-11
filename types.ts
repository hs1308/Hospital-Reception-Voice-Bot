
export interface Patient {
  id: string;
  phone: string;
  name: string;
  created_at?: string;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_name: string;
  department: string;
  appointment_time: string;
  reason?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}

export interface DebugLog {
  id?: string;
  patient_id?: string;
  message: string;
  type: 'tool' | 'info' | 'error';
  timestamp: string;
}

export interface ChatSummary {
  id?: string;
  patient_id: string;
  summary: string;
  duration_seconds: number;
  timestamp: string;
}

export type BotState = 'idle' | 'initiating' | 'listening' | 'speaking' | 'processing';

export interface ActionLog {
  id: string;
  timestamp: Date;
  message: string;
  type: 'tool' | 'info' | 'error';
}
