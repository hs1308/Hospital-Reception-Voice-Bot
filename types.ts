
export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  fee: number;
  bio?: string;
}

export interface DoctorSlot {
  id: string;
  doctor_id: string;
  start_time: string;
  is_available: boolean;
  booked_by_phone?: string;
  appointment_id?: string;
}

export interface LabSlot {
  id: string;
  lab_id: string;
  slot_time: string;
  is_available: boolean;
  booked_by_phone?: string;
  appointment_id?: string;
}

export interface Patient {
  phone: string;
  name: string;
  created_at: string;
}

export interface Lab {
  id: string;
  test_name: string;
  instructions: string;
  price: number;
}

export interface Appointment {
  id: string;
  patient_phone: string;
  doctor_id: string;
  appointment_time: string;
  status: 'scheduled' | 'cancelled' | 'completed';
}

export type BotState = 'idle' | 'listening' | 'speaking' | 'processing';

export interface ActionLog {
  id: string;
  timestamp: Date;
  message: string;
  type: 'tool' | 'info' | 'error';
}
