-- 0005 Identity helpers, custom access token hook and Row Level Security (web doc §6.5, §18).
-- Attendance tables get SELECT policies only: every write goes through an RPC (0006).

-- ---------------------------------------------------------------------------
-- Identity helpers (private `app` schema)
-- ---------------------------------------------------------------------------
create function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false)
$$;

create function app.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ur.role), '{}') from public.user_roles ur where ur.user_id = auth.uid()
$$;

-- Permissions are resolved from role_permissions at query time so edits apply immediately.
-- Parameters are p_-prefixed on purpose: in SQL functions a column name wins over a parameter
-- name, so `rp.scope = scope` would compare the column with itself and grant every scope.
create function app.can(p_perm text, p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1
    from public.role_permissions rp
    join public.user_roles ur on ur.role = rp.role
    where ur.user_id = auth.uid() and rp.permission = p_perm and rp.scope = p_scope
  )
$$;

create function app.can_any(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1
    from public.role_permissions rp
    join public.user_roles ur on ur.role = rp.role
    where ur.user_id = auth.uid() and rp.permission = p_perm
  )
$$;

-- Principal/Admin sessions must be MFA-verified when the college requires it.
create function app.aal2_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (c.value)::text::boolean from public.app_config c where c.key = 'require_aal2'), true) = false
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create function app.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s where s.user_id = auth.uid()
$$;

create function app.my_student_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.students s where s.user_id = auth.uid()
$$;

create function app.my_guardian_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select g.id from public.guardians g where g.user_id = auth.uid()
$$;

create function app.is_staff_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('principal','supervisor','admin','office','exam_incharge','stream_coordinator','teacher'))
$$;

-- Streams the caller coordinates today.
create function app.my_stream_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(sc.stream_id), '{}')
  from public.stream_coordinators sc
  where sc.staff_id = app.my_staff_id() and sc.valid_during @> app.today()
$$;

-- Divisions the caller is class teacher of today.
create function app.my_class_division_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ct.division_id), '{}')
  from public.class_teacher_assignments ct
  where ct.staff_id = app.my_staff_id() and ct.valid_during @> app.today()
$$;

-- Teaching groups the caller teaches today.
create function app.my_teaching_group_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct ta.teaching_group_id), '{}')
  from public.teaching_assignments ta
  where ta.staff_id = app.my_staff_id() and ta.valid_during @> app.today()
$$;

create function app.is_guardian_of(p_student_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guardian_links gl
    join public.guardians g on g.id = gl.guardian_id
    where gl.student_id = p_student_id and gl.status = 'verified' and g.user_id = auth.uid()
  ) and app.is_active_user()
$$;

-- Current (or open) enrollment of a student.
create function app.current_enrollment(p_student_id uuid, p_on date default app.today())
returns public.student_enrollments
language sql stable security definer set search_path = '' as $$
  select e.* from public.student_enrollments e
  where e.student_id = p_student_id and e.is_primary and e.valid_during @> p_on
  limit 1
$$;

-- Teaching groups a student belongs to on a date (division, batch and custom groups).
create function app.student_group_ids(p_student_id uuid, p_on date default app.today()) returns uuid[]
language sql stable security definer set search_path = '' as $$
  with e as (select * from app.current_enrollment(p_student_id, p_on))
  select coalesce(array_agg(distinct g.id), '{}') from (
    select tg.id from public.teaching_groups tg, e
      where tg.kind = 'division' and tg.division_id = e.division_id
    union
    select tg.id from public.teaching_groups tg, e
      where tg.kind = 'batch' and tg.batch_id = e.batch_id
    union
    select m.group_id from public.teaching_group_members m
      where m.student_id = p_student_id and m.valid_during @> p_on
  ) g
$$;

-- Does the caller teach this student (any group, today)?
create function app.teaches_student(p_student_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.student_group_ids(p_student_id) && app.my_teaching_group_ids()
$$;

-- Generic scoped visibility of a student for a permission.
create function app.can_see_student(p_student_id uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can(p_perm, 'all')
    or (app.can(p_perm, 'stream') and exists (
          select 1 from public.student_enrollments e
          where e.student_id = p_student_id and e.stream_id = any (app.my_stream_ids())
            and (upper_inf(e.valid_during) or e.valid_during @> app.today())))
    or (app.can(p_perm, 'class') and exists (
          select 1 from public.student_enrollments e
          where e.student_id = p_student_id and e.division_id = any (app.my_class_division_ids())
            and (upper_inf(e.valid_during) or e.valid_during @> app.today())))
    or (app.can(p_perm, 'assigned') and app.teaches_student(p_student_id))
    or (app.can(p_perm, 'self') and p_student_id = app.my_student_id())
    or (app.can(p_perm, 'linked') and app.is_guardian_of(p_student_id))
$$;

-- Generic scoped visibility of a division for a permission.
create function app.can_see_division(p_division_id uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can(p_perm, 'all')
    or (app.can(p_perm, 'stream') and exists (
          select 1 from public.divisions d where d.id = p_division_id and d.stream_id = any (app.my_stream_ids())))
    or (app.can(p_perm, 'class') and p_division_id = any (app.my_class_division_ids()))
    or (app.can(p_perm, 'assigned') and exists (
          select 1 from public.teaching_groups tg
          left join public.batches b on b.id = tg.batch_id
          where tg.id = any (app.my_teaching_group_ids())
            and coalesce(tg.division_id, b.division_id) = p_division_id))
$$;

-- Is the caller on this session (assigned teacher, co-teacher or substitute)?
create function app.staff_on_session(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.session_staff ss
      where ss.session_id = p_session_id and ss.staff_id = app.my_staff_id())
    or exists (
      select 1 from public.class_sessions cs
      join public.teaching_assignments ta on ta.teaching_group_id = cs.teaching_group_id
      where cs.id = p_session_id and ta.staff_id = app.my_staff_id()
        and ta.valid_during @> cs.session_date)
$$;

-- Raise unless the caller's account is active.
create function app.assert_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not app.is_active_user() then
    raise exception using errcode = '42501', message = 'ACCOUNT_INACTIVE';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Custom access token hook: adds app_roles, staff_id, student_id, guardian_id claims.
-- Enable in Dashboard → Authentication → Hooks (or config.toml [auth.hook.custom_access_token]).
-- ---------------------------------------------------------------------------
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid  := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}');
begin
  v_claims := v_claims || jsonb_build_object(
    'app_roles',   coalesce((select jsonb_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = v_uid), '[]'),
    'staff_id',    (select s.id from public.staff s where s.user_id = v_uid),
    'student_id',  (select s.id from public.students s where s.user_id = v_uid),
    'guardian_id', (select g.id from public.guardians g where g.user_id = v_uid)
  );
  return jsonb_set(event, '{claims}', v_claims);
end $$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant usage on schema app to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table in public
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data: readable by every signed-in user; writable with a permission
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('standards',                'structure.manage'),
      ('streams',                  'structure.manage'),
      ('mediums',                  'structure.manage'),
      ('academic_years',           'structure.manage'),
      ('academic_terms',           'structure.manage'),
      ('shifts',                   'structure.manage'),
      ('period_templates',         'structure.manage'),
      ('rooms',                    'structure.manage'),
      ('divisions',                'structure.manage'),
      ('batches',                  'structure.manage'),
      ('curriculum_schemes',       'structure.manage'),
      ('subjects',                 'structure.manage'),
      ('subject_components',       'structure.manage'),
      ('elective_baskets',         'structure.manage'),
      ('elective_basket_subjects', 'structure.manage'),
      ('subject_combinations',     'structure.manage'),
      ('subject_offerings',        'structure.manage'),
      ('teaching_groups',          'structure.manage'),
      ('academic_calendar_events', 'calendar.manage'),
      ('attendance_status_codes',  'attendance.policy.manage'),
      ('attendance_policies',      'attendance.policy.manage'),
      ('leave_types',              'settings.manage'),
      ('permissions',              'roles.manage'),
      ('timetable_versions',       'timetable.edit'),
      ('timetable_slots',          'timetable.edit')
    ) as v(tbl, perm)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t.tbl || '_read', t.tbl);
    execute format('create policy %I on public.%I for all to authenticated using ((select app.can(%L, ''all''))) with check ((select app.can(%L, ''all'')))',
                   t.tbl || '_write', t.tbl, t.perm, t.perm);
  end loop;
end $$;

-- Attendance policy changes need MFA when required.
drop policy attendance_policies_write on public.attendance_policies;
create policy attendance_policies_write on public.attendance_policies for all to authenticated
  using ((select app.can('attendance.policy.manage', 'all')) and (select app.aal2_ok()))
  with check ((select app.can('attendance.policy.manage', 'all')) and (select app.aal2_ok()));

-- App config and college profile are visible before sign-in (public keys only).
-- anon cannot execute app.*, so its policy must not reference those functions.
create policy app_config_public_read on public.app_config for select to anon using (is_public);
create policy app_config_read on public.app_config for select to authenticated
  using (is_public or (select app.can('settings.manage', 'all')));
create policy app_config_write on public.app_config for all to authenticated
  using ((select app.can('settings.manage', 'all')) and (select app.aal2_ok()))
  with check ((select app.can('settings.manage', 'all')) and (select app.aal2_ok()));

create policy college_read on public.college for select to anon, authenticated using (true);
create policy college_write on public.college for all to authenticated
  using ((select app.can('settings.manage', 'all')))
  with check ((select app.can('settings.manage', 'all')));

create policy structure_versions_read on public.structure_versions for select to authenticated
  using ((select app.can_any('structure.view')));
create policy structure_versions_write on public.structure_versions for all to authenticated
  using ((select app.can('structure.manage', 'all')))
  with check ((select app.can('structure.manage', 'all')));

-- ---------------------------------------------------------------------------
-- Profiles, roles, permissions
-- ---------------------------------------------------------------------------
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_staff_user()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select app.can('roles.manage', 'all')))
  with check ((select app.can('roles.manage', 'all')));

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.can('roles.manage', 'all')) or (select app.can_any('staff.view')));
create policy user_roles_write on public.user_roles for all to authenticated
  using ((select app.can('roles.manage', 'all')) and (select app.aal2_ok()))
  with check ((select app.can('roles.manage', 'all')) and (select app.aal2_ok()));

create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy role_permissions_write on public.role_permissions for all to authenticated
  using ((select app.can('roles.manage', 'all')) and (select app.aal2_ok()))
  with check ((select app.can('roles.manage', 'all')) and (select app.aal2_ok()));

-- ---------------------------------------------------------------------------
-- Staff and assignments
-- ---------------------------------------------------------------------------
create policy staff_read on public.staff for select to authenticated
  using ((select app.is_staff_user()));
create policy staff_write on public.staff for all to authenticated
  using ((select app.can('staff.manage', 'all')))
  with check ((select app.can('staff.manage', 'all')));

create policy stream_coordinators_read on public.stream_coordinators for select to authenticated
  using ((select app.is_staff_user()));
create policy stream_coordinators_write on public.stream_coordinators for all to authenticated
  using ((select app.can('assignments.manage', 'all')))
  with check ((select app.can('assignments.manage', 'all')));

create policy class_teacher_assignments_read on public.class_teacher_assignments for select to authenticated
  using ((select app.is_staff_user()));
create policy class_teacher_assignments_write on public.class_teacher_assignments for all to authenticated
  using ((select app.can('assignments.manage', 'all')))
  with check ((select app.can('assignments.manage', 'all')));

create policy teaching_assignments_read on public.teaching_assignments for select to authenticated
  using ((select app.is_staff_user()));
create policy teaching_assignments_write on public.teaching_assignments for all to authenticated
  using ((select app.can('assignments.manage', 'all'))
         or ((select app.can('assignments.manage', 'stream')) and exists (
               select 1 from public.teaching_groups tg join public.subject_offerings o on o.id = tg.offering_id
               where tg.id = teaching_group_id and o.stream_id = any ((select app.my_stream_ids())::uuid[]))))
  with check ((select app.can('assignments.manage', 'all'))
         or ((select app.can('assignments.manage', 'stream')) and exists (
               select 1 from public.teaching_groups tg join public.subject_offerings o on o.id = tg.offering_id
               where tg.id = teaching_group_id and o.stream_id = any ((select app.my_stream_ids())::uuid[]))));

create policy teaching_group_members_read on public.teaching_group_members for select to authenticated
  using ((select app.is_staff_user()) or student_id = (select app.my_student_id()));
create policy teaching_group_members_write on public.teaching_group_members for all to authenticated
  using ((select app.can('structure.manage', 'all')))
  with check ((select app.can('structure.manage', 'all')));

-- ---------------------------------------------------------------------------
-- Students, guardians, consents, documents
-- ---------------------------------------------------------------------------
create policy students_read on public.students for select to authenticated
  using (app.can_see_student(id, 'students.view'));
create policy students_write on public.students for insert to authenticated
  with check ((select app.can('students.manage', 'all')));
create policy students_update on public.students for update to authenticated
  using ((select app.can('students.manage', 'all')))
  with check ((select app.can('students.manage', 'all')));

create policy student_sensitive_all on public.student_sensitive for all to authenticated
  using ((select app.can('students.sensitive.view', 'all')))
  with check ((select app.can('students.sensitive.view', 'all')));

create policy board_regs_read on public.student_board_registrations for select to authenticated
  using ((select app.can('students.ids.view', 'all')) or app.can_see_student(student_id, 'students.view'));
create policy board_regs_write on public.student_board_registrations for all to authenticated
  using ((select app.can('students.manage', 'all')))
  with check ((select app.can('students.manage', 'all')));

create policy guardians_read on public.guardians for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select app.can('guardians.manage', 'all'))
    or exists (select 1 from public.guardian_links gl
               where gl.guardian_id = guardians.id and gl.status <> 'revoked'
                 and app.can_see_student(gl.student_id, 'guardians.view'))
  );
create policy guardians_write on public.guardians for all to authenticated
  using ((select app.can('guardians.manage', 'all')))
  with check ((select app.can('guardians.manage', 'all')));

create policy guardian_links_read on public.guardian_links for select to authenticated
  using (
    (select app.can('guardians.manage', 'all'))
    or guardian_id = (select app.my_guardian_id())
    or app.can_see_student(student_id, 'guardians.view')
  );
create policy guardian_links_write on public.guardian_links for all to authenticated
  using ((select app.can('guardians.manage', 'all')))
  with check ((select app.can('guardians.manage', 'all')));

create policy consents_read on public.consents for select to authenticated
  using ((select app.can('consents.manage', 'all'))
         or student_id = (select app.my_student_id())
         or app.is_guardian_of(student_id));
create policy consents_write on public.consents for all to authenticated
  using ((select app.can('consents.manage', 'all')))
  with check ((select app.can('consents.manage', 'all')));

create policy media_assets_read on public.media_assets for select to authenticated
  using (uploaded_by = (select auth.uid())
         or (select app.can('students.manage', 'all'))
         or (owner_student_id is not null and app.can_see_student(owner_student_id, 'students.view')));

create policy student_documents_read on public.student_documents for select to authenticated
  using ((select app.can('students.manage', 'all')) or app.can_see_student(student_id, 'students.view'));
create policy student_documents_write on public.student_documents for all to authenticated
  using ((select app.can('students.manage', 'all')))
  with check ((select app.can('students.manage', 'all')));

create policy enrollments_read on public.student_enrollments for select to authenticated
  using (app.can_see_student(student_id, 'students.view'));
create policy enrollments_write on public.student_enrollments for all to authenticated
  using ((select app.can('students.manage', 'all')))
  with check ((select app.can('students.manage', 'all')));

create policy subject_choices_read on public.student_subject_choices for select to authenticated
  using (app.can_see_student(student_id, 'students.view'));
create policy subject_choices_write on public.student_subject_choices for all to authenticated
  using ((select app.can('students.manage', 'all')))
  with check ((select app.can('students.manage', 'all')));

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (
    (select app.can_any('timetable.view'))
    or teaching_group_id = any (app.student_group_ids((select app.my_student_id()), session_date))
    or exists (select 1 from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
               where g.user_id = (select auth.uid()) and gl.status = 'verified'
                 and class_sessions.teaching_group_id = any (app.student_group_ids(gl.student_id, class_sessions.session_date)))
  );
create policy class_sessions_write on public.class_sessions for all to authenticated
  using ((select app.can('sessions.manage', 'all'))
         or ((select app.can('sessions.manage', 'stream')) and stream_id = any ((select app.my_stream_ids())::uuid[])))
  with check ((select app.can('sessions.manage', 'all'))
         or ((select app.can('sessions.manage', 'stream')) and stream_id = any ((select app.my_stream_ids())::uuid[])));

create policy session_staff_read on public.session_staff for select to authenticated
  using ((select app.is_staff_user()));
create policy session_staff_write on public.session_staff for all to authenticated
  using ((select app.can_any('sessions.manage')))
  with check ((select app.can_any('sessions.manage')));

-- ---------------------------------------------------------------------------
-- Attendance (SELECT only)
-- ---------------------------------------------------------------------------
create policy day_registers_read on public.day_registers for select to authenticated
  using (app.can_see_division(division_id, 'attendance.view'));

create policy day_attendance_select on public.day_attendance for select to authenticated
  using (
       (select app.can('attendance.view', 'all'))
    or ((select app.can('attendance.view', 'stream')) and stream_id = any ((select app.my_stream_ids())::uuid[]))
    or ((select app.can('attendance.view', 'class')) and division_id = any ((select app.my_class_division_ids())::uuid[]))
    or ((select app.can('attendance.view', 'self')) and student_id = (select app.my_student_id()))
    or ((select app.can('attendance.view', 'linked')) and app.is_guardian_of(student_id))
  );

create policy attendance_registers_read on public.attendance_registers for select to authenticated
  using (
    app.staff_on_session(session_id)
    or exists (select 1 from public.class_sessions cs
               where cs.id = session_id
                 and ((select app.can('attendance.view', 'all'))
                      or ((select app.can('attendance.view', 'stream')) and cs.stream_id = any ((select app.my_stream_ids())::uuid[]))
                      or ((select app.can('attendance.view', 'class')) and cs.division_id = any ((select app.my_class_division_ids())::uuid[]))))
  );

create policy attendance_records_select on public.attendance_records for select to authenticated
  using (
       (select app.can('attendance.view', 'all'))
    or ((select app.can('attendance.view', 'stream')) and stream_id = any ((select app.my_stream_ids())::uuid[]))
    or ((select app.can('attendance.view', 'class')) and division_id = any ((select app.my_class_division_ids())::uuid[]))
    or ((select app.can('attendance.view', 'assigned')) and app.staff_on_session(session_id))
    or ((select app.can('attendance.view', 'self')) and student_id = (select app.my_student_id()))
    or ((select app.can('attendance.view', 'linked')) and app.is_guardian_of(student_id))
  );

create policy attendance_history_read on public.attendance_record_history for select to authenticated
  using ((select app.can('audit.view', 'all')) or app.can_see_student(student_id, 'attendance.view'));

create policy day_summaries_read on public.day_attendance_summaries for select to authenticated
  using (app.can_see_student(student_id, 'attendance.view'));
create policy subject_summaries_read on public.attendance_summaries for select to authenticated
  using (app.can_see_student(student_id, 'attendance.view'));

create policy attendance_months_read on public.attendance_months for select to authenticated
  using (app.can_see_division(division_id, 'attendance.view'));

create policy corrections_read on public.attendance_correction_requests for select to authenticated
  using (requested_by = (select auth.uid())
         or (select app.can('attendance.correct.approve', 'all'))
         or ((select app.can('attendance.correct.approve', 'stream')) and stream_id = any ((select app.my_stream_ids())::uuid[])));

create policy disputes_read on public.attendance_disputes for select to authenticated
  using (raised_by = (select auth.uid())
         or ((select app.is_staff_user()) and app.can_see_student(student_id, 'attendance.view')));

-- ---------------------------------------------------------------------------
-- Eligibility, notices, condonation, leave
-- ---------------------------------------------------------------------------
create policy eligibility_read on public.eligibility_snapshots for select to authenticated
  using (app.can_see_student(student_id, 'eligibility.view'));

create policy condonation_read on public.condonation_cases for select to authenticated
  using (app.can_see_student(student_id, 'eligibility.view'));
create policy condonation_write on public.condonation_cases for all to authenticated
  using ((select app.can('eligibility.manage', 'all')) or (select app.can('condonation.recommend', 'all')))
  with check ((select app.can('eligibility.manage', 'all')) or (select app.can('condonation.recommend', 'all')));

create policy notices_read on public.defaulter_notices for select to authenticated
  using (app.can_see_student(student_id, 'attendance.view'));

create policy parent_meetings_read on public.parent_meetings for select to authenticated
  using ((select app.is_staff_user()) and app.can_see_division(division_id, 'attendance.view'));

create policy leave_read on public.leave_requests for select to authenticated
  using (applied_by = (select auth.uid()) or app.can_see_student(student_id, 'attendance.view'));

-- ---------------------------------------------------------------------------
-- Notifications and announcements
-- ---------------------------------------------------------------------------
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy notification_prefs_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy device_tokens_own_read on public.device_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy device_tokens_own_delete on public.device_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create policy announcements_read on public.announcements for select to authenticated
  using (created_by = (select auth.uid())
         or (select app.can_any('announcements.college'))
         or exists (select 1 from public.announcement_recipients r
                    where r.announcement_id = announcements.id and r.user_id = (select auth.uid())));
create policy announcements_write on public.announcements for all to authenticated
  using ((select app.can('announcements.college', 'all')))
  with check ((select app.can('announcements.college', 'all')));

create policy announcement_recipients_own on public.announcement_recipients for select to authenticated
  using (user_id = (select auth.uid()) or (select app.can('announcements.college', 'all')));
create policy announcement_recipients_mark on public.announcement_recipients for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Imports, exports, audit
-- ---------------------------------------------------------------------------
create policy import_jobs_all on public.import_jobs for all to authenticated
  using ((select app.can('admissions.import', 'all')))
  with check ((select app.can('admissions.import', 'all')));
create policy import_rows_all on public.import_rows for all to authenticated
  using ((select app.can('admissions.import', 'all')))
  with check ((select app.can('admissions.import', 'all')));

create policy govt_exports_read on public.govt_exports for select to authenticated
  using ((select app.can('govt.export', 'all')));
create policy govt_exports_insert on public.govt_exports for insert to authenticated
  with check ((select app.can('govt.export', 'all')) and exported_by = (select auth.uid()));

create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.can('audit.view', 'all')));

-- Tables with no policy here (attendance_submissions, notification_outbox) are reachable
-- only through SECURITY DEFINER functions and the service role.
