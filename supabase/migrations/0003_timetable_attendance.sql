-- 0003 Timetable, sessions and the two-layer attendance engine tables (web doc §8.3, §9).

-- ---------------------------------------------------------------------------
-- Timetable and sessions
-- ---------------------------------------------------------------------------
create table public.timetable_versions (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years (id),
  term_id           uuid not null references public.academic_terms (id),
  standard_id       uuid not null references public.standards (id),
  stream_id         uuid not null references public.streams (id),
  name              text not null,
  status            text not null default 'draft' check (status in ('draft','published','archived')),
  effective_from    date not null,
  published_at      timestamptz,
  published_by      uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);

create table public.timetable_slots (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references public.timetable_versions (id) on delete cascade,
  weekday            smallint not null check (weekday between 1 and 6),   -- ISO, Mon–Sat
  period_no          smallint not null,
  starts_at          time not null,
  ends_at            time not null,
  teaching_group_id  uuid not null references public.teaching_groups (id),
  room_id            uuid references public.rooms (id),
  session_type       text not null default 'theory' check (session_type in ('theory','practical','oral','pe')),
  staff_id           uuid references public.staff (id)
);
create index timetable_slots_version_idx on public.timetable_slots (version_id);

create table public.class_sessions (
  id                 uuid primary key default gen_random_uuid(),
  session_date       date not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  teaching_group_id  uuid not null references public.teaching_groups (id),
  offering_id        uuid not null references public.subject_offerings (id),
  component          text not null check (component in ('TH','PR','OR')),
  session_type       text not null default 'theory' check (session_type in
                       ('theory','practical','oral','extra','remedial','pe')),
  room_id            uuid references public.rooms (id),
  status             text not null default 'scheduled' check (status in ('scheduled','held','cancelled','rescheduled')),
  status_reason      text,
  source_slot_id     uuid references public.timetable_slots (id) on delete set null,
  rescheduled_to_id  uuid references public.class_sessions (id),
  attendance_weight  numeric(4,2) not null default 1,
  -- denormalised for RLS and reporting
  division_id        uuid references public.divisions (id),
  stream_id          uuid not null references public.streams (id),
  standard_id        uuid not null references public.standards (id),
  term_id            uuid not null references public.academic_terms (id),
  created_at         timestamptz not null default now()
);
create index class_sessions_date_stream_idx on public.class_sessions (session_date, stream_id);
create index class_sessions_group_date_idx on public.class_sessions (teaching_group_id, session_date);

create table public.session_staff (
  session_id  uuid not null references public.class_sessions (id) on delete cascade,
  staff_id    uuid not null references public.staff (id),
  role        text not null default 'primary' check (role in ('primary','co','substitute')),
  primary key (session_id, staff_id)
);
create index session_staff_staff_idx on public.session_staff (staff_id);

-- ---------------------------------------------------------------------------
-- Status codes and policies
-- ---------------------------------------------------------------------------
create table public.attendance_status_codes (
  code                text primary key,
  label               text not null,
  label_mr            text not null,
  color               text not null,
  scope               text not null check (scope in ('day','period','both')),
  day_value           numeric(3,2) not null default 0,
  counts_as_attended  boolean not null,
  counts_in_held      boolean not null default true,
  teacher_can_set     boolean not null default true,
  requires_reason     boolean not null default false,
  sort_order          smallint not null default 0
);

create table public.attendance_policies (
  id                           uuid primary key default gen_random_uuid(),
  scope_kind                   text not null default 'college' check (scope_kind in ('college','standard','stream','subject')),
  scope_id                     uuid,
  min_percent                  numeric(5,2) not null default 75,
  warn_percent                 numeric(5,2) not null default 80,
  eligibility_basis            text not null default 'working_days' check (eligibility_basis in
                                 ('working_days','per_subject','per_subject_component','working_days_and_subject')),
  term_rule                    text not null default 'annual' check (term_rule in ('annual','each_term')),
  day_source                   text not null default 'roll_call' check (day_source in
                                 ('roll_call','derived','biometric','biometric_confirmed_by_roll_call')),
  derived_day_rule             jsonb not null default '{"present_min": 50, "half_day_min": 25}',
  count_from                   text not null default 'enrollment_start' check (count_from in ('enrollment_start','term_start')),
  default_unmarked_status      text not null default 'A' references public.attendance_status_codes (code),
  edit_window_hours            smallint not null default 12,
  lock_after_hours             smallint not null default 48,
  month_close_working_day      smallint not null default 3,
  leave_requires_guardian_ack  boolean not null default true,
  leave_applies_retroactively  boolean not null default false,
  effective_from               date not null default app.today(),
  effective_to                 date,
  created_at                   timestamptz not null default now(),
  check ((scope_kind = 'college') = (scope_id is null)),
  check (warn_percent >= min_percent)
);
create trigger attendance_policies_audit after insert or update or delete on public.attendance_policies
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Day register (board "working days" basis)
-- ---------------------------------------------------------------------------
create table public.day_registers (
  id                    uuid primary key default gen_random_uuid(),
  division_id           uuid not null references public.divisions (id),
  att_date              date not null,
  term_id               uuid not null references public.academic_terms (id),
  state                 text not null default 'pending' check (state in ('pending','submitted','locked','reopened','voided')),
  source                text not null default 'roll_call' check (source in ('roll_call','derived','biometric')),
  version               integer not null default 0,
  first_submitted_at    timestamptz,
  submitted_by          uuid references public.profiles (id),
  submitted_at          timestamptz,
  client_marked_at      timestamptz,
  device_id             text,
  locked_at             timestamptz,
  reopened_until        timestamptz,
  month_closed          boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_day_register unique (division_id, att_date)
);
create index day_registers_pending_idx on public.day_registers (att_date) where state = 'pending';
create index day_registers_term_idx on public.day_registers (term_id, division_id);
create trigger day_registers_touch before update on public.day_registers
  for each row execute function app.touch_updated_at();

create table public.day_attendance (
  id               uuid primary key default gen_random_uuid(),
  day_register_id  uuid not null references public.day_registers (id),
  student_id       uuid not null references public.students (id),
  status_code      text not null references public.attendance_status_codes (code),
  source           text not null default 'roll_call' check (source in
                     ('roll_call','derived','biometric','leave','correction','override','default')),
  marked_by        uuid references public.profiles (id),
  marked_at        timestamptz not null default now(),
  -- snapshot
  division_id      uuid not null references public.divisions (id),
  stream_id        uuid not null references public.streams (id),
  standard_id      uuid not null references public.standards (id),
  term_id          uuid not null references public.academic_terms (id),
  att_date         date not null,
  constraint uq_day_attendance unique (day_register_id, student_id)
);
create index day_attendance_student_date_idx on public.day_attendance (student_id, att_date);
create index day_attendance_division_date_idx on public.day_attendance (division_id, att_date);

-- ---------------------------------------------------------------------------
-- Period register (subject basis)
-- ---------------------------------------------------------------------------
create table public.attendance_registers (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null unique references public.class_sessions (id),
  state               text not null default 'pending' check (state in ('pending','submitted','locked','reopened','voided')),
  version             integer not null default 0,
  first_submitted_at  timestamptz,
  submitted_by        uuid references public.profiles (id),
  submitted_at        timestamptz,
  client_marked_at    timestamptz,
  device_id           text,
  locked_at           timestamptz,
  reopened_until      timestamptz,
  month_closed        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index attendance_registers_pending_idx on public.attendance_registers (created_at) where state = 'pending';
create trigger attendance_registers_touch before update on public.attendance_registers
  for each row execute function app.touch_updated_at();

create table public.attendance_records (
  id            uuid primary key default gen_random_uuid(),
  register_id   uuid not null references public.attendance_registers (id),
  student_id    uuid not null references public.students (id),
  status_code   text not null references public.attendance_status_codes (code),
  source        text not null default 'teacher' check (source in ('teacher','leave','correction','override','default')),
  marked_by     uuid references public.profiles (id),
  marked_at     timestamptz not null default now(),
  -- snapshot
  session_id    uuid not null references public.class_sessions (id),
  session_date  date not null,
  offering_id   uuid not null references public.subject_offerings (id),
  component     text not null,
  division_id   uuid references public.divisions (id),
  batch_id      uuid references public.batches (id),
  stream_id     uuid not null references public.streams (id),
  standard_id   uuid not null references public.standards (id),
  term_id       uuid not null references public.academic_terms (id),
  weight        numeric(4,2) not null default 1,
  unique (register_id, student_id)
);
create index attendance_records_student_date_idx on public.attendance_records (student_id, session_date);
create index attendance_records_offering_idx on public.attendance_records (student_id, offering_id, component);

-- Idempotency ledger: the stored result of every processed client submission.
create table public.attendance_submissions (
  client_submission_id  uuid primary key,
  kind                  text not null check (kind in ('day','period')),
  register_id           uuid not null,
  submitted_by          uuid,
  result                jsonb not null,
  created_at            timestamptz not null default now()
);

create table public.attendance_record_history (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('day','period')),
  register_id  uuid not null,
  student_id   uuid not null,
  old_status   text,
  new_status   text not null,
  source       text not null,
  reason       text,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
create index attendance_history_register_idx on public.attendance_record_history (kind, register_id);
create index attendance_history_student_idx on public.attendance_record_history (student_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Summaries
-- ---------------------------------------------------------------------------
create table public.day_attendance_summaries (
  student_id     uuid not null references public.students (id),
  term_id        uuid not null references public.academic_terms (id),
  working_days   integer not null default 0,
  present_value  numeric(7,2) not null default 0,
  absent_days    integer not null default 0,
  percent        numeric(5,2),
  updated_at     timestamptz not null default now(),
  primary key (student_id, term_id)
);

create table public.attendance_summaries (
  student_id   uuid not null references public.students (id),
  offering_id  uuid not null references public.subject_offerings (id),
  component    text not null,
  held         numeric(7,2) not null default 0,
  attended     numeric(7,2) not null default 0,
  excused      numeric(7,2) not null default 0,
  percent      numeric(5,2),
  updated_at   timestamptz not null default now(),
  primary key (student_id, offering_id, component)
);

-- ---------------------------------------------------------------------------
-- Month close, corrections, disputes
-- ---------------------------------------------------------------------------
create table public.attendance_months (
  id                          uuid primary key default gen_random_uuid(),
  division_id                 uuid not null references public.divisions (id),
  month                       date not null check (extract(day from month) = 1),
  state                       text not null default 'open' check (state in ('open','closed','reopened')),
  closed_by                   uuid references public.profiles (id),
  closed_at                   timestamptz,
  class_teacher_signed_by     uuid references public.profiles (id),
  class_teacher_signed_at     timestamptz,
  principal_signed_by         uuid references public.profiles (id),
  principal_signed_at         timestamptz,
  revised                     boolean not null default false,
  muster_asset_id             uuid references public.media_assets (id),
  unique (division_id, month)
);
create trigger attendance_months_audit after insert or update or delete on public.attendance_months
  for each row execute function app.audit_row();

create table public.attendance_correction_requests (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('day','period')),
  register_id        uuid not null,
  division_id        uuid references public.divisions (id),
  stream_id          uuid references public.streams (id),
  att_date           date not null,
  records            jsonb not null,               -- [{student_id, from, to}]
  reason             text not null,
  evidence_asset_id  uuid references public.media_assets (id),
  status             text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by       uuid not null references public.profiles (id),
  requested_at       timestamptz not null default now(),
  decided_by         uuid references public.profiles (id),
  decided_at         timestamptz,
  decision_note      text
);
create index correction_requests_status_idx on public.attendance_correction_requests (status, requested_at);

create table public.attendance_disputes (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('day','period')),
  record_id    uuid not null,
  student_id   uuid not null references public.students (id),
  division_id  uuid references public.divisions (id),
  raised_by    uuid not null references public.profiles (id),
  message      text not null,
  status       text not null default 'open' check (status in ('open','resolved','rejected')),
  resolution   text,
  resolved_by  uuid references public.profiles (id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Closed-month guard (business rule 10)
-- ---------------------------------------------------------------------------
-- tg_argv[0] names the row's date column (att_date / session_date).
create function app.guard_closed_month() returns trigger
language plpgsql as $$
declare
  v_row      jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_division uuid  := (v_row ->> 'division_id')::uuid;
  v_date     date  := (v_row ->> tg_argv[0])::date;
begin
  if coalesce(current_setting('app.correction', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if v_division is not null and exists (
       select 1 from public.attendance_months m
       where m.division_id = v_division
         and m.month = date_trunc('month', v_date)::date
         and m.state = 'closed') then
    raise exception using errcode = 'P0001', message = 'MONTH_CLOSED';
  end if;
  return coalesce(new, old);
end $$;

create trigger day_attendance_month_guard before insert or update or delete on public.day_attendance
  for each row execute function app.guard_closed_month('att_date');
create trigger attendance_records_month_guard before insert or update or delete on public.attendance_records
  for each row execute function app.guard_closed_month('session_date');
