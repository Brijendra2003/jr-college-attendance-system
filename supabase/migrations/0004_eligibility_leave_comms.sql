-- 0004 Eligibility, defaulter notices, condonation, leave, notifications, announcements, imports
-- (web doc §8.3, §9.6–§9.7, §12.11, §12.15–§12.16, §13, §15).

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------
create table public.eligibility_snapshots (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students (id),
  academic_year_id  uuid not null references public.academic_years (id),
  division_id       uuid references public.divisions (id),
  as_of             date not null,
  kind              text not null check (kind in ('projected','final')),
  term1_percent     numeric(5,2),
  term2_percent     numeric(5,2),
  annual_percent    numeric(5,2),
  working_days      integer not null default 0,
  present_value     numeric(7,2) not null default 0,
  remaining_days    integer not null default 0,
  days_needed       integer,
  subject_results   jsonb not null default '[]',
  status            text not null check (status in
                      ('eligible','at_risk','short','condonation_pending','condoned','not_eligible')),
  created_at        timestamptz not null default now(),
  unique (student_id, academic_year_id, as_of, kind)
);
create index eligibility_latest_idx on public.eligibility_snapshots (student_id, academic_year_id, as_of desc);
create index eligibility_status_idx on public.eligibility_snapshots (academic_year_id, as_of, status);

create table public.condonation_cases (
  id                         uuid primary key default gen_random_uuid(),
  student_id                 uuid not null references public.students (id),
  academic_year_id           uuid not null references public.academic_years (id),
  shortfall_percent          numeric(5,2),
  ground                     text not null check (ground in ('state_national_sports','medical','other')),
  details                    text not null,
  document_asset_ids         uuid[] not null default '{}',
  status                     text not null default 'draft' check (status in
                               ('draft','recommended','submitted_to_board','condoned','rejected','withdrawn')),
  principal_recommendation   text,
  recommended_by             uuid references public.profiles (id),
  recommended_at             timestamptz,
  submitted_to_board_on      date,
  board_decision             text,
  board_decision_on          date,
  created_by                 uuid references public.profiles (id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (student_id, academic_year_id)
);
create trigger condonation_touch before update on public.condonation_cases
  for each row execute function app.touch_updated_at();
create trigger condonation_audit after insert or update or delete on public.condonation_cases
  for each row execute function app.audit_row();

create table public.defaulter_notices (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.students (id),
  division_id        uuid not null references public.divisions (id),
  level              text not null check (level in ('warning','second','final')),
  period_from        date not null,
  period_to          date not null,
  day_percent        numeric(5,2),
  subject_percents   jsonb not null default '[]',
  language           text not null default 'mr' check (language in ('en','mr','hi')),
  channel            text not null default 'both' check (channel in ('app','print','both')),
  pdf_asset_id       uuid references public.media_assets (id),
  issued_by          uuid not null references public.profiles (id),
  issued_at          timestamptz not null default now(),
  acknowledged_by    uuid references public.profiles (id),
  acknowledged_at    timestamptz,
  unique (student_id, level, period_to)
);
create index defaulter_notices_division_idx on public.defaulter_notices (division_id, issued_at desc);
create trigger defaulter_notices_audit after insert or update or delete on public.defaulter_notices
  for each row execute function app.audit_row();

create table public.parent_meetings (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id),
  division_id   uuid not null references public.divisions (id),
  met_on        date not null default app.today(),
  mode          text not null default 'in_person' check (mode in ('in_person','phone','video')),
  attendees     text,
  outcome       text not null,
  follow_up_on  date,
  logged_by     uuid not null references public.profiles (id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
create table public.leave_types (
  code                      text primary key,
  label                     text not null,
  label_mr                  text not null,
  status_code               text not null references public.attendance_status_codes (code),
  requires_document_after_days smallint,
  max_backdate_days         smallint not null default 3,
  is_active                 boolean not null default true
);

create table public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id),
  division_id      uuid references public.divisions (id),
  leave_type       text not null references public.leave_types (code),
  span             text not null default 'full_day' check (span in ('full_day','half_day','periods')),
  from_date        date not null,
  to_date          date not null,
  leave_period     tstzrange not null,
  session_ids      uuid[],
  reason           text not null,
  document_asset_ids uuid[] not null default '{}',
  applied_by_kind  text not null check (applied_by_kind in ('student','guardian','office')),
  applied_by       uuid not null references public.profiles (id),
  guardian_ack_by  uuid references public.profiles (id),
  guardian_ack_at  timestamptz,
  status           text not null default 'pending' check (status in
                     ('awaiting_guardian','pending','needs_info','approved','rejected','cancelled')),
  decided_by       uuid references public.profiles (id),
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  check (to_date >= from_date),
  constraint no_overlapping_leave exclude using gist (student_id with =, leave_period with &&)
    where (status in ('awaiting_guardian','pending','needs_info','approved'))
);
create index leave_requests_division_idx on public.leave_requests (division_id, status);

-- ---------------------------------------------------------------------------
-- Notifications (outbox pattern, web doc §15)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_outbox (
  id               bigint generated always as identity primary key,
  dedupe_key       text not null unique,
  event_type       text not null,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  channel          text not null default 'push' check (channel in ('push','email','sms','whatsapp')),
  payload          jsonb not null,
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed','dead','held')),
  attempts         smallint not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at) where status = 'queued';

create table public.notification_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  absence_mode     text not null default 'instant' check (absence_mode in ('instant','digest','off')),
  period_absence   boolean not null default false,
  shortage_alerts  boolean not null default true,
  email_enabled    boolean not null default true,
  sms_enabled      boolean not null default false,
  quiet_hours      boolean not null default true,
  updated_at       timestamptz not null default now()
);

create table public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  token         text not null unique,
  platform      text not null check (platform in ('android','ios')),
  app_version   text,
  device_id     text,
  last_seen_at  timestamptz not null default now(),
  disabled_at   timestamptz
);
create index device_tokens_user_idx on public.device_tokens (user_id) where disabled_at is null;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  title_mr     text,
  body_mr      text,
  priority     text not null default 'normal' check (priority in ('normal','high')),
  scope        text not null check (scope in ('college','stream','class','exam')),
  audience     jsonb not null,           -- {roles:[], standard_ids:[], stream_ids:[], division_ids:[], student_ids:[], parents_of:[]}
  status       text not null default 'draft' check (status in ('draft','scheduled','published','expired')),
  publish_at   timestamptz,
  expires_at   timestamptz,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);

create table public.announcement_recipients (
  announcement_id  uuid not null references public.announcements (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  delivered_at     timestamptz,
  read_at          timestamptz,
  primary key (announcement_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Imports and government exports
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('students','cap_list','staff','assignments','timetable','hsc_seat_numbers')),
  file_name    text,
  options      jsonb not null default '{}',
  status       text not null default 'staged' check (status in ('staged','validated','committed','failed','discarded')),
  summary      jsonb,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  committed_at timestamptz
);

create table public.import_rows (
  job_id   uuid not null references public.import_jobs (id) on delete cascade,
  row_no   integer not null,
  data     jsonb not null,
  errors   jsonb not null default '[]',
  outcome  text,                                    -- new | existing | conflict | error
  entity_id uuid,
  primary key (job_id, row_no)
);

create table public.govt_exports (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                       -- saral | udise_apaar | mahadbt | readiness
  filters      jsonb not null default '{}',
  row_count    integer not null,
  exported_by  uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);
