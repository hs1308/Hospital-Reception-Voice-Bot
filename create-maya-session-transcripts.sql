create table if not exists public.maya_session_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  speaker text not null check (speaker in ('user', 'maya')),
  patient_phone text not null,
  patient_name text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  language text,
  transcript text not null,
  created_at timestamptz not null default now()
);

create index if not exists maya_session_transcripts_session_id_idx
  on public.maya_session_transcripts (session_id, created_at);

create index if not exists maya_session_transcripts_patient_phone_idx
  on public.maya_session_transcripts (patient_phone, created_at desc);

