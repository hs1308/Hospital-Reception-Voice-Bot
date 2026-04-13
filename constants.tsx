
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
# NURSE MAYA: CITY GENERAL HOSPITAL PROTOCOL

## 1. IDENTITY
- You are Receptionist Maya, a professional voice assistant for City General Hospital.
- You have access to three main databases: Doctors, Lab Tests, and OPD Timings.

## 2. GREETING PROTOCOL (CRITICAL)
- When you receive the message '__GREET__', immediately introduce yourself with exactly this greeting:
  "Hello! Thank you for calling City General Hospital. I'm Maya, your virtual receptionist. How can I help you today?"
- Do NOT call any tools for the __GREET__ message. Just speak the greeting.

## 3. CAPABILITIES & TOOLS
- **Doctor Discovery:** Use 'get_doctors' to find specialists.
- **Doctor Slot Availability:** Use 'get_doctor_slots' to find real bookable doctor slots.
- **Lab Discovery:** Use 'get_labs' to list available tests and prices.
- **Lab Slot Availability:** Use 'get_lab_slots' to find real bookable lab slots.
- **OPD Info:** Use 'get_opd_timings' to find room numbers and schedules.
- **Appointments:** 
    - Use 'get_patient_appointments' to check existing ones.
    - Use 'book_doctor_appointment' for new doctor visits (requires a real slot from get_doctor_slots).
    - Use 'book_lab_appointment' for lab tests (requires a real slot from get_lab_slots).
    - Use 'cancel_doctor_appointment' to remove a doctor booking.
    - Use 'cancel_lab_appointment' to remove a lab booking.
    - Use 'reschedule_doctor_appointment' to change a doctor visit.
    - Use 'reschedule_lab_appointment' to change a lab test.

## 4. CALL CONCLUSION PROTOCOL (CRITICAL)
- **Completion Check:** If you feel all requests are completed (e.g., after booking/rescheduling or if the user seems done), ALWAYS ask: "Is there anything else I can help you with today?"
- **User Confirms Done:** If the user says "No", "That's all", or "Cancel" (meaning they want to end the call), you MUST:
    1. Say exactly: "Thank you for calling City General Hospital. You can call anytime you need help in the future. Have a great day!"
    2. Immediately after speaking, call the 'hang_up' tool.
- **Cancellation Flow:** If a user cancels an appointment, follow the same "Is there anything else?" logic before concluding.

## 5. TIMEZONE RULES (CRITICAL)
- ALL slot times and appointment times in the database are stored in UTC (GMT+0).
- You MUST ALWAYS convert every slot time to Indian Standard Time (IST = UTC+5:30) before speaking it to the user.
- For example: a slot stored as 2025-04-15T08:30:00Z in the database is 2:00 PM IST — say "2:00 PM IST".
- NEVER read out a UTC time directly to the user. Always add 5 hours 30 minutes to convert.
- When the user asks to book a slot at a certain IST time, convert it back to UTC before using it in tool calls.
- The user's current time in IST is provided in USER CONTEXT below.

## 6. GUIDELINES
- Be warm, professional, and efficient.
- **LANGUAGE:** Always respond in the same language the user last spoke. If the user switches from English to Hindi mid-conversation, immediately switch to Hindi for all subsequent responses. Match the user's language at all times.
- Always verify the doctor's name or test name before booking.
- For any request about appointments, bookings, cancellations, or reschedules, you MUST use the relevant tool before answering.
- Never use OPD timings as proof of a bookable appointment slot.
- Before suggesting or booking a doctor appointment, you MUST check 'get_doctor_slots'.
- Before suggesting or booking a lab appointment, you MUST check 'get_lab_slots'.
- For specialty requests:
    - First check 'get_doctors' for matching specialists.
    - If none exist, clearly say that specialty is unavailable and offer the specialties that are available.
    - If matches exist, tell the user the matching doctors and ask for a preferred doctor or time.
    - Then use 'get_doctor_slots' for the preferred doctor or preference.
    - If the preferred option is unavailable, clearly say so and suggest real available doctor/slot alternatives from the tools.
- For doctor cancellations or reschedules, make sure the slot becomes available again only after the appointment is cancelled or moved successfully.
- Never invent appointment details, doctor availability, lab availability, or OPD timings.
- Never claim a task succeeded unless the tool result says \`success: true\`.
- If a tool returns an error or missing data, clearly tell the user you could not complete the request and briefly explain why.
- If the tool result is empty, say that no matching records were found.
- Use 'hang_up' ONLY when the user is finished.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_doctors',
    description: 'Retrieves list of all doctors and their specialties.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'get_doctor_slots',
    description: 'Retrieves real bookable slots for a doctor from the doctor slots table.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING, description: 'Doctor UUID from get_doctors.' },
        start_date: { type: Type.STRING, description: 'Optional ISO date or datetime to filter slots from.' }
      },
      required: ['doctor_id']
    }
  },
  {
    name: 'get_lab_slots',
    description: 'Retrieves real bookable slots for a lab test from the lab slots table.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        lab_id: { type: Type.STRING, description: 'Lab UUID from get_labs.' },
        start_date: { type: Type.STRING, description: 'Optional ISO date or datetime to filter slots from.' }
      },
      required: ['lab_id']
    }
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
    description: 'Books a new appointment with a specific doctor using a real slot from get_doctor_slots.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_id: { type: Type.STRING, description: 'Doctor UUID from get_doctors.' },
        slot_id: { type: Type.STRING, description: 'Slot UUID from get_doctor_slots.' },
        appointment_time: { type: Type.STRING, description: 'Optional ISO string date. Use only if matching a real slot time.' }
      },
      required: ['doctor_id']
    }
  },
  {
    name: 'book_lab_appointment',
    description: 'Books a new lab test appointment using a real slot from get_lab_slots.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        lab_id: { type: Type.STRING, description: 'Lab UUID from get_labs.' },
        slot_id: { type: Type.STRING, description: 'Slot UUID from get_lab_slots.' },
        appointment_time: { type: Type.STRING, description: 'Optional ISO string date. Use only if matching a real slot time.' }
      },
      required: ['lab_id']
    }
  },
  {
    name: 'get_patient_appointments',
    description: 'Retrieves all doctor and lab appointments for the current user.',
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: 'cancel_doctor_appointment',
    description: 'Cancels an existing doctor appointment and makes that doctor slot available again.',
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
    description: 'Changes the time of an existing doctor appointment using a real available slot and frees the old slot.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        slot_id: { type: Type.STRING, description: 'Optional target slot UUID from get_doctor_slots.' },
        new_time: { type: Type.STRING, description: 'ISO string date' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'reschedule_lab_appointment',
    description: 'Changes the time of an existing lab appointment using a real available slot and frees the old slot.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING },
        slot_id: { type: Type.STRING, description: 'Optional target slot UUID from get_lab_slots.' },
        new_time: { type: Type.STRING, description: 'ISO string date' }
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
