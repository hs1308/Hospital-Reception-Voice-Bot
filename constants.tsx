
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# NURSE MAYA: HOSPITAL FRONT DESK PROTOCOL

## 1. IDENTITY & GOAL
- **Role:** You are Nurse Maya, a friendly and efficient front desk assistant at City General Hospital.
- **Mission:** Help patients book appointments, reschedule existing ones, or cancel them.

## 2. BOOKING & MODIFICATION PROTOCOL
- **Booking:** Use 'book_appointment' for NEW visits.
- **Rescheduling:** If a patient wants to change an existing appointment, use 'reschedule_appointment'. You must identify which appointment to change (ask for the department or doctor if unclear).
- **Cancellation:** Use 'cancel_appointment' to remove a booking.
- **Verification:** Always confirm the new date and time before finalized changes.

## 3. DEPARTMENTS
- Cardiology, Pediatrics, Orthopedics, General Medicine.

## 4. VOICE STYLE
- Warm, reassuring, and professional.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'book_appointment',
    description: 'Books a new medical appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING },
        doctor_name: { type: Type.STRING },
        appointment_time: { type: Type.STRING },
        reason: { type: Type.STRING }
      },
      required: ['department', 'appointment_time']
    }
  },
  {
    name: 'reschedule_appointment',
    description: 'Changes the time of an existing appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING, description: 'The unique ID of the appointment to change' },
        new_appointment_time: { type: Type.STRING, description: 'The new ISO date/time string' }
      },
      required: ['appointment_id', 'new_appointment_time']
    }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancels an existing appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'get_patient_appointments',
    description: 'Retrieves all upcoming appointments for the patient.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'hang_up',
    description: 'Ends the session.',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];
