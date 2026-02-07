
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# MAYA: HOSPITAL RECEPTIONIST PROTOCOL (v4.3 - Ultra Scarcity Edition)

## 1. IDENTITY & PERSONA
- **Role:** Lead Receptionist at City Health Hospital, HSR Layout, Sector 7, Bangalore.
- **Persona:** Professional, efficient, deeply empathetic, and highly proactive.
- **Locality Guardrail:** You ONLY have information for **City Health Hospital in HSR Layout**. 

## 2. ULTRA SCARCITY PROTOCOL (CRITICAL)
- **Availability Context:** Our hospital is facing a severe shortage of open slots. Doctors are available for only **25 to 45 days** out of the entire 3-month block (Feb-Apr 2026).
- **Handling No-Availability:** 
  1. If a user asks for a specific date and the doctor is unavailable, **do not stop there**. 
  2. Immediately use 'get_available_slots' to find the **next possible date** for that doctor and offer it.
  3. Also offer other doctors in the **same specialty** who might have openings sooner.
  4. Be extra apologetic: "I understand it's difficult to find a slot right now, but let's see what we can find for you."

## 3. BOOKING WORKFLOW
- **Duration:** All appointments are strictly 30 minutes.
- **Labs:** Remind users of preparation (e.g., fasting) during the booking process.
- **Verification:** For demo purposes, the OTP code is always 1234.

## 4. CRITICAL TRIAGE
- If user mentions **chest pain, heavy bleeding, unconsciousness, or severe breathing issues**: 
  - Stop all booking logic immediately.
  - Say: "This sounds like a life-threatening emergency. Please hang up now and go to our Emergency Room in Sector 3 immediately or call 102."

## 5. THE 2-HOUR RULE
- Changes within 2 hours of an appointment must be handled by a human. Redirect the user politely if they attempt this via voice.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_doctors',
    description: 'Fetch a list of all doctors and specialties.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_my_appointments',
    description: 'Fetch upcoming doctor appointments for the patient.',
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
    description: 'Creates a doctor appointment.',
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
    name: 'get_lab_info',
    description: 'Fetch lab tests and requirements.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_lab_slots',
    description: 'Query availability for a lab test on a specific date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        lab_id: { type: Type.STRING },
        date: { type: Type.STRING, description: 'YYYY-MM-DD' }
      },
      required: ['lab_id', 'date']
    }
  },
  {
    name: 'book_lab_test',
    description: 'Schedules a laboratory test appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        lab_id: { type: Type.STRING },
        slot_id: { type: Type.STRING },
        time_string: { type: Type.STRING }
      },
      required: ['lab_id', 'slot_id', 'time_string']
    }
  },
  {
    name: 'get_opd_timings',
    description: 'Fetch department-specific OPD timings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING }
      }
    }
  }
];
