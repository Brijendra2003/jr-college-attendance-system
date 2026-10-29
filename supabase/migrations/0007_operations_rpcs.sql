-- 0007 Eligibility, defaulter notices, leave, sessions, timetable publish, imports, and the
-- per-persona RPCs the mobile app calls (mobile doc §8.3).

-- ---------------------------------------------------------------------------
-- Eligibility maths (mirrors src/shared/attendance.ts; both are tested on shared fixtures)
-- ---------------------------------------------------------------------------
create function app.days_needed(p_present numeric, p_working numeric, p_min numeric) returns integer
language sql immutable as $$
  select case when p_min >= 100 then null
              else greatest(0, ceil((p_min * p_working - 100 * p_present) / (100 - p_min)))::int end
$$;

create function app.classify_eligibility(p_present numeric, p_working numeric, p_remaining integer,
                                         p_min numeric, p_kind text) returns text
language sql immutable as $$
  select case
    when p_working = 0 then 'eligible'
    when p_present * 100.0 / p_working >= p_min then 'eligible'
    when p_kind = 'final' then 'short'
    when app.days_needed(p_present, p_working, p_min) <= p_remaining then 'at_risk'
    else 'short'
  end
$$;

create function public.evaluate_eligibility(p_as_of date default null, p_kind text default 'projected',
                                            p_year_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_as_of    date := coalesce(p_as_of, app.today());
  v_year     uuid := coalesce(p_year_id, app.active_year_id());
  v_year_end date;
  v_on       date;
  v_count    int;
  r          record;
begin
  -- Callable by cron (no user) or by staff with eligibility.manage.
  if auth.uid() is not null and not app.can('eligibility.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if p_kind not in ('projected', 'final') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select max(t.ends_on) into v_year_end from public.academic_terms t where t.academic_year_id = v_year;
  if v_year_end is null then
    return 0;
  end if;
  v_on := least(v_as_of, v_year_end);

  drop table if exists pg_temp._prev;
  create temp table _prev on commit drop as
    select distinct on (es.student_id) es.student_id, es.status
    from public.eligibility_snapshots es
    where es.academic_year_id = v_year and es.kind = p_kind and es.as_of < v_as_of
    order by es.student_id, es.as_of desc;

  with div_rem as (
    select d.id as division_id,
           case when p_kind = 'final' then 0 else app.remaining_working_days(d.id, v_on, v_year_end) end as remaining
    from public.divisions d where d.academic_year_id = v_year
  ),
  base as (
    select e.student_id, e.division_id, d.standard_id, d.stream_id,
           t1.percent as t1_pct, t2.percent as t2_pct,
           coalesce(t1.working_days, 0) + coalesce(t2.working_days, 0) as working,
           coalesce(t1.present_value, 0) + coalesce(t2.present_value, 0) as present,
           dr.remaining,
           app.effective_policy(d.standard_id, d.stream_id, v_on) as pol
    from public.student_enrollments e
    join public.students s on s.id = e.student_id and s.status = 'active'
    join public.divisions d on d.id = e.division_id
    join div_rem dr on dr.division_id = e.division_id
    left join public.academic_terms at1 on at1.academic_year_id = v_year and at1.seq = 1
    left join public.academic_terms at2 on at2.academic_year_id = v_year and at2.seq = 2
    left join public.day_attendance_summaries t1 on t1.student_id = e.student_id and t1.term_id = at1.id
    left join public.day_attendance_summaries t2 on t2.student_id = e.student_id and t2.term_id = at2.id
    where e.academic_year_id = v_year and e.is_primary and e.valid_during @> v_on
  ),
  subj as (
    select b.student_id,
           coalesce(jsonb_agg(jsonb_build_object(
             'offering_id', sm.offering_id, 'component', sm.component, 'subject', sub.name,
             'percent', sm.percent, 'held', sm.held, 'attended', sm.attended))
             filter (where sm.percent < (b.pol).min_percent), '[]') as short_subjects
    from base b
    left join public.attendance_summaries sm on sm.student_id = b.student_id
    left join public.subject_offerings o on o.id = sm.offering_id
    left join public.subjects sub on sub.id = o.subject_id and sub.in_eligibility
    where sm.offering_id is null or (o.academic_year_id = v_year and sub.id is not null)
    group by b.student_id
  ),
  scored as (
    select b.*, coalesce(sj.short_subjects, '[]') as short_subjects,
           app.classify_eligibility(b.present, b.working, b.remaining, (b.pol).min_percent, p_kind) as day_status
    from base b left join subj sj on sj.student_id = b.student_id
  )
  insert into public.eligibility_snapshots as es
    (student_id, academic_year_id, division_id, as_of, kind, term1_percent, term2_percent, annual_percent,
     working_days, present_value, remaining_days, days_needed, subject_results, status)
  select sc.student_id, v_year, sc.division_id, v_as_of, p_kind, sc.t1_pct, sc.t2_pct,
         case when sc.working = 0 then null else round(sc.present * 100.0 / sc.working, 2) end,
         sc.working, sc.present, sc.remaining,
         app.days_needed(sc.present, sc.working, (sc.pol).min_percent),
         sc.short_subjects,
         case
           when cc.status = 'condoned' then 'condoned'
           when computed.s = 'eligible' then 'eligible'
           when cc.status = 'rejected' then 'not_eligible'
           when cc.status in ('recommended','submitted_to_board') then 'condonation_pending'
           else computed.s
         end
  from scored sc
  cross join lateral (
    select case
      -- each_term: the final check needs both terms at the minimum
      when p_kind = 'final' and (sc.pol).term_rule = 'each_term'
           and (coalesce(sc.t1_pct, 100) < (sc.pol).min_percent or coalesce(sc.t2_pct, 100) < (sc.pol).min_percent)
        then 'short'
      -- subject basis: a subject below the minimum demotes an otherwise eligible student
      when sc.day_status = 'eligible' and (sc.pol).eligibility_basis <> 'working_days'
           and jsonb_array_length(sc.short_subjects) > 0
        then case when p_kind = 'final' then 'short' else 'at_risk' end
      when (sc.pol).eligibility_basis in ('per_subject','per_subject_component')
        then case when jsonb_array_length(sc.short_subjects) > 0
                  then case when p_kind = 'final' then 'short' else 'at_risk' end
                  else 'eligible' end
      else sc.day_status
    end as s
  ) computed
  left join public.condonation_cases cc on cc.student_id = sc.student_id and cc.academic_year_id = v_year
  on conflict (student_id, academic_year_id, as_of, kind) do update
    set term1_percent = excluded.term1_percent, term2_percent = excluded.term2_percent,
        annual_percent = excluded.annual_percent, working_days = excluded.working_days,
        present_value = excluded.present_value, remaining_days = excluded.remaining_days,
        days_needed = excluded.days_needed, subject_results = excluded.subject_results,
        status = excluded.status, division_id = excluded.division_id, created_at = now();
  get diagnostics v_count = row_count;

  -- Notify students and guardians whose status changed since the previous snapshot.
  for r in
    select es.id, es.student_id, es.status, es.annual_percent
    from public.eligibility_snapshots es
    join _prev p on p.student_id = es.student_id and p.status <> es.status
    where es.academic_year_id = v_year and es.as_of = v_as_of and es.kind = p_kind
  loop
    perform app.enqueue_notification(u.user_id, 'eligibility_changed',
      format('elig:%s:%s', r.id, u.user_id),
      'Attendance eligibility update',
      format('Eligibility status is now: %s (%s%%).', replace(r.status, '_', ' '), coalesce(r.annual_percent::text, '–')),
      jsonb_build_object('studentId', r.student_id, 'invalidate', 'eligibility'))
    from (
      select s.user_id from public.students s where s.id = r.student_id and s.user_id is not null
      union
      select g.user_id from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
      where gl.student_id = r.student_id and gl.status = 'verified' and g.user_id is not null
    ) u;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Defaulter notices and parent meetings
-- ---------------------------------------------------------------------------
create function app.can_act_on_student(p_student_id uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can(p_perm, 'all')
    or (app.can(p_perm, 'stream') and exists (
          select 1 from public.student_enrollments e where e.student_id = p_student_id
            and e.valid_during @> app.today() and e.stream_id = any (app.my_stream_ids())))
    or (app.can(p_perm, 'class') and exists (
          select 1 from public.student_enrollments e where e.student_id = p_student_id
            and e.valid_during @> app.today() and e.division_id = any (app.my_class_division_ids())))
$$;

create function public.issue_defaulter_notice(p_student_id uuid, p_level text,
                                              p_language text default 'mr', p_channel text default 'both') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_enr  public.student_enrollments;
  v_year public.academic_years;
  v_pct  numeric;
  v_subj jsonb;
  v_id   uuid;
  v_name text;
begin
  perform app.assert_active();
  if not app.can_act_on_student(p_student_id, 'notices.defaulter.issue') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  v_enr := app.current_enrollment(p_student_id);
  if v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_ENROLLED';
  end if;
  select * into v_year from public.academic_years where id = v_enr.academic_year_id;

  select case when sum(s.working_days) = 0 then null
              else round(sum(s.present_value) * 100.0 / sum(s.working_days), 2) end
    into v_pct
  from public.day_attendance_summaries s
  join public.academic_terms t on t.id = s.term_id and t.academic_year_id = v_year.id
  where s.student_id = p_student_id;

  select coalesce(jsonb_agg(jsonb_build_object('subject', sub.name, 'component', sm.component, 'percent', sm.percent)), '[]')
    into v_subj
  from public.attendance_summaries sm
  join public.subject_offerings o on o.id = sm.offering_id and o.academic_year_id = v_year.id
  join public.subjects sub on sub.id = o.subject_id
  where sm.student_id = p_student_id and sm.percent is not null;

  insert into public.defaulter_notices
    (student_id, division_id, level, period_from, period_to, day_percent, subject_percents, language, channel, issued_by)
  values (p_student_id, v_enr.division_id, p_level, v_year.starts_on, app.today(), v_pct, v_subj,
          p_language, p_channel, auth.uid())
  returning id into v_id;

  select full_name into v_name from public.students where id = p_student_id;
  perform app.enqueue_notification(g.user_id, 'defaulter_warning',
    format('def:%s:%s:%s:%s', p_student_id, p_level, app.today(), g.user_id),
    case g.preferred_language when 'mr' then 'उपस्थिती कमी असल्याबाबत सूचना' else 'Attendance shortage notice' end,
    case g.preferred_language
      when 'mr' then format('%s यांची उपस्थिती %s%% आहे. कृपया सूचना वाचून "मी ही सूचना वाचली" दाबा.', v_name, coalesce(v_pct::text, '–'))
      else format('%s''s attendance is %s%%. Please read the notice and tap "I have read this notice".', v_name, coalesce(v_pct::text, '–')) end,
    jsonb_build_object('studentId', p_student_id, 'noticeId', v_id,
                       'url', format('jcas://parent/notices/%s', v_id), 'invalidate', 'notices'))
  from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
  where gl.student_id = p_student_id and gl.status = 'verified' and g.user_id is not null;

  return v_id;
end $$;

create function public.acknowledge_notice(p_notice_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_student uuid;
begin
  perform app.assert_active();
  select student_id into v_student from public.defaulter_notices where id = p_notice_id;
  if v_student is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not app.is_guardian_of(v_student) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  update public.defaulter_notices
     set acknowledged_by = auth.uid(), acknowledged_at = now()
   where id = p_notice_id and acknowledged_at is null;
  return jsonb_build_object('result', 'ok');
end $$;

create function public.log_parent_meeting(p_student_id uuid, p_outcome text, p_met_on date default null,
                                          p_mode text default 'in_person', p_attendees text default null,
                                          p_follow_up_on date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_enr public.student_enrollments; v_id uuid;
begin
  perform app.assert_active();
  if not app.can_act_on_student(p_student_id, 'notices.defaulter.issue') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  v_enr := app.current_enrollment(p_student_id);
  insert into public.parent_meetings (student_id, division_id, met_on, mode, attendees, outcome, follow_up_on, logged_by)
  values (p_student_id, v_enr.division_id, coalesce(p_met_on, app.today()), p_mode, p_attendees, p_outcome,
          p_follow_up_on, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Leave (student, guardian on behalf, office)
-- ---------------------------------------------------------------------------
create function app.class_teacher_user(p_division_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select st.user_id from public.class_teacher_assignments ct join public.staff st on st.id = ct.staff_id
  where ct.division_id = p_division_id and ct.valid_during @> app.today()
$$;

create function public.apply_leave(p_leave_type text, p_from date, p_to date, p_reason text,
                                   p_student_id uuid default null, p_span text default 'full_day',
                                   p_document_asset_ids uuid[] default '{}', p_session_ids uuid[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid := coalesce(p_student_id, app.my_student_id());
  v_kind    text;
  v_enr     public.student_enrollments;
  v_type    public.leave_types;
  v_policy  public.attendance_policies;
  v_status  text;
  v_id      uuid;
begin
  perform app.assert_active();
  if v_student is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if v_student = app.my_student_id() then
    v_kind := 'student';
  elsif app.is_guardian_of(v_student) then
    v_kind := 'guardian';
  elsif app.can('students.manage', 'all') then
    v_kind := 'office';
  else
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  select * into v_type from public.leave_types where code = p_leave_type and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEAVE_TYPE_INVALID';
  end if;
  if p_to < p_from then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if v_kind <> 'office' and p_from < app.today() - v_type.max_backdate_days then
    raise exception using errcode = 'P0001', message = 'LEAVE_TOO_OLD';
  end if;
  if v_type.requires_document_after_days is not null
     and (p_to - p_from + 1) > v_type.requires_document_after_days
     and coalesce(array_length(p_document_asset_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'LEAVE_DOCUMENT_REQUIRED';
  end if;

  v_enr := app.current_enrollment(v_student, greatest(p_from, app.today()));
  if v_enr.id is null then
    v_enr := app.current_enrollment(v_student);
  end if;
  if v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_ENROLLED';
  end if;
  v_policy := app.division_policy(v_enr.division_id, app.today());
  v_status := case when v_kind = 'student' and v_policy.leave_requires_guardian_ack then 'awaiting_guardian' else 'pending' end;

  begin
    insert into public.leave_requests
      (student_id, division_id, leave_type, span, from_date, to_date, leave_period, session_ids, reason,
       document_asset_ids, applied_by_kind, applied_by, guardian_ack_by, guardian_ack_at, status)
    values (v_student, v_enr.division_id, p_leave_type, p_span, p_from, p_to,
            tstzrange(app.ist(p_from, time '00:00'), app.ist(p_to + 1, time '00:00')),
            p_session_ids, p_reason, p_document_asset_ids, v_kind, auth.uid(),
            case when v_kind = 'guardian' then auth.uid() end,
            case when v_kind = 'guardian' then now() end,
            v_status)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception using errcode = 'P0001', message = 'LEAVE_OVERLAP';
  end;

  if v_status = 'awaiting_guardian' then
    perform app.enqueue_notification(g.user_id, 'leave_ack_needed', format('leave:%s:ack:%s', v_id, g.user_id),
      'Leave request needs your acknowledgement', p_reason,
      jsonb_build_object('leaveId', v_id, 'studentId', v_student, 'url', 'jcas://parent/leave'))
    from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
    where gl.student_id = v_student and gl.status = 'verified' and g.user_id is not null;
  else
    perform app.enqueue_notification(app.class_teacher_user(v_enr.division_id), 'leave_submitted',
      format('leave:%s:submitted', v_id), 'New leave request', p_reason,
      jsonb_build_object('leaveId', v_id, 'url', 'jcas://teacher/inbox'))
    where app.class_teacher_user(v_enr.division_id) is not null;
  end if;
  return v_id;
end $$;

create function public.acknowledge_leave(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.leave_requests;
begin
  perform app.assert_active();
  select * into v from public.leave_requests where id = p_id for update;
  if not found or not app.is_guardian_of(v.student_id) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if v.status <> 'awaiting_guardian' then
    return jsonb_build_object('result', 'noop');
  end if;
  update public.leave_requests set status = 'pending', guardian_ack_by = auth.uid(), guardian_ack_at = now() where id = p_id;
  perform app.enqueue_notification(app.class_teacher_user(v.division_id), 'leave_submitted',
    format('leave:%s:submitted', p_id), 'New leave request', v.reason,
    jsonb_build_object('leaveId', p_id, 'url', 'jcas://teacher/inbox'))
  where app.class_teacher_user(v.division_id) is not null;
  return jsonb_build_object('result', 'ok');
end $$;

create function public.cancel_leave(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.leave_requests;
begin
  perform app.assert_active();
  select * into v from public.leave_requests where id = p_id for update;
  if not found or not (v.applied_by = auth.uid() or v.student_id = app.my_student_id() or app.is_guardian_of(v.student_id)) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if v.status not in ('awaiting_guardian','pending','needs_info') then
    raise exception using errcode = 'P0001', message = 'LEAVE_NOT_CANCELLABLE';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  return jsonb_build_object('result', 'ok');
end $$;

create function public.decide_leave(p_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v        public.leave_requests;
  v_policy public.attendance_policies;
  v_status text;
  v_changed int := 0;
  v_terms  uuid[];
begin
  perform app.assert_active();
  if p_decision not in ('approved','rejected','needs_info') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into v from public.leave_requests where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not (app.can('leave.student.decide', 'all')
          or (app.can('leave.student.decide', 'class') and v.division_id = any (app.my_class_division_ids()))
          or (app.can('leave.student.decide', 'stream') and exists
               (select 1 from public.divisions d where d.id = v.division_id and d.stream_id = any (app.my_stream_ids())))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if v.status not in ('pending','needs_info') then
    raise exception using errcode = 'P0001', message = 'LEAVE_ALREADY_DECIDED';
  end if;

  update public.leave_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;

  -- Retroactive leave: past absences become leave (audited; closed months need the correction flow).
  v_policy := app.division_policy(v.division_id, app.today());
  if p_decision = 'approved' and v_policy.leave_applies_retroactively then
    select status_code into v_status from public.leave_types where code = v.leave_type;
    with changed as (
      update public.day_attendance da
         set status_code = v_status, source = 'leave', marked_by = auth.uid(), marked_at = now()
        from public.day_registers dr
       where dr.id = da.day_register_id and not dr.month_closed
         and da.student_id = v.student_id and da.status_code = 'A'
         and da.att_date between v.from_date and least(v.to_date, app.today())
      returning da.day_register_id, da.term_id
    ), hist as (
      insert into public.attendance_record_history (kind, register_id, student_id, old_status, new_status, source, reason, changed_by)
      select 'day', c.day_register_id, v.student_id, 'A', v_status, 'leave', 'Leave approved', auth.uid() from changed c
      returning 1
    )
    select count(*), array_agg(distinct c.term_id) into v_changed, v_terms from changed c;
    if v_changed > 0 then
      perform app.recompute_day_summaries(array[v.student_id], t) from unnest(v_terms) t;
    end if;
  end if;

  perform app.enqueue_notification(u.user_id, 'leave_decided', format('leave:%s:%s:%s', p_id, p_decision, u.user_id),
    format('Leave request %s', replace(p_decision, '_', ' ')), coalesce(p_note, v.reason),
    jsonb_build_object('leaveId', p_id, 'studentId', v.student_id, 'invalidate', 'leave,day'))
  from (
    select s.user_id from public.students s where s.id = v.student_id and s.user_id is not null
    union
    select g.user_id from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
    where gl.student_id = v.student_id and gl.status = 'verified' and g.user_id is not null
  ) u;
  return jsonb_build_object('result', 'ok', 'records_changed', v_changed);
end $$;

-- ---------------------------------------------------------------------------
-- Session changes
-- ---------------------------------------------------------------------------
create function public.cancel_session(p_session_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.class_sessions;
begin
  perform app.assert_active();
  select * into v from public.class_sessions where id = p_session_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not (app.can('sessions.manage', 'all')
          or (app.can('sessions.manage', 'stream') and v.stream_id = any (app.my_stream_ids()))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if exists (select 1 from public.attendance_registers r where r.session_id = p_session_id and r.state in ('submitted','locked')) then
    raise exception using errcode = 'P0001', message = 'SESSION_HAS_ATTENDANCE';
  end if;
  update public.class_sessions set status = 'cancelled', status_reason = p_reason where id = p_session_id;
  update public.attendance_registers set state = 'voided' where session_id = p_session_id;
  perform app.audit('cancel_session', 'class_sessions', p_session_id::text, null, null, p_reason);
  return jsonb_build_object('result', 'ok');
end $$;

create function public.assign_substitute(p_session_id uuid, p_staff_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.class_sessions; v_user uuid;
begin
  perform app.assert_active();
  select * into v from public.class_sessions where id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not (app.can('sessions.manage', 'all')
          or (app.can('sessions.manage', 'stream') and v.stream_id = any (app.my_stream_ids()))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  insert into public.session_staff (session_id, staff_id, role) values (p_session_id, p_staff_id, 'substitute')
  on conflict (session_id, staff_id) do update set role = 'substitute';
  select user_id into v_user from public.staff where id = p_staff_id;
  if v_user is not null then
    perform app.enqueue_notification(v_user, 'substitution_assigned', format('sub:%s:%s', p_session_id, p_staff_id),
      'Substitution assigned', format('You have a substitution on %s at %s.',
        to_char(v.session_date, 'DD Mon'), to_char(v.starts_at at time zone 'Asia/Kolkata', 'HH12:MI AM')),
      jsonb_build_object('sessionId', p_session_id, 'url', 'jcas://teacher/today', 'invalidate', 'sessions'));
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- Timetable publish: generate sessions for the remaining term dates
-- ---------------------------------------------------------------------------
create function public.publish_timetable(p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v       public.timetable_versions;
  v_term  public.academic_terms;
  v_from  date;
  v_removed int;
  v_created int;
begin
  perform app.assert_active();
  if not app.can('timetable.publish', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select * into v from public.timetable_versions where id = p_version_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  select * into v_term from public.academic_terms where id = v.term_id;
  v_from := greatest(v.effective_from, app.today());

  -- Future sessions of earlier versions that nobody has marked yet are replaced.
  with old as (
    select cs.id from public.class_sessions cs
    join public.timetable_slots sl on sl.id = cs.source_slot_id
    join public.timetable_versions tv on tv.id = sl.version_id
    where tv.academic_year_id = v.academic_year_id and tv.term_id = v.term_id
      and tv.standard_id = v.standard_id and tv.stream_id = v.stream_id
      and cs.session_date >= v_from
      and not exists (select 1 from public.attendance_registers r
                      where r.session_id = cs.id and r.state <> 'pending')
  ), del_reg as (
    delete from public.attendance_registers r using old where r.session_id = old.id returning 1
  ), del_staff as (
    delete from public.session_staff ss using old where ss.session_id = old.id returning 1
  )
  delete from public.class_sessions cs using old where cs.id = old.id;
  get diagnostics v_removed = row_count;

  update public.timetable_versions set status = 'archived'
   where academic_year_id = v.academic_year_id and term_id = v.term_id
     and standard_id = v.standard_id and stream_id = v.stream_id
     and status = 'published' and id <> v.id;

  with days as (
    select d::date as d from generate_series(v_from, v_term.ends_on, interval '1 day') d
  ), slots as (
    select sl.*, tg.offering_id, tg.component, coalesce(tg.division_id, b.division_id) as division_id,
           o.stream_id, o.standard_id
    from public.timetable_slots sl
    join public.teaching_groups tg on tg.id = sl.teaching_group_id
    join public.subject_offerings o on o.id = tg.offering_id
    left join public.batches b on b.id = tg.batch_id
    where sl.version_id = v.id
  ), ins as (
    insert into public.class_sessions
      (session_date, starts_at, ends_at, teaching_group_id, offering_id, component, session_type, room_id,
       source_slot_id, division_id, stream_id, standard_id, term_id)
    select dd.d, app.ist(dd.d, s.starts_at), app.ist(dd.d, s.ends_at), s.teaching_group_id, s.offering_id,
           s.component, s.session_type, s.room_id, s.id, s.division_id, s.stream_id, s.standard_id, v.term_id
    from days dd join slots s on s.weekday = extract(isodow from dd.d)
    where app.is_working_day(s.division_id, dd.d)
    returning id, source_slot_id
  )
  insert into public.session_staff (session_id, staff_id, role)
  select ins.id, coalesce(sl.staff_id, ta.staff_id), 'primary'
  from ins
  join public.timetable_slots sl on sl.id = ins.source_slot_id
  left join lateral (select t.staff_id from public.teaching_assignments t
                     where t.teaching_group_id = sl.teaching_group_id and t.role = 'primary'
                       and t.valid_during @> v_from limit 1) ta on true
  where coalesce(sl.staff_id, ta.staff_id) is not null;

  select count(*) into v_created from public.class_sessions cs
  join public.timetable_slots sl on sl.id = cs.source_slot_id where sl.version_id = v.id;

  update public.timetable_versions set status = 'published', published_at = now(), published_by = auth.uid()
   where id = v.id;
  perform app.audit('publish_timetable', 'timetable_versions', v.id::text, null,
                    jsonb_build_object('sessions', v_created, 'replaced', v_removed), null);
  return jsonb_build_object('result', 'ok', 'sessions_created', v_created, 'sessions_replaced', v_removed);
end $$;

-- ---------------------------------------------------------------------------
-- Student import (admissions, CAP lists). Idempotent on GR No. / CAP application no. / SSC seat no.
-- p_commit = false validates only (preview).
-- ---------------------------------------------------------------------------
create function public.import_students(p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row      jsonb;
  v_no       int := 0;
  v_out      jsonb := '[]';
  v_errors   text[];
  v_existing uuid;
  v_div      public.divisions;
  v_student  uuid;
  v_gr       text;
  v_roll     text;
  v_admitted date;
  v_gid      uuid;
  v_rel      text;
  v_counts   jsonb := '{"new":0,"existing":0,"error":0}';
  v_outcome  text;
begin
  perform app.assert_active();
  if not app.can('admissions.import', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_no := v_no + 1;
    v_errors := '{}';
    v_student := null;

    if coalesce(trim(v_row ->> 'surname'), '') = '' then v_errors := array_append(v_errors, 'surname is required'::text); end if;
    if coalesce(trim(v_row ->> 'first_name'), '') = '' then v_errors := array_append(v_errors, 'first_name is required'::text); end if;
    if (v_row ->> 'dob') is not null and (v_row ->> 'dob') !~ '^\d{4}-\d{2}-\d{2}$' then
      v_errors := array_append(v_errors, 'dob must be YYYY-MM-DD'::text);
    end if;
    if (v_row ->> 'gender') is not null and lower(v_row ->> 'gender') not in ('male','female','other') then
      v_errors := array_append(v_errors, 'gender must be male, female or other'::text);
    end if;

    select d.* into v_div from public.divisions d
    where d.academic_year_id = app.active_year_id() and upper(d.name) = upper(trim(v_row ->> 'division'));
    if v_div.id is null then v_errors := array_append(v_errors, format('division "%s" not found in the active year', v_row ->> 'division')::text); end if;

    select s.id into v_existing from public.students s
    where (nullif(v_row ->> 'gr_no', '') is not null and s.gr_no = v_row ->> 'gr_no')
       or (nullif(v_row ->> 'cap_application_no', '') is not null and s.cap_application_no = v_row ->> 'cap_application_no')
       or (nullif(v_row ->> 'ssc_seat_no', '') is not null and s.ssc_seat_no = v_row ->> 'ssc_seat_no'
           and s.dob is not distinct from nullif(v_row ->> 'dob', '')::date)
    limit 1;

    if array_length(v_errors, 1) > 0 then
      v_outcome := 'error';
    elsif v_existing is not null then
      v_outcome := 'existing';
    else
      v_outcome := 'new';
    end if;

    if p_commit and v_outcome = 'new' then
      begin
        v_admitted := coalesce(nullif(v_row ->> 'admitted_on', '')::date, app.today());
        v_gr := coalesce(nullif(v_row ->> 'gr_no', ''), nextval('public.gr_no_seq')::text);
        insert into public.students
          (gr_no, cap_application_no, saral_id, pen, apaar_id, surname, first_name, father_name, mother_name, name_mr,
           dob, gender, ssc_board, ssc_seat_no, ssc_percent, medium_code, admission_type, admitted_on)
        values (v_gr, nullif(v_row ->> 'cap_application_no', ''), nullif(v_row ->> 'saral_id', ''),
                nullif(v_row ->> 'pen', ''), nullif(v_row ->> 'apaar_id', ''),
                trim(v_row ->> 'surname'), trim(v_row ->> 'first_name'),
                nullif(trim(v_row ->> 'father_name'), ''), nullif(trim(v_row ->> 'mother_name'), ''),
                nullif(v_row ->> 'name_mr', ''), nullif(v_row ->> 'dob', '')::date, lower(nullif(v_row ->> 'gender', '')),
                nullif(v_row ->> 'ssc_board', ''), nullif(v_row ->> 'ssc_seat_no', ''),
                nullif(v_row ->> 'ssc_percent', '')::numeric, v_div.medium_code,
                coalesce(nullif(v_row ->> 'admission_type', ''), 'cap'), v_admitted)
        returning id into v_student;

        -- Roll numbers: given, or appended after the highest numeric roll in the division.
        v_roll := nullif(v_row ->> 'roll_no', '');
        if v_roll is null then
          select coalesce(max(nullif(regexp_replace(e.roll_no, '\D', '', 'g'), '')::int), 0) + 1 into v_roll
          from public.student_enrollments e where e.division_id = v_div.id and upper_inf(e.valid_during);
        end if;

        insert into public.student_enrollments
          (student_id, academic_year_id, standard_id, stream_id, medium_code, division_id, roll_no, valid_during, reason)
        values (v_student, v_div.academic_year_id, v_div.standard_id, v_div.stream_id, v_div.medium_code, v_div.id,
                v_roll, daterange(v_admitted, null, '[)'), 'import');

        -- A guardian is created only when there is a way to reach them (email or phone).
        -- Father/mother names in the list are the student's name parts, so the surname is added.
        foreach v_rel in array array['father','mother','guardian'] loop
          if coalesce(nullif(trim(v_row ->> (v_rel || '_email')), ''), nullif(trim(v_row ->> (v_rel || '_phone')), '')) is not null
             and nullif(trim(v_row ->> (v_rel || '_name')), '') is not null then
            v_gid := null;
            if nullif(trim(v_row ->> (v_rel || '_email')), '') is not null then
              select id into v_gid from public.guardians where lower(email) = lower(trim(v_row ->> (v_rel || '_email')));
            end if;
            if v_gid is null then
              insert into public.guardians (full_name, relation, email, phone)
              values (case when v_rel = 'guardian' then trim(v_row ->> 'guardian_name')
                           else trim(v_row ->> (v_rel || '_name')) || ' ' || trim(v_row ->> 'surname') end,
                      v_rel,
                      lower(nullif(trim(v_row ->> (v_rel || '_email')), '')), nullif(trim(v_row ->> (v_rel || '_phone')), ''))
              returning id into v_gid;
            end if;
            insert into public.guardian_links (student_id, guardian_id, is_primary)
            values (v_student, v_gid, not exists (select 1 from public.guardian_links gl where gl.student_id = v_student))
            on conflict (student_id, guardian_id) do nothing;
          end if;
        end loop;
      exception when others then
        v_outcome := 'error';
        v_errors := array_append(v_errors, sqlerrm::text);
        v_student := null;
      end;
    end if;

    v_counts := jsonb_set(v_counts, array[v_outcome], to_jsonb((v_counts ->> v_outcome)::int + 1));
    v_out := v_out || jsonb_build_object('row', v_no, 'outcome', v_outcome, 'errors', to_jsonb(v_errors),
                                         'student_id', coalesce(v_student, v_existing));
  end loop;

  if p_commit then
    perform app.audit('import_students', 'students', null, null, v_counts, null);
  end if;
  return jsonb_build_object('summary', v_counts, 'rows', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- Per-persona RPCs used by the mobile app
-- ---------------------------------------------------------------------------
create function public.my_capabilities() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roles', to_jsonb(app.my_roles()),
    'staff_id', app.my_staff_id(),
    'student_id', app.my_student_id(),
    'guardian_id', app.my_guardian_id(),
    'class_divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name))
                                 from public.divisions d where d.id = any (app.my_class_division_ids())), '[]'),
    'coordinator_streams', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name))
                                     from public.streams s where s.id = any (app.my_stream_ids())), '[]'),
    'is_supervisor', 'supervisor' = any (app.my_roles()),
    'features', coalesce((select c.value from public.app_config c where c.key = 'features'), '{}')
  )
$$;

create function public.register_device(p_token text, p_platform text, p_app_version text default null,
                                       p_device_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_active();
  insert into public.device_tokens (user_id, token, platform, app_version, device_id, last_seen_at, disabled_at)
  values (auth.uid(), p_token, p_platform, p_app_version, p_device_id, now(), null)
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform, app_version = excluded.app_version,
        device_id = excluded.device_id, last_seen_at = now(), disabled_at = null;
end $$;

create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v = row_count;
  return v;
end $$;

create function public.record_consent(p_student_id uuid, p_purpose text, p_notice_version text default 'v1') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.assert_active();
  if not app.is_guardian_of(p_student_id) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  insert into public.consents (student_id, guardian_id, purpose, notice_version, method, recorded_by)
  values (p_student_id, app.my_guardian_id(), p_purpose, p_notice_version, 'in_app', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Does the caller (student or guardian) speak for this student?
create function app.speaks_for(p_student_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_student_id = app.my_student_id() or app.is_guardian_of(p_student_id)
$$;

create function public.raise_attendance_dispute(p_kind text, p_record_id uuid, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_div uuid; v_id uuid;
begin
  perform app.assert_active();
  if p_kind = 'day' then
    select student_id, division_id into v_student, v_div from public.day_attendance where id = p_record_id;
  else
    select student_id, division_id into v_student, v_div from public.attendance_records where id = p_record_id;
  end if;
  if v_student is null or not app.speaks_for(v_student) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  insert into public.attendance_disputes (kind, record_id, student_id, division_id, raised_by, message)
  values (p_kind, p_record_id, v_student, v_div, auth.uid(), p_message)
  returning id into v_id;
  perform app.enqueue_notification(app.class_teacher_user(v_div), 'attendance_dispute', format('disp:%s', v_id),
    'Attendance query', p_message, jsonb_build_object('disputeId', v_id, 'url', 'jcas://teacher/inbox'))
  where app.class_teacher_user(v_div) is not null;
  return v_id;
end $$;

create function public.my_day_history(p_term_id uuid, p_student_id uuid default null)
returns table (record_id uuid, att_date date, status_code text, source text, division_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_student uuid := coalesce(p_student_id, app.my_student_id());
begin
  if v_student is null or not (app.speaks_for(v_student) or app.can_see_student(v_student, 'attendance.view')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  return query
    select da.id, da.att_date, da.status_code, da.source, d.name
    from public.day_attendance da
    join public.day_registers dr on dr.id = da.day_register_id and dr.state in ('submitted','locked','reopened')
    join public.divisions d on d.id = da.division_id
    where da.student_id = v_student and da.term_id = p_term_id
    order by da.att_date desc;
end $$;

create function public.my_subject_attendance(p_offering_id uuid, p_student_id uuid default null)
returns table (record_id uuid, session_date date, starts_at timestamptz, component text, session_type text, status_code text)
language plpgsql stable security definer set search_path = '' as $$
declare v_student uuid := coalesce(p_student_id, app.my_student_id());
begin
  if v_student is null or not (app.speaks_for(v_student) or app.can_see_student(v_student, 'attendance.view')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  return query
    select ar.id, ar.session_date, cs.starts_at, ar.component, cs.session_type, ar.status_code
    from public.attendance_records ar
    join public.attendance_registers r on r.id = ar.register_id and r.state in ('submitted','locked','reopened')
    join public.class_sessions cs on cs.id = ar.session_id and cs.status not in ('cancelled','rescheduled')
    where ar.student_id = v_student and ar.offering_id = p_offering_id
    order by cs.starts_at desc;
end $$;

-- Division overview for the class-teacher desk (web) and My Class (mobile).
create function public.class_overview(p_division_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_div  public.divisions;
  v_pol  public.attendance_policies;
begin
  perform app.assert_active();
  if not app.can_see_division(p_division_id, 'attendance.view') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select * into v_div from public.divisions where id = p_division_id;
  v_pol := app.effective_policy(v_div.standard_id, v_div.stream_id, app.today());

  return jsonb_build_object(
    'division', jsonb_build_object('id', v_div.id, 'name', v_div.name),
    'min_percent', v_pol.min_percent, 'warn_percent', v_pol.warn_percent,
    'today', (select jsonb_build_object('state', dr.state, 'version', dr.version,
                     'present', count(*) filter (where sc.counts_as_attended),
                     'absent', count(*) filter (where not sc.counts_as_attended),
                     'total', count(da.id))
              from public.day_registers dr
              left join public.day_attendance da on da.day_register_id = dr.id
              left join public.attendance_status_codes sc on sc.code = da.status_code
              where dr.division_id = p_division_id and dr.att_date = app.today()
              group by dr.id),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'roll_no', r.roll_no, 'name', r.full_name,
               'working_days', y.working, 'present', y.present,
               'percent', case when y.working = 0 then null else round(y.present * 100.0 / y.working, 2) end,
               'days_needed', app.days_needed(y.present, y.working, v_pol.min_percent),
               'eligibility', el.status,
               'last_notice', (select jsonb_build_object('level', n.level, 'issued_at', n.issued_at,
                                                         'acknowledged_at', n.acknowledged_at)
                               from public.defaulter_notices n where n.student_id = r.student_id
                               order by n.issued_at desc limit 1))
             order by nullif(regexp_replace(r.roll_no, '\D', '', 'g'), '')::int nulls last, r.full_name)
      from app.division_roster(p_division_id, app.today()) r
      cross join lateral (
        select coalesce(sum(s.working_days), 0) as working, coalesce(sum(s.present_value), 0) as present
        from public.day_attendance_summaries s
        join public.academic_terms t on t.id = s.term_id and t.academic_year_id = v_div.academic_year_id
        where s.student_id = r.student_id) y
      left join lateral (
        select es.status from public.eligibility_snapshots es
        where es.student_id = r.student_id and es.academic_year_id = v_div.academic_year_id
        order by es.as_of desc, es.kind desc limit 1) el on true), '[]'));
end $$;
