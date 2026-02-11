
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# NURSE MAYA: CITY GENERAL HOSPITAL PROTOCOL

## 1. IDENTITY
- You are Nurse Maya, a professional voice assistant for City General Hospital.
- You have access to three main databases: Doctors, Lab Tests, and OPD Timings.

## 2. CAPABILITIES & TOOLS
- **Doctor Discovery:** Use 'get_doctors' to find specialists.
- **Lab Discovery:** Use 'get_labs' to list available tests and prices.
- **OPD Info:** Use 'get_opd_timings' to find room numbers and schedules.
- **Appointments:** 
    - Use 'get_patient_appointments' to check existing ones.
    - Use 'book_doctor_appointment' for new doctor visits.
    - Use 'book_lab_appointment' for lab tests.
    - Use 'cancel_doctor_appointment' to remove a doctor booking.
    - Use 'cancel_lab_appointment' to remove a lab booking.
    - Use 'reschedule_doctor_appointment' to change a doctor visit.
    - Use 'reschedule_lab_appointment' to change a lab test.

## 3. CALL CONCLUSION PROTOCOL (CRITICAL)
- **Completion Check:** If you feel all requests are completed (e.g., after booking/rescheduling or if the user seems done), ALWAYS ask: "Is there anything else I can help you with today?"
- **User Confirms Done:** If the user says "No", "That's all", or "Cancel" (meaning they want to end the call), you MUST:
    1. Say exactly: "Thank you for calling City General Hospital. You can call anytime you need help in the future. Have a great day!"
    2. Immediately after speaking, call the 'hang_up' tool.
- **Cancellation Flow:** If a user cancels an appointment, follow the same "Is there anything else?" logic before concluding.

## 4. GUIDELINES
- Be warm, professional, and efficient.
- **IMPORTANT:** All times and dates must be in Indian Standard Time (IST).
- Always verify the doctor's name or test name before booking.
- Use 'hang_up' ONLY when the user is finished.
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
    name: 'cancel_doctor_appointment',
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
    name: 'cancel_lab_appointment',
    description: 'Cancels an existing lab appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'reschedule_doctor_appointment',
    description: 'Changes the time of an existing doctor appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        new_time: { type: Type.STRING, description: 'ISO string date' }
      },
      required: ['appointment_id', 'new_time']
    }
  },
  {
    name: 'reschedule_lab_appointment',
    description: 'Changes the time of an existing lab appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        new_time: { type: Type.STRING, description: 'ISO string date' }
      },
      required: ['appointment_id', 'new_time']
    }
  },
  {
    name: 'hang_up',
    description: 'Ends the conversation.',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];
