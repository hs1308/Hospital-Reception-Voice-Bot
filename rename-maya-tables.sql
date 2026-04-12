begin;

alter table if exists public.patients rename to maya_patients;
alter table if exists public.doctors rename to maya_doctors;
alter table if exists public.labs rename to maya_labs;
alter table if exists public.opd_timings rename to maya_opd_timings;
alter table if exists public.doctor_appointments rename to maya_doctor_appointments;
alter table if exists public.lab_appointments rename to maya_lab_appointments;
alter table if exists public.user_call_summary rename to maya_user_call_summary;

commit;

