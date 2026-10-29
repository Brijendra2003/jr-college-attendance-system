-- 0002 Organisation, people and academic structure (web doc §8.1–§8.3).

-- ---------------------------------------------------------------------------
-- College (exactly one row)
-- ---------------------------------------------------------------------------
create table public.college (
id                  smallint primary key default 1 check (id = 1),
name                text not null,
name_mr             text,
address             text,
district            text,
taluka              text,
divisional_board    text not null check (divisional_board in
                      ('pune','mumbai','nagpur','chh_sambhajinagar','kolhapur','amravati','nashik','latur','konkan')),
board_index_no      text,
udise_code          text,
management_type     text not null default 'aided' check (management_type in
                      ('government','aided','partially_aided','unaided','self_financed')),
is_minority         boolean not null default false,
mediums             text[] not null default '{en}',
timezone            text not null default 'Asia/Kolkata',
logo_url            text,
letterhead          jsonb not null default '{}',
setup_completed_at  timestamptz,
created_at          timestamptz not null default now(),
updated_at          timestamptz not null default now()
);
create trigger college_touch before update on public.college
for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles, roles and permissions
-- ---------------------------------------------------------------------------
create table public.profiles (
id                  uuid primary key references auth.users (id) on delete cascade,
display_name        text not null default '',
email               text,
phone               text,
preferred_language  text not null default 'en' check (preferred_language in ('en','mr','hi')),
is_active           boolean not null default true,
created_at          timestamptz not null default now(),
updated_at          timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
for each row execute function app.touch_updated_at();

-- Every auth user gets a profile row.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
insert into public.profiles (id, display_name, email, preferred_language)
values (
  new.id,
  coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
  new.email,
  coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en')
)
on conflict (id) do nothing;
return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function app.handle_new_user();

create table public.permissions (
key          text primary key,
description  text not null default ''
);

create table public.user_roles (
user_id     uuid not null references public.profiles (id) on delete cascade,
role        text not null check (role in
              ('principal','supervisor','admin','office','exam_incharge','stream_coordinator',
                'teacher','student','parent')),
granted_by  uuid references public.profiles (id),
granted_at  timestamptz not null default now(),
primary key (user_id, role)
);

create table public.role_permissions (
role        text not null,
permission  text not null references public.permissions (key) on delete cascade,
scope       text not null check (scope in ('all','stream','class','assigned','self','linked')),
primary key (role, permission, scope)
);

-- ---------------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------------
create table public.standards (
id     uuid primary key default gen_random_uuid(),
code   text not null unique,          -- XI, XII
level  smallint not null unique check (level in (11, 12)),
label  text not null                  -- FYJC, SYJC
);

create table public.streams (
id         uuid primary key default gen_random_uuid(),
code       text not null unique,      -- SCI, COM, ARTS
name       text not null,
name_mr    text,
is_active  boolean not null default true,
sort_order smallint not null default 0
);

create table public.mediums (
code  text primary key check (code in ('en','mr','hi','ur')),
name  text not null
);

create table public.academic_years (
id         uuid primary key default gen_random_uuid(),
label      text not null unique,      -- 2026-27
starts_on  date not null,
ends_on    date not null,
status     text not null default 'planned' check (status in ('planned','active','archived')),
check (ends_on > starts_on)
);
-- Only one active year at a time.
create unique index academic_years_one_active on public.academic_years ((status)) where status = 'active';

create table public.academic_terms (
id                uuid primary key default gen_random_uuid(),
academic_year_id  uuid not null references public.academic_years (id) on delete restrict,
seq               smallint not null check (seq in (1, 2)),
name              text not null,
starts_on         date not null,
ends_on           date not null,
unique (academic_year_id, seq),
check (ends_on >= starts_on)
);

create table public.shifts (
id         uuid primary key default gen_random_uuid(),
name       text not null unique,
starts_at  time not null,
ends_at    time not null,
saturday_ends_at time                -- half-day Saturdays
);

create table public.period_templates (
id         uuid primary key default gen_random_uuid(),
shift_id   uuid not null references public.shifts (id) on delete cascade,
weekday    smallint check (weekday between 1 and 7),  -- ISO weekday, null = every weekday
period_no  smallint not null,
starts_at  time not null,
ends_at    time not null,
is_break   boolean not null default false,
unique (shift_id, weekday, period_no)
);

create table public.rooms (
id        uuid primary key default gen_random_uuid(),
code      text not null unique,
name      text not null,
kind      text not null default 'classroom' check (kind in
            ('classroom','physics_lab','chemistry_lab','biology_lab','computer_lab','workshop','hall','other')),
capacity  integer
);

create table public.divisions (
id                uuid primary key default gen_random_uuid(),
academic_year_id  uuid not null references public.academic_years (id) on delete restrict,
standard_id       uuid not null references public.standards (id) on delete restrict,
stream_id         uuid not null references public.streams (id) on delete restrict,
medium_code       text not null references public.mediums (code),
code              text not null,                 -- A, B, C
name              text not null,                 -- XI-SCI-A
capacity          integer not null default 120,
shift_id          uuid references public.shifts (id),
room_id           uuid references public.rooms (id),
archived_at       timestamptz,
unique (academic_year_id, standard_id, stream_id, code)
);
create index divisions_year_idx on public.divisions (academic_year_id);

create table public.batches (
id           uuid primary key default gen_random_uuid(),
division_id  uuid not null references public.divisions (id) on delete restrict,
code         text not null,                      -- P1, P2
name         text not null,
unique (division_id, code)
);

create table public.structure_versions (
id                 uuid primary key default gen_random_uuid(),
status             text not null default 'draft' check (status in ('draft','active','superseded')),
document           jsonb not null default '{}',
validation_report  jsonb,
created_by         uuid references public.profiles (id),
created_at         timestamptz not null default now(),
activated_at       timestamptz
);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.staff (
id               uuid primary key default gen_random_uuid(),
employee_id      text not null unique,
full_name        text not null,
full_name_mr     text,
designation      text not null default 'lecturer' check (designation in
                    ('principal','vice_principal','supervisor','senior_lecturer','lecturer',
                    'lab_assistant','librarian','clerk','peon','other')),
employment_type  text not null default 'full_time' check (employment_type in ('full_time','clock_hour','visiting')),
email            text,
phone            text,
subjects         text[] not null default '{}',
status           text not null default 'active' check (status in ('active','on_leave','left')),
user_id          uuid unique references public.profiles (id) on delete set null,
created_at       timestamptz not null default now(),
updated_at       timestamptz not null default now()
);
create trigger staff_touch before update on public.staff
for each row execute function app.touch_updated_at();

create table public.stream_coordinators (
id            uuid primary key default gen_random_uuid(),
stream_id     uuid not null references public.streams (id),
staff_id      uuid not null references public.staff (id),
valid_during  daterange not null,
exclude using gist (stream_id with =, valid_during with &&)
);

create table public.class_teacher_assignments (
id            uuid primary key default gen_random_uuid(),
division_id   uuid not null references public.divisions (id),
staff_id      uuid not null references public.staff (id),
valid_during  daterange not null,
constraint one_class_teacher exclude using gist (division_id with =, valid_during with &&)
);
create index cta_staff_idx on public.class_teacher_assignments (staff_id);

-- ---------------------------------------------------------------------------
-- Students, guardians, consents
-- ---------------------------------------------------------------------------
create sequence public.gr_no_seq start 1;

create table public.students (
id                  uuid primary key default gen_random_uuid(),
gr_no               text not null unique,
college_student_id  text unique,
saral_id            text unique,
pen                 text unique,
apaar_id            text unique,
cap_application_no  text unique,
surname             text not null,
first_name          text not null,
father_name         text,
mother_name         text,
full_name           text generated always as
                      (surname || ' ' || first_name || coalesce(' ' || father_name, '')) stored,
name_mr             text,
dob                 date,
gender              text check (gender in ('male','female','other')),
ssc_board           text,
ssc_seat_no         text,
ssc_percent         numeric(5,2),
medium_code         text references public.mediums (code),
admission_type      text not null default 'cap' check (admission_type in
                      ('cap','in_house','management','minority','transfer','re_admission')),
admitted_on         date not null default app.today(),
status              text not null default 'active' check (status in
                      ('active','transferred','left','admission_cancelled','detained','passed_out')),
photo_asset_id      uuid,
user_id             uuid unique references public.profiles (id) on delete set null,
created_at          timestamptz not null default now(),
updated_at          timestamptz not null default now()
);
create index students_name_idx on public.students (lower(full_name) text_pattern_ops);
create index students_dob_idx  on public.students (dob);
create trigger students_touch before update on public.students
for each row execute function app.touch_updated_at();
create trigger students_audit after insert or update or delete on public.students
for each row execute function app.audit_row();

-- GR numbers are permanent.
create function app.guard_gr_no() returns trigger
language plpgsql as $$
begin
if tg_op = 'DELETE' then
  raise exception using errcode = 'P0001', message = 'STUDENT_NO_DELETE';
end if;
if new.gr_no is distinct from old.gr_no then
  raise exception using errcode = 'P0001', message = 'GR_NO_IMMUTABLE';
end if;
return new;
end $$;
create trigger students_gr_guard before update or delete on public.students
for each row execute function app.guard_gr_no();

create table public.student_sensitive (
student_id         uuid primary key references public.students (id) on delete restrict,
category           text,                  -- open, sc, st, vj_nt, obc, sbc, ews …
is_minority        boolean,
aadhaar_last4      text check (aadhaar_last4 ~ '^[0-9]{4}$'),   -- never the full number
scholarship_flags  jsonb not null default '{}',
updated_at         timestamptz not null default now()
);
create trigger student_sensitive_audit after insert or update or delete on public.student_sensitive
for each row execute function app.audit_row();

create table public.student_board_registrations (
id            uuid primary key default gen_random_uuid(),
student_id    uuid not null references public.students (id),
exam_session  text not null,                 -- e.g. 2027-02
hsc_seat_no   text,
form_status   text not null default 'not_started' check (form_status in
                ('not_started','submitted','prelist_verified','withheld')),
withheld_reason text,
notes         text,
updated_at    timestamptz not null default now(),
unique (student_id, exam_session)
);

create table public.guardians (
id                  uuid primary key default gen_random_uuid(),
full_name           text not null,
relation            text not null check (relation in ('father','mother','guardian')),
email               text unique,              -- login username
phone               text,                     -- contact only, never used for login
preferred_language  text not null default 'mr' check (preferred_language in ('en','mr','hi')),
user_id             uuid unique references public.profiles (id) on delete set null,
created_at          timestamptz not null default now(),
updated_at          timestamptz not null default now()
);
create trigger guardians_touch before update on public.guardians
for each row execute function app.touch_updated_at();

create table public.guardian_links (
id           uuid primary key default gen_random_uuid(),
student_id   uuid not null references public.students (id),
guardian_id  uuid not null references public.guardians (id),
status       text not null default 'pending' check (status in ('pending','verified','revoked')),
is_primary   boolean not null default false,
verified_by  uuid references public.profiles (id),
verified_at  timestamptz,
created_at   timestamptz not null default now(),
unique (student_id, guardian_id)
);
create index guardian_links_guardian_idx on public.guardian_links (guardian_id) where status = 'verified';
create trigger guardian_links_audit after insert or update or delete on public.guardian_links
for each row execute function app.audit_row();

create table public.media_assets (
id             uuid primary key default gen_random_uuid(),
public_id      text not null unique,
resource_type  text not null check (resource_type in ('image','raw','video')),
delivery_type  text not null check (delivery_type in ('upload','authenticated','private')),
format         text,
bytes          bigint,
purpose        text not null,               -- photo, leave_document, consent_form, muster, notice, …
owner_student_id uuid references public.students (id),
uploaded_by    uuid references public.profiles (id),
created_at     timestamptz not null default now()
);

create table public.consents (
id                 uuid primary key default gen_random_uuid(),
student_id         uuid not null references public.students (id),
guardian_id        uuid references public.guardians (id),
purpose            text not null check (purpose in ('app_account','photos','biometric','apaar','communications')),
notice_version     text not null default 'v1',
method             text not null check (method in ('paper','in_app')),
evidence_asset_id  uuid references public.media_assets (id),
granted_at         timestamptz not null default now(),
withdrawn_at       timestamptz,
recorded_by        uuid references public.profiles (id)
);
create index consents_student_idx on public.consents (student_id, purpose) where withdrawn_at is null;
create trigger consents_audit after insert or update or delete on public.consents
for each row execute function app.audit_row();

create table public.student_documents (
id                  uuid primary key default gen_random_uuid(),
student_id          uuid not null references public.students (id),
doc_type            text not null,
asset_id            uuid not null references public.media_assets (id),
verification_state  text not null default 'pending' check (verification_state in ('pending','verified','rejected')),
verified_by         uuid references public.profiles (id),
created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Curriculum and subjects
-- ---------------------------------------------------------------------------
create table public.curriculum_schemes (
id              uuid primary key default gen_random_uuid(),
code            text not null unique,
name            text not null,
effective_from  jsonb not null default '{}'   -- {"XI": "2019-20", "XII": "2020-21"}
);

create table public.subjects (
id               uuid primary key default gen_random_uuid(),
scheme_id        uuid not null references public.curriculum_schemes (id),
board_code       text,
name             text not null,
name_mr          text,
kind             text not null check (kind in ('language','core','optional','bifocal','graded')),
in_eligibility   boolean not null default true,
standard_levels  smallint[] not null default '{11,12}',
stream_codes     text[] not null default '{}',     -- empty = every stream
unique (scheme_id, name)
);

create table public.subject_components (
id              uuid primary key default gen_random_uuid(),
subject_id      uuid not null references public.subjects (id) on delete cascade,
component       text not null check (component in ('TH','PR','OR')),
weekly_periods  smallint not null default 0,
unique (subject_id, component)
);

create table public.elective_baskets (
id           uuid primary key default gen_random_uuid(),
scheme_id    uuid not null references public.curriculum_schemes (id),
stream_id    uuid not null references public.streams (id),
standard_id  uuid references public.standards (id),
name         text not null,
min_picks    smallint not null default 1,
max_picks    smallint not null default 1,
unique (scheme_id, stream_id, standard_id, name),
check (max_picks >= min_picks)
);

create table public.elective_basket_subjects (
basket_id   uuid not null references public.elective_baskets (id) on delete cascade,
subject_id  uuid not null references public.subjects (id),
primary key (basket_id, subject_id)
);

create table public.subject_combinations (
id           uuid primary key default gen_random_uuid(),
stream_id    uuid not null references public.streams (id),
name         text not null unique,            -- PCMB, PCM-IT, Commerce-Maths
subject_ids  uuid[] not null
);

create table public.subject_offerings (
id                uuid primary key default gen_random_uuid(),
subject_id        uuid not null references public.subjects (id),
academic_year_id  uuid not null references public.academic_years (id),
standard_id       uuid not null references public.standards (id),
stream_id         uuid not null references public.streams (id),
medium_code       text references public.mediums (code),
unique nulls not distinct (subject_id, academic_year_id, standard_id, stream_id, medium_code)
);

create table public.teaching_groups (
id           uuid primary key default gen_random_uuid(),
offering_id  uuid not null references public.subject_offerings (id),
component    text not null check (component in ('TH','PR','OR')),
kind         text not null check (kind in ('division','batch','custom')),
division_id  uuid references public.divisions (id),
batch_id     uuid references public.batches (id),
name         text not null,
check ((kind = 'division' and division_id is not null and batch_id is null)
    or (kind = 'batch' and batch_id is not null)
    or (kind = 'custom'))
);
create index teaching_groups_division_idx on public.teaching_groups (division_id);
create index teaching_groups_batch_idx on public.teaching_groups (batch_id);

create table public.teaching_group_members (
group_id      uuid not null references public.teaching_groups (id) on delete cascade,
student_id    uuid not null references public.students (id),
valid_during  daterange not null,
exclude using gist (group_id with =, student_id with =, valid_during with &&)
);

create table public.teaching_assignments (
id                 uuid primary key default gen_random_uuid(),
teaching_group_id  uuid not null references public.teaching_groups (id),
staff_id           uuid not null references public.staff (id),
role               text not null default 'primary' check (role in ('primary','co','substitute')),
valid_during       daterange not null
);
create index teaching_assignments_staff_idx on public.teaching_assignments (staff_id);
create index teaching_assignments_group_idx on public.teaching_assignments (teaching_group_id);

-- ---------------------------------------------------------------------------
-- Enrollment
-- ---------------------------------------------------------------------------
create table public.student_enrollments (
id                uuid primary key default gen_random_uuid(),
student_id        uuid not null references public.students (id),
academic_year_id  uuid not null references public.academic_years (id),
standard_id       uuid not null references public.standards (id),
stream_id         uuid not null references public.streams (id),
medium_code       text not null references public.mediums (code),
division_id       uuid not null references public.divisions (id),
batch_id          uuid references public.batches (id),
roll_no           text,
enrollment_type   text not null default 'regular' check (enrollment_type in ('regular','repeater','transfer_in')),
is_primary        boolean not null default true,
valid_during      daterange not null,
reason            text,
created_at        timestamptz not null default now(),
constraint one_primary_enrollment
  exclude using gist (student_id with =, valid_during with &&) where (is_primary)
);
create index enrollments_division_idx on public.student_enrollments (division_id);
create index enrollments_student_idx on public.student_enrollments (student_id);
create unique index enrollments_roll_unique on public.student_enrollments (division_id, roll_no)
where upper_inf(valid_during) and roll_no is not null;
create trigger enrollments_audit after insert or update or delete on public.student_enrollments
for each row execute function app.audit_row();

create table public.student_subject_choices (
id                uuid primary key default gen_random_uuid(),
student_id        uuid not null references public.students (id),
subject_id        uuid not null references public.subjects (id),
academic_year_id  uuid not null references public.academic_years (id),
valid_during      daterange not null,
exclude using gist (student_id with =, subject_id with =, valid_during with &&)
);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------
create table public.academic_calendar_events (
id                uuid primary key default gen_random_uuid(),
academic_year_id  uuid not null references public.academic_years (id),
kind              text not null check (kind in
                    ('public_holiday','college_holiday','emergency_holiday','vacation',
                      'exam_block','event','working_override')),
title             text not null,
title_mr          text,
starts_on         date not null,
ends_on           date not null,
division_ids      uuid[],                       -- null = whole college
created_by        uuid references public.profiles (id),
created_at        timestamptz not null default now(),
check (ends_on >= starts_on)
);
create index calendar_events_range_idx on public.academic_calendar_events using gist (daterange(starts_on, ends_on, '[]'));
create trigger calendar_events_audit after insert or update or delete on public.academic_calendar_events
for each row execute function app.audit_row();
