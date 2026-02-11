
export interface Patient {
  phone: string;
  name: string;
  created_at?: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  bio: string;
  fee: number;
}

export interface Lab {
  id: string;
  test_name: string;
  price: number;
  instructions: string;
}

export interface Appointment {
  id: string;
  patient_phone: string;
  doctor_id?: string;
  lab_id?: string;
  appointment_time: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  // Joined fields for UI
  doctors?: Doctor;
  labs?: Lab;
}

export interface ChatSummary {
  call_id: string;
  user_number: string;
  user_name: string;
  call_summary: string;
  duration: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

export type BotState = 'idle' | 'initiating' | 'listening' | 'speaking' | 'processing';

export interface ActionLog {
  id: string;
  timestamp: Date;
  message: string;
  type: 'tool' | 'info' | 'error';
}
