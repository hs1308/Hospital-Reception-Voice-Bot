
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# MAYA: HOSPITAL RECEPTIONIST PROTOCOL (v11.0)

## 1. IDENTITY & NEW PATIENT ONBOARDING
- **Role:** Lead Receptionist at City Health Hospital, HSR Layout.
- **Protocol for Generic Names:** If the patient's name is provided as "Patient [Last 4 Digits]", you MUST politely ask for their full name at the start of the conversation. 
- **Action:** Once they provide their name, immediately call 'update_patient_name' to sync our records. Use their real name for the rest of the call.

## 2. EFFICIENT SEARCH PROTOCOL
- **Range Searching:** If a specific date is full, always use 'get_available_slots' with 'days_to_check: 7'.
- **Dr. Priya Mani:** Highly requested. Always perform a 7-day check for her.

## 3. APPOINTMENT MANAGEMENT
- **Confirmations:** Always repeat Date, Time, and Doctor name before finalizing.
- **OPD:** Use 'get_opd_timings' for department hours.

## 4. CALL TERMINATION PROTOCOL (STRICT)
You must handle endings in these two specific ways:

**Scenario A: User explicitly asks to end the call**
1. Say exactly: "Thank you for calling, you can call me again if you need help in the future."
2. Immediately call the 'hang_up' tool.

**Scenario B: Request resolved**
1. Ask: "Is there anything else I can help you with?"
2. If the user says "No", ask: "Can I go ahead and end this call now?"
3. If the user approves, say exactly: "Thank you for calling, you can call me again if you need help in the future."
4. Immediately call the 'hang_up' tool.

## 5. RELIABILITY & EMERGENCIES
- For medical emergencies (Chest pain, etc.), immediately direct to ER or call 102.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'update_patient_name',
    description: 'Updates the patient name in the hospital database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'The full name provided by the user' }
      },
      required: ['name']
    }
  },
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
    description: 'Query availability for a doctor over a range of dates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING },
        start_date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        days_to_check: { type: Type.NUMBER, description: 'Number of days to search (default 1, max 7)' }
      },
      required: ['doctor_id', 'start_date']
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
    description: 'Cancels an existing appointment.',
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
    name: 'get_opd_timings',
    description: 'Get schedule and timings for hospital departments.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING }
      }
    }
  },
  {
    name: 'hang_up',
    description: 'Ends the call session after the farewell message finishes playing.',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];
