-- ============================================================
-- AI Voice Trainer LMS — Supabase (Postgres) schema
-- Run this once in the Supabase SQL Editor.
-- All access goes through Netlify Functions using the service
-- role key; RLS is enabled with no public policies so the anon
-- key can never read these tables.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Admins ----------
create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- ---------- App settings (key/value) ----------
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Courses ----------
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled course',
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  current_version int not null default 0,
  expected_duration_minutes int not null default 45,
  inactivity_warning_seconds int not null default 120,
  inactivity_stop_seconds int not null default 300,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Slides (draft/authoring state) ----------
create table if not exists slides (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  slide_number int not null,
  title text not null default '',
  learning_objective text not null default '',
  key_message text not null default '',
  teaching_points text not null default '',
  restricted_statements text not null default '',
  assessment_mode text not null default 'mixed' check (assessment_mode in ('ai','admin','mixed')),
  passing_score int not null default 60 check (passing_score between 0 and 100),
  max_attempts int not null default 2 check (max_attempts between 1 and 5),
  active boolean not null default true,
  display_order int not null default 0,
  asset_key text,
  asset_mime text,
  knowledge_key text,
  knowledge_mime text,
  knowledge_filename text,
  knowledge_status text not null default 'not_uploaded'
    check (knowledge_status in ('not_uploaded','processing','ready','failed','needs_review','published')),
  knowledge_error text,
  updated_at timestamptz not null default now(),
  unique (course_id, slide_number)
);

-- ---------- Slide assessment questions (authoring) ----------
create table if not exists slide_questions (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references slides(id) on delete cascade,
  position int not null check (position between 1 and 3),
  question_type text not null check (question_type in ('recall','understanding','application')),
  question text not null default '',
  expected_answer text not null default '',
  keywords text[] not null default '{}',
  unique (slide_id, position)
);

-- ---------- Published course versions (immutable snapshots) ----------
create table if not exists course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,          -- PublishedCourseSnapshot
  published_at timestamptz not null default now(),
  unique (course_id, version)
);

-- ---------- Learners ----------
create table if not exists learners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  designation text not null,
  headquarter text not null,
  employee_code text,
  created_at timestamptz not null default now()
);

-- ---------- Learner sessions (one run through a course version) ----------
create table if not exists learner_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references learners(id) on delete cascade,
  course_id uuid not null references courses(id),
  course_version_id uuid not null references course_versions(id),
  status text not null default 'registered'
    check (status in ('registered','in_progress','completed','expired')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_elapsed_seconds int not null default 0,
  active_seconds int not null default 0,
  inactive_seconds int not null default 0,
  current_slide_id uuid,
  resume_state jsonb not null default '{}',
  last_activity_at timestamptz not null default now()
);
create index if not exists idx_sessions_course on learner_sessions(course_id, started_at desc);

-- ---------- Per-slide progress ----------
create table if not exists slide_progress (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references learner_sessions(id) on delete cascade,
  slide_id uuid not null,            -- slide_id within the version snapshot
  state text not null default 'not_started'
    check (state in ('not_started','explanation_in_progress','explanation_completed',
                     'assessment_pending','assessment_in_progress','corrective_required',
                     'assessment_completed','slide_completed')),
  explanation_completed_at timestamptz,
  best_score numeric,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (session_id, slide_id)
);

-- ---------- Assessment attempts ----------
create table if not exists assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references learner_sessions(id) on delete cascade,
  slide_id uuid not null,
  question_position int not null check (question_position between 1 and 3),
  attempt_number int not null default 1,
  is_corrective boolean not null default false,
  question text not null,
  answer_transcript text not null,
  analysis jsonb,
  score numeric,
  passed boolean,
  feedback text,
  created_at timestamptz not null default now()
);
create index if not exists idx_attempts_session on assessment_attempts(session_id, slide_id);

-- ---------- Transcripts (hidden full transcript) ----------
create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references learner_sessions(id) on delete cascade,
  slide_id uuid,
  role text not null check (role in ('trainer','learner')),
  kind text not null check (kind in ('teaching','question','answer','system')),
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_transcripts_session on transcripts(session_id, created_at);

-- ---------- Ratings ----------
create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references learner_sessions(id) on delete cascade,
  overall int not null check (overall between 1 and 5),
  clarity int not null check (clarity between 1 and 5),
  usefulness int not null check (usefulness between 1 and 5),
  feedback text,
  created_at timestamptz not null default now()
);

-- ---------- Audit log ----------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references admins(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- Rate limiting ----------
create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- ---------- Lock everything down (service role bypasses RLS) ----------
alter table admins enable row level security;
alter table app_settings enable row level security;
alter table courses enable row level security;
alter table slides enable row level security;
alter table slide_questions enable row level security;
alter table course_versions enable row level security;
alter table learners enable row level security;
alter table learner_sessions enable row level security;
alter table slide_progress enable row level security;
alter table assessment_attempts enable row level security;
alter table transcripts enable row level security;
alter table ratings enable row level security;
alter table audit_log enable row level security;
alter table rate_limits enable row level security;

-- ---------- Atomic rate-limit helper ----------
create or replace function bump_rate_limit(p_key text, p_window_seconds int)
returns int language plpgsql as $$
declare v_count int;
begin
  insert into rate_limits(key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    count = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else rate_limits.count + 1 end,
    window_start = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else rate_limits.window_start end
  returning count into v_count;
  return v_count;
end $$;
