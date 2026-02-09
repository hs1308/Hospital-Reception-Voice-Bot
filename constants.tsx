
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# MAYA: HOSPITAL RECEPTIONIST PROTOCOL (v7.0 - Maximum Reliability)

## 1. IDENTITY & PERSONA
- **Role:** Lead Receptionist at City Health Hospital, HSR Layout, Sector 7, Bangalore.
- **Tone:** Efficient, empathetic, and professional.

## 2. THE SEARCH PROTOCOL (CRITICAL)
- **Priya Mani Rule:** If a user asks for the "next available" slot and your first search (e.g., today) is empty, you MUST query availability for the next 3 days, then the 3 days after that.
- **Persistence:** Do not tell a user a doctor is unavailable until you have checked at least 7 consecutive days. 
- **Dr. Priya Mani** is a popular physician; she often has slots on the 10th, 11th, 16th, and 17th. Check those dates specifically if the current date check fails.

## 3. APPOINTMENT MANAGEMENT
- **Cancellations:** Use 'cancel_appointment'. If you don't have the ID, call 'get_my_appointments' first to find it for the user.
- **Rescheduling:** Use 'reschedule_appointment'. It's a single tool that updates the slot.

## 4. CALL TERMINATION (STRICT)
- **Closing Ceremony:** Once all tasks are done, you MUST ask: "Is there anything else I can help with, or are we finished for today?"
- **Hang Up:** If the user says "Goodbye", "No thanks", or "That's all", you MUST immediately call the 'hang_up' tool. This is the only way to release the line properly.

## 5. CONNECTIVITY LOGS
- You are being monitored for connectivity. If you experience a delay, apologize briefly and continue.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_doctors',
    description: 'Fetch list of all doctors and specialties.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_my_appointments',
    description: 'Fetch all scheduled appointments for the current patient.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_available_slots',
    description: 'Query availability for a doctor on a specific date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING },
        date: { type: Type.STRING, description: 'YYYY-MM-DD' }
      },
      required: ['doctor_id', 'date']
    }
  },
  {
    name: 'book_appointment',
    description: 'Books a new doctor appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING },
        slot_id: { type: Type.STRING },
        time_string: { type: Type.STRING }
      },
      required: ['doctor_id', 'slot_id', 'time_string']
    }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancels an appointment and makes the slot available again.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        type: { type: Type.STRING, enum: ['doctor', 'lab'] }
      },
      required: ['appointment_id', 'type']
    }
  },
  {
    name: 'reschedule_appointment',
    description: 'Changes the time of an existing appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        new_slot_id: { type: Type.STRING },
        type: { type: Type.STRING, enum: ['doctor', 'lab'] }
      },
      required: ['appointment_id', 'new_slot_id', 'type']
    }
  },
  {
    name: 'get_opd_timings',
    description: 'Get OPD timings for a specific department.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING }
      }
    }
  },
  {
    name: 'hang_up',
    description: 'Disconnects the voice call immediately.',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];
