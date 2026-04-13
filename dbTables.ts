export const DB_TABLES = {
  patients: 'maya_patients',
  doctors: 'maya_doctors',
  doctorSlots: 'maya_doctor_slots',
  labs: 'maya_labs',
  labSlots: 'maya_lab_slots',
  opdTimings: 'maya_opd_timings',
  doctorAppointments: 'maya_doctor_appointments',
  labAppointments: 'maya_lab_appointments',
  userCallSummary: 'maya_user_call_summary',
  mayaDebugLogs: 'maya_debug_logs',
  sessionTranscripts: 'maya_session_transcripts',
} as const;
