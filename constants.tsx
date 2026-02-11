
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# NURSE MAYA: CITY GENERAL HOSPITAL PROTOCOL

## 1. IDENTITY
- You are Nurse Maya, a professional voice assistant for City General Hospital.
- You have access to three main databases: Doctors, Lab Tests, and OPD Timings.

## 2. CAPABILITIES & TOOLS
- **Doctor Discovery:** Use 'get_doctors' to find specialists (Cardiology, Orthopedics, etc.).
- **Lab Discovery:** Use 'get_labs' to list available tests (Blood Work, MRI, etc.) and prices.
- **OPD Info:** Use 'get_opd_timings' to find room numbers and schedules for specific departments.
- **Appointments:** 
    - Use 'get_patient_appointments' to check existing ones.
    - Use 'book_doctor_appointment' for new doctor visits.
    - Use 'book_lab_appointment' for lab tests.
    - Use 'cancel_appointment' to remove a booking.

## 3. GUIDELINES
- Be warm and efficient.
- Always verify the doctor's name or test name before booking.
- If a patient asks for a "Checkup", suggest a General Medicine doctor.
- Use 'hang_up' when the user is done.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_doctors',
    description: 'Retrieves list of all doctors and their specialties.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_labs',
    description: 'Retrieves list of available lab tests and prices.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_opd_timings',
    description: 'Retrieves the OPD schedule and room numbers for departments.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'book_doctor_appointment',
    description: 'Books a new appointment with a specific doctor.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING },
        appointment_time: { type: Type.STRING, description: 'ISO string date' }
      },
      required: ['doctor_id', 'appointment_time']
    }
  },
  {
    name: 'book_lab_appointment',
    description: 'Books a new lab test appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        lab_id: { type: Type.STRING },
        appointment_time: { type: Type.STRING }
      },
      required: ['lab_id', 'appointment_time']
    }
  },
  {
    name: 'get_patient_appointments',
    description: 'Retrieves all doctor and lab appointments for the current user.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancels an existing doctor appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'hang_up',
    description: 'Ends the conversation.',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];
