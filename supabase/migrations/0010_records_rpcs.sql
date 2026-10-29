-- 0010 Effective-dated record changes used by the web app (web doc §8.5, §12.5–§12.7).
-- Each closes the current row and opens a new one in one transaction, so history is never rewritten.

-- Students sign in with an email the office issues (often a college-domain address).
alter table public.students add column login_email text unique;

-- ---------------------------------------------------------------------------
-- Student leaves / admission cancelled / detained / passed out
-- ---------------------------------------------------------------------------
create function public.end_enrollment(p_student_id uuid, p_status text, p_on date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform app.assert_active();
  if not app.can('students.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if p_status not in ('transferred','left','admission_cancelled','detained','passed_out') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;

  perform set_config('app.audit_reason', p_reason, true);
  -- Close open enrollments the day after p_on (the student attended up to and including p_on).
  update public.student_enrollments
     set valid_during = daterange(lower(valid_during), greatest(lower(valid_during) + 1, p_on + 1), '[)'),
         reason = coalesce(reason || '; ', '') || p_reason
   where student_id = p_student_id and (upper_inf(valid_during) or upper(valid_during) > p_on + 1);
  update public.student_subject_choices
     set valid_during = daterange(lower(valid_during), greatest(lower(valid_during) + 1, p_on + 1), '[)')
   where student_id = p_student_id and upper_inf(valid_during);
  update public.students set status = p_status where id = p_student_id returning user_id into v_user;

  -- Approved / pending leave after the date no longer applies.
  update public.leave_requests set status = 'cancelled'
   where student_id = p_student_id and status in ('awaiting_guardian','pending','needs_info') and from_date > p_on;

  if v_user is not null and p_status in ('admission_cancelled','left','transferred') then
    update public.profiles set is_active = false where id = v_user;
  end if;
  return jsonb_build_object('result', 'ok', 'deactivated_user', v_user);
end $$;

-- ---------------------------------------------------------------------------
-- Division transfer (effective-dated). Past records keep their snapshot.
-- ---------------------------------------------------------------------------
create function public.transfer_student(p_student_id uuid, p_division_id uuid, p_on date,
                                        p_roll_no text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.student_enrollments;
  v_div public.divisions;
  v_roll text := nullif(p_roll_no, '');
begin
  perform app.assert_active();
  if not app.can('students.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select * into v_old from public.student_enrollments
   where student_id = p_student_id and is_primary and valid_during @> p_on for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_ENROLLED';
  end if;
  select * into v_div from public.divisions where id = p_division_id;
  if v_div.academic_year_id <> v_old.academic_year_id then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT', detail = 'Division is in another academic year';
  end if;

  if v_roll is null then
    select coalesce(max(nullif(regexp_replace(e.roll_no, '\D', '', 'g'), '')::int), 0) + 1 into v_roll
    from public.student_enrollments e where e.division_id = p_division_id and upper_inf(e.valid_during);
  end if;

  perform set_config('app.audit_reason', coalesce(p_reason, 'division transfer'), true);
  if lower(v_old.valid_during) >= p_on then
    -- Same-day correction of a wrong placement: replace instead of creating an empty range.
    delete from public.student_enrollments where id = v_old.id;
  else
    update public.student_enrollments set valid_during = daterange(lower(valid_during), p_on, '[)') where id = v_old.id;
  end if;
  insert into public.student_enrollments
    (student_id, academic_year_id, standard_id, stream_id, medium_code, division_id, batch_id, roll_no,
     enrollment_type, valid_during, reason)
  values (p_student_id, v_div.academic_year_id, v_div.standard_id, v_div.stream_id, v_div.medium_code, v_div.id, null,
          v_roll, v_old.enrollment_type, daterange(p_on, upper(v_old.valid_during), '[)'), coalesce(p_reason, 'division transfer'));
  return jsonb_build_object('result', 'ok', 'roll_no', v_roll);
end $$;

create function public.set_student_batch(p_student_id uuid, p_batch_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_active();
  if not app.can('students.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  update public.student_enrollments e set batch_id = p_batch_id
   where e.student_id = p_student_id and e.is_primary and e.valid_during @> app.today()
     and (p_batch_id is null or exists (select 1 from public.batches b where b.id = p_batch_id and b.division_id = e.division_id));
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Class teacher / stream coordinator hand-over
-- ---------------------------------------------------------------------------
create function public.assign_class_teacher(p_division_id uuid, p_staff_id uuid, p_from date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_active();
  if not app.can('assignments.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  delete from public.class_teacher_assignments
   where division_id = p_division_id and lower(valid_during) >= p_from;
  update public.class_teacher_assignments set valid_during = daterange(lower(valid_during), p_from, '[)')
   where division_id = p_division_id and valid_during @> p_from;
  insert into public.class_teacher_assignments (division_id, staff_id, valid_during)
  values (p_division_id, p_staff_id, daterange(p_from, null, '[)'));
  perform app.audit('assign_class_teacher', 'divisions', p_division_id::text, null,
                    jsonb_build_object('staff_id', p_staff_id, 'from', p_from), null);
end $$;

create function public.assign_stream_coordinator(p_stream_id uuid, p_staff_id uuid, p_from date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform app.assert_active();
  if not app.can('assignments.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  delete from public.stream_coordinators where stream_id = p_stream_id and lower(valid_during) >= p_from;
  update public.stream_coordinators set valid_during = daterange(lower(valid_during), p_from, '[)')
   where stream_id = p_stream_id and valid_during @> p_from;
  insert into public.stream_coordinators (stream_id, staff_id, valid_during)
  values (p_stream_id, p_staff_id, daterange(p_from, null, '[)'));
  select user_id into v_user from public.staff where id = p_staff_id;
  if v_user is not null then
    insert into public.user_roles (user_id, role, granted_by) values (v_user, 'stream_coordinator', auth.uid())
    on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Teaching group + offering + assignment in one step (timetable prerequisites)
-- ---------------------------------------------------------------------------
create function public.create_teaching_group(p_subject_id uuid, p_division_id uuid, p_component text,
                                             p_batch_id uuid default null, p_staff_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_div public.divisions;
  v_offering uuid;
  v_group uuid;
  v_name text;
  v_year public.academic_years;
begin
  perform app.assert_active();
  if not (app.can('structure.manage', 'all') or app.can('timetable.edit', 'all')
          or (app.can('timetable.edit', 'stream') and exists
               (select 1 from public.divisions d where d.id = p_division_id and d.stream_id = any (app.my_stream_ids())))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select * into v_div from public.divisions where id = p_division_id;
  select * into v_year from public.academic_years where id = v_div.academic_year_id;

  insert into public.subject_offerings (subject_id, academic_year_id, standard_id, stream_id)
  values (p_subject_id, v_div.academic_year_id, v_div.standard_id, v_div.stream_id)
  on conflict (subject_id, academic_year_id, standard_id, stream_id, medium_code) do nothing;
  select id into v_offering from public.subject_offerings
   where subject_id = p_subject_id and academic_year_id = v_div.academic_year_id
     and standard_id = v_div.standard_id and stream_id = v_div.stream_id and medium_code is null;

  select v_div.name || coalesce(' ' || b.code, '') || ' ' || s.name || ' ' || p_component into v_name
  from public.subjects s left join public.batches b on b.id = p_batch_id where s.id = p_subject_id;

  insert into public.teaching_groups (offering_id, component, kind, division_id, batch_id, name)
  values (v_offering, p_component, case when p_batch_id is null then 'division' else 'batch' end,
          case when p_batch_id is null then p_division_id end, p_batch_id, v_name)
  returning id into v_group;

  if p_staff_id is not null then
    insert into public.teaching_assignments (teaching_group_id, staff_id, role, valid_during)
    values (v_group, p_staff_id, 'primary', daterange(greatest(v_year.starts_on, app.today()), null, '[)'));
  end if;
  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- Announcements: resolve the audience into recipients and notify (web doc §12.16)
-- audience = {roles: [teacher|student|parent], stream_ids: [], division_ids: []}
-- ---------------------------------------------------------------------------
create function public.publish_announcement(p_announcement_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v public.announcements;
  v_roles text[];
  v_streams uuid[];
  v_divisions uuid[];
  v_count int;
begin
  perform app.assert_active();
  if not app.can('announcements.college', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select * into v from public.announcements where id = p_announcement_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  v_roles     := array(select jsonb_array_elements_text(coalesce(v.audience -> 'roles', '[]')));
  v_streams   := array(select (jsonb_array_elements_text(coalesce(v.audience -> 'stream_ids', '[]')))::uuid);
  v_divisions := array(select (jsonb_array_elements_text(coalesce(v.audience -> 'division_ids', '[]')))::uuid);

  drop table if exists pg_temp._students;
  create temp table _students on commit drop as
    select e.student_id from public.student_enrollments e
    join public.students s on s.id = e.student_id and s.status = 'active'
    where e.is_primary and e.valid_during @> app.today()
      and (cardinality(v_streams) = 0 or e.stream_id = any (v_streams))
      and (cardinality(v_divisions) = 0 or e.division_id = any (v_divisions));

  insert into public.announcement_recipients (announcement_id, user_id)
  select distinct v.id, u.user_id from (
    select s.user_id from public.students s join _students x on x.student_id = s.id
    where 'student' = any (v_roles) and s.user_id is not null
    union
    select g.user_id from public.guardian_links gl join _students x on x.student_id = gl.student_id
    join public.guardians g on g.id = gl.guardian_id
    where 'parent' = any (v_roles) and gl.status = 'verified' and g.user_id is not null
    union
    select st.user_id from public.staff st
    where 'teacher' = any (v_roles) and st.status = 'active' and st.user_id is not null
      and (cardinality(v_divisions) = 0 and cardinality(v_streams) = 0
           or exists (select 1 from public.teaching_assignments ta join public.teaching_groups tg on tg.id = ta.teaching_group_id
                      left join public.batches b on b.id = tg.batch_id
                      join public.divisions d on d.id = coalesce(tg.division_id, b.division_id)
                      where ta.staff_id = st.id and ta.valid_during @> app.today()
                        and (cardinality(v_divisions) = 0 or d.id = any (v_divisions))
                        and (cardinality(v_streams) = 0 or d.stream_id = any (v_streams)))
           or exists (select 1 from public.class_teacher_assignments ct join public.divisions d on d.id = ct.division_id
                      where ct.staff_id = st.id and ct.valid_during @> app.today()
                        and (cardinality(v_divisions) = 0 or d.id = any (v_divisions))
                        and (cardinality(v_streams) = 0 or d.stream_id = any (v_streams))))
  ) u
  on conflict do nothing;
  get diagnostics v_count = row_count;

  perform app.enqueue_notification(r.user_id, 'announcement', format('ann:%s:%s', v.id, r.user_id),
    case when p.preferred_language = 'mr' and v.title_mr is not null then v.title_mr else v.title end,
    left(case when p.preferred_language = 'mr' and v.body_mr is not null then v.body_mr else v.body end, 240),
    jsonb_build_object('announcementId', v.id, 'priority', v.priority, 'invalidate', 'notices'))
  from public.announcement_recipients r join public.profiles p on p.id = r.user_id
  where r.announcement_id = v.id;

  update public.announcements set status = 'published', publish_at = coalesce(publish_at, now()) where id = v.id;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Export log: every export of personal data is audited (web doc §12.12, §18)
-- ---------------------------------------------------------------------------
create function public.log_export(p_report text, p_filters jsonb, p_rows integer, p_govt_kind text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_active();
  if not (app.can_any('reports.export') or app.can_any('govt.export')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  perform app.audit('export', 'report:' || p_report, null, null,
                    jsonb_build_object('filters', p_filters, 'rows', p_rows), null);
  if p_govt_kind is not null then
    if not app.can('govt.export', 'all') then
      raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
    end if;
    insert into public.govt_exports (kind, filters, row_count, exported_by)
    values (p_govt_kind, p_filters, p_rows, auth.uid());
  end if;
end $$;

-- Live roll-call board (web /attendance/today) and open-register refresh on mobile. RLS still
-- filters what each subscriber receives.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.day_registers, public.attendance_registers, public.notifications;
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
revoke execute on function public.claim_notification_batch(integer) from authenticated;
revoke execute on function public.complete_notification(bigint, boolean, text, text[]) from authenticated;
