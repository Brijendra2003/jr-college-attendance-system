-- 0006 Attendance engine (web doc §9): calendar, policy resolution, rosters, idempotent submission,
-- summaries, locking, corrections, holidays and month close. Both apps call these RPCs.
--
-- Error convention: business outcomes the client must handle (duplicate, conflict, locked …) are
-- returned in `result`. Programming/permission errors raise with a stable code in `message`
-- (ATT_FORBIDDEN, ATT_INVALID_STATUS …) that src/shared/errors.ts maps to a localised message.

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------
create function app.term_for_date(p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.academic_terms t
  where p_date between t.starts_on and t.ends_on
  order by t.starts_on desc limit 1
$$;

create function app.active_year_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select y.id from public.academic_years y where y.status = 'active' limit 1
$$;

-- A date is a working day for a division (null = college-wide) when it is inside a term,
-- not a Sunday or holiday/vacation, unless a working-day override covers it.
create function app.is_working_day(p_division_id uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  with ev as (
    select e.kind from public.academic_calendar_events e
    where p_date between e.starts_on and e.ends_on
      and (e.division_ids is null or p_division_id = any (e.division_ids))
  )
  select app.term_for_date(p_date) is not null
     and (
       exists (select 1 from ev where kind = 'working_override')
       or (extract(isodow from p_date) <> 7
           and not exists (select 1 from ev where kind in
                ('public_holiday','college_holiday','emergency_holiday','vacation')))
     )
$$;

-- Working days for a division in (p_after, p_until].
create function app.remaining_working_days(p_division_id uuid, p_after date, p_until date) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_after + 1, p_until, interval '1 day') d
  where app.is_working_day(p_division_id, d::date)
$$;

-- ---------------------------------------------------------------------------
-- Policy resolution: stream → standard → college, effective on the date
-- ---------------------------------------------------------------------------
create function app.effective_policy(p_standard_id uuid, p_stream_id uuid, p_on date)
returns public.attendance_policies
language plpgsql stable security definer set search_path = '' as $$
declare v public.attendance_policies;
begin
  select p.* into v from public.attendance_policies p
  where p.effective_from <= p_on and (p.effective_to is null or p.effective_to >= p_on)
    and (p.scope_kind = 'college'
         or (p.scope_kind = 'standard' and p.scope_id = p_standard_id)
         or (p.scope_kind = 'stream' and p.scope_id = p_stream_id))
  order by case p.scope_kind when 'stream' then 1 when 'standard' then 2 else 3 end, p.effective_from desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'POLICY_MISSING';
  end if;
  return v;
end $$;

create function app.division_policy(p_division_id uuid, p_on date) returns public.attendance_policies
language sql stable security definer set search_path = '' as $$
  select app.effective_policy(d.standard_id, d.stream_id, p_on) from public.divisions d where d.id = p_division_id
$$;

-- ---------------------------------------------------------------------------
-- Rosters
-- ---------------------------------------------------------------------------
create function app.approved_leave_status(p_student_id uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select lt.status_code
  from public.leave_requests lr join public.leave_types lt on lt.code = lr.leave_type
  where lr.student_id = p_student_id and lr.status = 'approved'
    and p_date between lr.from_date and lr.to_date and lr.span <> 'periods'
  limit 1
$$;

-- Students on a division's roll for a date (primary enrollment contains the date).
create function app.division_roster(p_division_id uuid, p_date date)
returns table (student_id uuid, roll_no text, full_name text, name_mr text, batch_id uuid,
               enrolled_from date, suggested_status text)
language sql stable security definer set search_path = '' as $$
  select s.id, e.roll_no, s.full_name, s.name_mr, e.batch_id, lower(e.valid_during),
         app.approved_leave_status(s.id, p_date)
  from public.student_enrollments e
  join public.students s on s.id = e.student_id
  where e.division_id = p_division_id and e.is_primary and e.valid_during @> p_date
    and s.status <> 'admission_cancelled'
$$;

-- Students in a session's teaching group on the session date.
create function app.session_roster(p_session_id uuid)
returns table (student_id uuid, roll_no text, full_name text, name_mr text, batch_id uuid,
               division_id uuid, enrolled_from date, suggested_status text)
language sql stable security definer set search_path = '' as $$
  with cs as (
    select c.*, tg.kind, tg.division_id as g_division, tg.batch_id as g_batch
    from public.class_sessions c join public.teaching_groups tg on tg.id = c.teaching_group_id
    where c.id = p_session_id
  )
  select s.id, e.roll_no, s.full_name, s.name_mr, e.batch_id, e.division_id, lower(e.valid_during),
         app.approved_leave_status(s.id, cs.session_date)
  from cs
  join public.student_enrollments e on e.is_primary and e.valid_during @> cs.session_date
  join public.students s on s.id = e.student_id and s.status <> 'admission_cancelled'
  where (cs.kind = 'division' and e.division_id = cs.g_division)
     or (cs.kind = 'batch' and e.batch_id = cs.g_batch)
     or (cs.kind = 'custom' and exists (
           select 1 from public.teaching_group_members m
           where m.group_id = cs.teaching_group_id and m.student_id = s.id and m.valid_during @> cs.session_date))
$$;

-- ---------------------------------------------------------------------------
-- Summaries
-- ---------------------------------------------------------------------------
create function app.recompute_day_summaries(p_student_ids uuid[], p_term_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.day_attendance_summaries as s
    (student_id, term_id, working_days, present_value, absent_days, percent, updated_at)
  select st.id, p_term_id,
         coalesce(agg.working, 0) + coalesce(extra.days, 0),
         coalesce(agg.present, 0),
         coalesce(agg.absent, 0),
         case when coalesce(agg.working, 0) + coalesce(extra.days, 0) = 0 then null
              else round(coalesce(agg.present, 0) * 100.0 / (coalesce(agg.working, 0) + coalesce(extra.days, 0)), 2) end,
         now()
  from unnest(p_student_ids) as st(id)
  left join lateral (
    select count(*) filter (where sc.counts_in_held) as working,
           sum(sc.day_value) filter (where sc.counts_in_held) as present,
           count(*) filter (where sc.counts_in_held and sc.day_value = 0) as absent,
           min(da.att_date) as first_date,
           (array_agg(da.division_id order by da.att_date))[1] as first_division
    from public.day_attendance da
    join public.day_registers dr on dr.id = da.day_register_id
    join public.attendance_status_codes sc on sc.code = da.status_code
    where da.student_id = st.id and da.term_id = p_term_id
      and dr.state in ('submitted','locked','reopened')
  ) agg on true
  -- count_from = term_start: working days before a late admission also count (as absent)
  left join lateral (
    select count(*)::int as days
    from public.day_registers dr
    join public.divisions d on d.id = dr.division_id
    join public.academic_terms t on t.id = dr.term_id
    where agg.first_division is not null
      and dr.division_id = agg.first_division and dr.term_id = p_term_id
      and dr.state in ('submitted','locked','reopened')
      and dr.att_date < agg.first_date
      and (app.effective_policy(d.standard_id, d.stream_id, dr.att_date)).count_from = 'term_start'
  ) extra on true
  on conflict (student_id, term_id) do update
    set working_days = excluded.working_days, present_value = excluded.present_value,
        absent_days = excluded.absent_days, percent = excluded.percent, updated_at = now();
end $$;

create function app.recompute_subject_summaries(p_student_ids uuid[], p_offering_id uuid, p_component text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.attendance_summaries as s
    (student_id, offering_id, component, held, attended, excused, percent, updated_at)
  select st.id, p_offering_id, p_component,
         coalesce(agg.held, 0), coalesce(agg.attended, 0), coalesce(agg.excused, 0),
         case when coalesce(agg.held, 0) = 0 then null else round(agg.attended * 100.0 / agg.held, 2) end,
         now()
  from unnest(p_student_ids) as st(id)
  left join lateral (
    select sum(ar.weight) filter (where sc.counts_in_held) as held,
           sum(ar.weight) filter (where sc.counts_in_held and sc.counts_as_attended) as attended,
           sum(ar.weight) filter (where not sc.counts_in_held) as excused
    from public.attendance_records ar
    join public.attendance_registers r on r.id = ar.register_id
    join public.class_sessions cs on cs.id = ar.session_id
    join public.attendance_status_codes sc on sc.code = ar.status_code
    where ar.student_id = st.id and ar.offering_id = p_offering_id and ar.component = p_component
      and r.state in ('submitted','locked','reopened') and cs.status not in ('cancelled','rescheduled')
  ) agg on true
  on conflict (student_id, offering_id, component) do update
    set held = excluded.held, attended = excluded.attended, excused = excluded.excused,
        percent = excluded.percent, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Notifications (outbox; dispatched by the `dispatch` Edge Function)
-- ---------------------------------------------------------------------------
create function app.enqueue_notification(p_user_id uuid, p_event text, p_dedupe text,
                                         p_title text, p_body text, p_data jsonb default '{}',
                                         p_hold boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox (dedupe_key, event_type, user_id, payload, status)
  values (p_dedupe, p_event, p_user_id,
          jsonb_build_object('title', p_title, 'body', p_body, 'data', p_data || jsonb_build_object('type', p_event)),
          case when p_hold then 'held' else 'queued' end)
  on conflict (dedupe_key) do nothing;
  if found then
    insert into public.notifications (user_id, type, title, body, data)
    values (p_user_id, p_event, p_title, p_body, p_data);
  end if;
end $$;

-- One absence alert per guardian per student per day (web doc §15).
create function app.notify_day_absences(p_register_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select da.student_id, da.att_date, s.full_name, en.roll_no, d.name as division_name,
           g.user_id, g.preferred_language as lang,
           coalesce(np.absence_mode, 'instant') as mode
    from public.day_attendance da
    join public.students s on s.id = da.student_id
    join public.divisions d on d.id = da.division_id
    left join lateral (select e.roll_no from public.student_enrollments e
                       where e.student_id = da.student_id and e.division_id = da.division_id
                         and e.valid_during @> da.att_date limit 1) en on true
    join public.guardian_links gl on gl.student_id = da.student_id and gl.status = 'verified'
    join public.guardians g on g.id = gl.guardian_id and g.user_id is not null
    left join public.notification_preferences np on np.user_id = g.user_id
    where da.day_register_id = p_register_id and da.status_code = 'A'
  loop
    continue when r.mode = 'off';
    perform app.enqueue_notification(
      r.user_id, 'student_absent_day',
      format('absday:%s:%s:%s', r.att_date, r.student_id, r.user_id),
      case r.lang when 'mr' then format('आज अनुपस्थित: %s', r.division_name)
                  when 'hi' then format('आज अनुपस्थित: %s', r.division_name)
                  else format('Absent today: %s', r.division_name) end,
      case r.lang when 'mr' then format('रोल नं. %s (%s) आज (%s) हजेरीच्या वेळी अनुपस्थित होता/होती.', r.roll_no, r.full_name, to_char(r.att_date, 'DD-MM-YYYY'))
                  when 'hi' then format('रोल नं. %s (%s) आज (%s) हाज़िरी के समय अनुपस्थित था/थी।', r.roll_no, r.full_name, to_char(r.att_date, 'DD-MM-YYYY'))
                  else format('Roll No. %s (%s) was absent at roll-call today (%s).', r.roll_no, r.full_name, to_char(r.att_date, 'DD Mon YYYY')) end,
      jsonb_build_object('studentId', r.student_id, 'date', r.att_date,
                         'url', format('jcas://parent/attendance/day/%s', r.att_date),
                         'invalidate', 'day,eligibility'),
      r.mode = 'digest');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Register JSON helpers
-- ---------------------------------------------------------------------------
create function app.day_register_json(p_register_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', dr.id, 'division_id', dr.division_id, 'att_date', dr.att_date, 'state', dr.state,
    'version', dr.version, 'submitted_at', dr.submitted_at, 'month_closed', dr.month_closed,
    'records', coalesce((select jsonb_agg(jsonb_build_object('student_id', da.student_id, 'status', da.status_code)
                                          order by da.student_id)
                         from public.day_attendance da where da.day_register_id = dr.id), '[]'))
  from public.day_registers dr where dr.id = p_register_id
$$;

create function app.period_register_json(p_register_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'session_id', r.session_id, 'state', r.state, 'version', r.version,
    'submitted_at', r.submitted_at, 'month_closed', r.month_closed,
    'records', coalesce((select jsonb_agg(jsonb_build_object('student_id', ar.student_id, 'status', ar.status_code)
                                          order by ar.student_id)
                         from public.attendance_records ar where ar.register_id = r.id), '[]'))
  from public.attendance_registers r where r.id = p_register_id
$$;

-- Is the register editable right now? Returns null when editable, else the blocking result.
create function app.register_block(p_state text, p_first_submitted_at timestamptz, p_reopened_until timestamptz,
                                   p_month_closed boolean, p_edit_window_hours int) returns text
language sql stable as $$
  select case
    when p_month_closed then 'month_closed'
    when p_state = 'voided' then 'not_working_day'
    when p_state = 'locked' then 'locked'
    when p_state = 'reopened' and (p_reopened_until is null or p_reopened_until < now()) then 'locked'
    when p_state = 'submitted' and p_first_submitted_at + make_interval(hours => p_edit_window_hours) < now() then 'locked'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- submit_day_register: class-teacher roll-call (or Office) for one division and date
-- ---------------------------------------------------------------------------
create function public.submit_day_register(
  p_division_id uuid, p_date date,
  p_client_submission_id uuid, p_base_version integer,
  p_records jsonb,
  p_client_marked_at timestamptz default null, p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_div       public.divisions;
  v_policy    public.attendance_policies;
  v_reg       public.day_registers;
  v_prev      jsonb;
  v_block     text;
  v_term      uuid;
  v_bad       text;
  v_defaulted jsonb;
  v_students  uuid[];
  v_result    jsonb;
begin
  perform app.assert_active();

  -- Retries are always safe.
  select s.result into v_prev from public.attendance_submissions s where s.client_submission_id = p_client_submission_id;
  if found then
    return v_prev || jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_div from public.divisions where id = p_division_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;

  if not (app.can('attendance.day.mark', 'all')
          or (app.can('attendance.day.mark', 'class') and p_division_id = any (app.my_class_division_ids()))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  if p_date > app.today() then
    raise exception using errcode = 'P0001', message = 'ATT_FUTURE_DATE';
  end if;

  if not app.is_working_day(p_division_id, p_date) then
    return jsonb_build_object('result', 'not_working_day');
  end if;

  v_term := app.term_for_date(p_date);
  v_policy := app.effective_policy(v_div.standard_id, v_div.stream_id, p_date);

  insert into public.day_registers (division_id, att_date, term_id)
  values (p_division_id, p_date, v_term)
  on conflict (division_id, att_date) do nothing;

  select * into v_reg from public.day_registers
  where division_id = p_division_id and att_date = p_date
  for update;

  -- A concurrent retry may have finished while we waited for the lock.
  select s.result into v_prev from public.attendance_submissions s where s.client_submission_id = p_client_submission_id;
  if found then
    return v_prev || jsonb_build_object('result', 'duplicate');
  end if;

  v_block := app.register_block(v_reg.state, v_reg.first_submitted_at, v_reg.reopened_until,
                                v_reg.month_closed, v_policy.edit_window_hours);
  if v_block is not null then
    return jsonb_build_object('result', v_block, 'register', app.day_register_json(v_reg.id));
  end if;

  if v_reg.version <> p_base_version then
    return jsonb_build_object('result', 'conflict', 'register', app.day_register_json(v_reg.id));
  end if;

  -- Validate input against roster and status codes.
  drop table if exists pg_temp._in;
  create temp table _in on commit drop as
    select (e ->> 'student_id')::uuid as student_id, upper(e ->> 'status') as status
    from jsonb_array_elements(coalesce(p_records, '[]')) e;

  if exists (select student_id from _in group by student_id having count(*) > 1) then
    raise exception using errcode = 'P0001', message = 'ATT_DUPLICATE_STUDENT';
  end if;

  select i.status into v_bad from _in i
  left join public.attendance_status_codes sc on sc.code = i.status and sc.scope in ('day','both')
  where sc.code is null limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ATT_INVALID_STATUS', detail = v_bad;
  end if;

  drop table if exists pg_temp._roster;
  create temp table _roster on commit drop as
    select * from app.division_roster(p_division_id, p_date);

  if exists (select 1 from _in i where not exists (select 1 from _roster r where r.student_id = i.student_id)) then
    raise exception using errcode = 'P0001', message = 'ATT_STUDENT_NOT_IN_ROSTER';
  end if;

  drop table if exists pg_temp._final;
  create temp table _final on commit drop as
    select r.student_id,
           coalesce(i.status, v_policy.default_unmarked_status) as status,
           case when i.student_id is null then 'default' else 'roll_call' end as source
    from _roster r left join _in i on i.student_id = r.student_id;

  select coalesce(jsonb_agg(f.student_id), '[]') into v_defaulted from _final f where f.source = 'default';

  -- History for changed records (edits within the window).
  insert into public.attendance_record_history (kind, register_id, student_id, old_status, new_status, source, changed_by)
  select 'day', v_reg.id, f.student_id, da.status_code, f.status, f.source, v_uid
  from _final f join public.day_attendance da on da.day_register_id = v_reg.id and da.student_id = f.student_id
  where da.status_code <> f.status;

  insert into public.day_attendance as da
    (day_register_id, student_id, status_code, source, marked_by, marked_at,
     division_id, stream_id, standard_id, term_id, att_date)
  select v_reg.id, f.student_id, f.status, f.source, v_uid, now(),
         p_division_id, v_div.stream_id, v_div.standard_id, v_term, p_date
  from _final f
  on conflict (day_register_id, student_id) do update
    set status_code = excluded.status_code, source = excluded.source,
        marked_by = excluded.marked_by, marked_at = excluded.marked_at
    where da.status_code is distinct from excluded.status_code;

  update public.day_registers
     set state = 'submitted',
         version = version + 1,
         first_submitted_at = coalesce(first_submitted_at, now()),
         submitted_by = v_uid, submitted_at = now(),
         client_marked_at = p_client_marked_at, device_id = p_device_id,
         reopened_until = null
   where id = v_reg.id;

  select array_agg(student_id) into v_students from _final;
  perform app.recompute_day_summaries(coalesce(v_students, '{}'), v_term);
  perform app.notify_day_absences(v_reg.id);

  v_result := jsonb_build_object('result', 'ok',
                                 'register', app.day_register_json(v_reg.id),
                                 'defaulted_students', v_defaulted);
  insert into public.attendance_submissions (client_submission_id, kind, register_id, submitted_by, result)
  values (p_client_submission_id, 'day', v_reg.id, v_uid, v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- submit_attendance: subject teacher (or substitute), one session
-- ---------------------------------------------------------------------------
create function public.submit_attendance(
  p_session_id uuid,
  p_client_submission_id uuid, p_base_version integer,
  p_records jsonb,
  p_client_marked_at timestamptz default null, p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_cs        public.class_sessions;
  v_policy    public.attendance_policies;
  v_reg       public.attendance_registers;
  v_prev      jsonb;
  v_block     text;
  v_bad       text;
  v_defaulted jsonb;
  v_students  uuid[];
  v_result    jsonb;
begin
  perform app.assert_active();

  select s.result into v_prev from public.attendance_submissions s where s.client_submission_id = p_client_submission_id;
  if found then
    return v_prev || jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_cs from public.class_sessions where id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;

  if not (app.staff_on_session(p_session_id) or app.can('attendance.mark', 'all')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  if v_cs.status in ('cancelled', 'rescheduled') then
    return jsonb_build_object('result', 'cancelled', 'session_status', v_cs.status,
                              'rescheduled_to_id', v_cs.rescheduled_to_id);
  end if;

  if v_cs.starts_at - interval '15 minutes' > now() then
    raise exception using errcode = 'P0001', message = 'ATT_TOO_EARLY';
  end if;

  if not app.is_working_day(v_cs.division_id, v_cs.session_date) then
    return jsonb_build_object('result', 'not_working_day');
  end if;

  v_policy := app.effective_policy(v_cs.standard_id, v_cs.stream_id, v_cs.session_date);

  insert into public.attendance_registers (session_id) values (p_session_id)
  on conflict (session_id) do nothing;

  select * into v_reg from public.attendance_registers where session_id = p_session_id for update;

  select s.result into v_prev from public.attendance_submissions s where s.client_submission_id = p_client_submission_id;
  if found then
    return v_prev || jsonb_build_object('result', 'duplicate');
  end if;

  v_block := app.register_block(v_reg.state, v_reg.first_submitted_at, v_reg.reopened_until,
                                v_reg.month_closed, v_policy.edit_window_hours);
  if v_block is not null then
    return jsonb_build_object('result', v_block, 'register', app.period_register_json(v_reg.id));
  end if;

  if v_reg.version <> p_base_version then
    return jsonb_build_object('result', 'conflict', 'register', app.period_register_json(v_reg.id));
  end if;

  drop table if exists pg_temp._in;
  create temp table _in on commit drop as
    select (e ->> 'student_id')::uuid as student_id, upper(e ->> 'status') as status
    from jsonb_array_elements(coalesce(p_records, '[]')) e;

  if exists (select student_id from _in group by student_id having count(*) > 1) then
    raise exception using errcode = 'P0001', message = 'ATT_DUPLICATE_STUDENT';
  end if;

  select i.status into v_bad from _in i
  left join public.attendance_status_codes sc on sc.code = i.status and sc.scope in ('period','both')
  where sc.code is null limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ATT_INVALID_STATUS', detail = v_bad;
  end if;

  drop table if exists pg_temp._roster;
  create temp table _roster on commit drop as
    select * from app.session_roster(p_session_id);

  if exists (select 1 from _in i where not exists (select 1 from _roster r where r.student_id = i.student_id)) then
    raise exception using errcode = 'P0001', message = 'ATT_STUDENT_NOT_IN_ROSTER';
  end if;

  drop table if exists pg_temp._final;
  create temp table _final on commit drop as
    select r.student_id, r.division_id, r.batch_id,
           coalesce(i.status, v_policy.default_unmarked_status) as status,
           case when i.student_id is null then 'default' else 'teacher' end as source
    from _roster r left join _in i on i.student_id = r.student_id;

  select coalesce(jsonb_agg(f.student_id), '[]') into v_defaulted from _final f where f.source = 'default';

  insert into public.attendance_record_history (kind, register_id, student_id, old_status, new_status, source, changed_by)
  select 'period', v_reg.id, f.student_id, ar.status_code, f.status, f.source, v_uid
  from _final f join public.attendance_records ar on ar.register_id = v_reg.id and ar.student_id = f.student_id
  where ar.status_code <> f.status;

  insert into public.attendance_records as ar
    (register_id, student_id, status_code, source, marked_by, marked_at,
     session_id, session_date, offering_id, component, division_id, batch_id,
     stream_id, standard_id, term_id, weight)
  select v_reg.id, f.student_id, f.status, f.source, v_uid, now(),
         v_cs.id, v_cs.session_date, v_cs.offering_id, v_cs.component, f.division_id, f.batch_id,
         v_cs.stream_id, v_cs.standard_id, v_cs.term_id, v_cs.attendance_weight
  from _final f
  on conflict (register_id, student_id) do update
    set status_code = excluded.status_code, source = excluded.source,
        marked_by = excluded.marked_by, marked_at = excluded.marked_at
    where ar.status_code is distinct from excluded.status_code;

  update public.attendance_registers
     set state = 'submitted', version = version + 1,
         first_submitted_at = coalesce(first_submitted_at, now()),
         submitted_by = v_uid, submitted_at = now(),
         client_marked_at = p_client_marked_at, device_id = p_device_id,
         reopened_until = null
   where id = v_reg.id;

  update public.class_sessions set status = 'held' where id = p_session_id and status = 'scheduled';

  select array_agg(student_id) into v_students from _final;
  perform app.recompute_subject_summaries(coalesce(v_students, '{}'), v_cs.offering_id, v_cs.component);

  v_result := jsonb_build_object('result', 'ok',
                                 'register', app.period_register_json(v_reg.id),
                                 'defaulted_students', v_defaulted);
  insert into public.attendance_submissions (client_submission_id, kind, register_id, submitted_by, result)
  values (p_client_submission_id, 'period', v_reg.id, v_uid, v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Marking rosters for the clients (roll-call and period)
-- ---------------------------------------------------------------------------
create function public.division_roster_for_marking(p_division_id uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_reg public.day_registers;
begin
  perform app.assert_active();
  if not (app.can('attendance.day.mark', 'all')
          or (app.can('attendance.day.mark', 'class') and p_division_id = any (app.my_class_division_ids()))
          or app.can_see_division(p_division_id, 'attendance.view')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  select * into v_reg from public.day_registers where division_id = p_division_id and att_date = p_date;

  return jsonb_build_object(
    'division_id', p_division_id,
    'date', p_date,
    'working_day', app.is_working_day(p_division_id, p_date),
    'register', case when v_reg.id is null then null else jsonb_build_object(
                  'id', v_reg.id, 'state', v_reg.state, 'version', v_reg.version,
                  'submitted_at', v_reg.submitted_at, 'month_closed', v_reg.month_closed,
                  -- null = editable now; otherwise the result a submit would return (locked, month_closed …)
                  'block', app.register_block(v_reg.state, v_reg.first_submitted_at, v_reg.reopened_until, v_reg.month_closed,
                                              (app.division_policy(p_division_id, p_date)).edit_window_hours)) end,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'roll_no', r.roll_no, 'name', r.full_name, 'name_mr', r.name_mr,
               'batch_id', r.batch_id, 'suggested_status', r.suggested_status,
               'is_new', r.enrolled_from > p_date - 7,
               'current_status', da.status_code)
             order by nullif(regexp_replace(r.roll_no, '\D', '', 'g'), '')::int nulls last, r.roll_no, r.full_name)
      from app.division_roster(p_division_id, p_date) r
      left join public.day_attendance da on da.day_register_id = v_reg.id and da.student_id = r.student_id), '[]'));
end $$;

create function public.session_roster_for_marking(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cs  public.class_sessions;
  v_reg public.attendance_registers;
begin
  perform app.assert_active();
  select * into v_cs from public.class_sessions where id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;
  if not (app.staff_on_session(p_session_id) or app.can('attendance.mark', 'all')
          or app.can_see_division(v_cs.division_id, 'attendance.view')) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  select * into v_reg from public.attendance_registers where session_id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'session_status', v_cs.status,
    'working_day', app.is_working_day(v_cs.division_id, v_cs.session_date),
    'register', case when v_reg.id is null then null else jsonb_build_object(
                  'id', v_reg.id, 'state', v_reg.state, 'version', v_reg.version,
                  'submitted_at', v_reg.submitted_at, 'month_closed', v_reg.month_closed,
                  'block', app.register_block(v_reg.state, v_reg.first_submitted_at, v_reg.reopened_until, v_reg.month_closed,
                                              (app.effective_policy(v_cs.standard_id, v_cs.stream_id, v_cs.session_date)).edit_window_hours)) end,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'roll_no', r.roll_no, 'name', r.full_name, 'name_mr', r.name_mr,
               'batch_id', r.batch_id, 'suggested_status', r.suggested_status,
               'is_new', r.enrolled_from > v_cs.session_date - 7,
               'current_status', ar.status_code)
             order by nullif(regexp_replace(r.roll_no, '\D', '', 'g'), '')::int nulls last, r.roll_no, r.full_name)
      from app.session_roster(p_session_id) r
      left join public.attendance_records ar on ar.register_id = v_reg.id and ar.student_id = r.student_id), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- Reopen a register for late marking (Supervisor / Office)
-- ---------------------------------------------------------------------------
create function public.reopen_register(p_kind text, p_register_id uuid, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_div uuid;
  v_closed boolean;
begin
  perform app.assert_active();
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
  if p_kind = 'day' then
    select division_id, month_closed into v_div, v_closed from public.day_registers where id = p_register_id;
  else
    select cs.division_id, r.month_closed into v_div, v_closed
    from public.attendance_registers r join public.class_sessions cs on cs.id = r.session_id where r.id = p_register_id;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;
  if not (app.can('attendance.reopen', 'all')
          or (app.can('attendance.reopen', 'stream') and exists
               (select 1 from public.divisions d where d.id = v_div and d.stream_id = any (app.my_stream_ids())))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if v_closed then
    raise exception using errcode = 'P0001', message = 'MONTH_CLOSED';
  end if;

  if p_kind = 'day' then
    update public.day_registers set state = 'reopened', reopened_until = p_until, locked_at = null
    where id = p_register_id and state <> 'voided';
  else
    update public.attendance_registers set state = 'reopened', reopened_until = p_until, locked_at = null
    where id = p_register_id and state <> 'voided';
  end if;
  perform app.audit('reopen_register', p_kind || '_register', p_register_id::text, null,
                    jsonb_build_object('until', p_until), p_reason);
  return jsonb_build_object('result', 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- Corrections after lock / month close
-- ---------------------------------------------------------------------------
create function public.request_attendance_correction(p_kind text, p_register_id uuid, p_records jsonb, p_reason text,
                                                     p_evidence_asset_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_div uuid; v_stream uuid; v_date date; v_id uuid; v_allowed boolean;
begin
  perform app.assert_active();
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception using errcode = 'P0001', message = 'ATT_NO_RECORDS';
  end if;

  if p_kind = 'day' then
    select dr.division_id, d.stream_id, dr.att_date into v_div, v_stream, v_date
    from public.day_registers dr join public.divisions d on d.id = dr.division_id where dr.id = p_register_id;
    v_allowed := app.can('attendance.day.mark', 'all') or v_div = any (app.my_class_division_ids())
                 or app.can_any('attendance.correct.approve');
  else
    select cs.division_id, cs.stream_id, cs.session_date into v_div, v_stream, v_date
    from public.attendance_registers r join public.class_sessions cs on cs.id = r.session_id where r.id = p_register_id;
    v_allowed := app.staff_on_session((select session_id from public.attendance_registers where id = p_register_id))
                 or app.can_any('attendance.correct.approve');
  end if;
  if v_date is null then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;
  if not v_allowed then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  insert into public.attendance_correction_requests
    (kind, register_id, division_id, stream_id, att_date, records, reason, evidence_asset_id, requested_by)
  select p_kind, p_register_id, v_div, v_stream, v_date,
         jsonb_agg(jsonb_build_object(
           'student_id', e ->> 'student_id',
           'from', case when p_kind = 'day'
                        then (select da.status_code from public.day_attendance da
                              where da.day_register_id = p_register_id and da.student_id = (e ->> 'student_id')::uuid)
                        else (select ar.status_code from public.attendance_records ar
                              where ar.register_id = p_register_id and ar.student_id = (e ->> 'student_id')::uuid) end,
           'to', upper(e ->> 'status'))),
         p_reason, p_evidence_asset_id, auth.uid()
  from jsonb_array_elements(p_records) e
  returning id into v_id;
  return v_id;
end $$;

create function public.decide_correction(p_request_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_req public.attendance_correction_requests;
  v_rec jsonb;
  v_term uuid;
  v_offering uuid;
  v_component text;
  v_students uuid[] := '{}';
  v_closed boolean;
begin
  perform app.assert_active();
  select * into v_req from public.attendance_correction_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATT_NOT_FOUND';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'CORRECTION_ALREADY_DECIDED';
  end if;
  if not (app.can('attendance.correct.approve', 'all')
          or (app.can('attendance.correct.approve', 'stream') and v_req.stream_id = any (app.my_stream_ids()))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  update public.attendance_correction_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_request_id;

  if not p_approve then
    return jsonb_build_object('result', 'rejected');
  end if;

  -- Corrections are allowed through closed months; the guard trigger checks this flag.
  perform set_config('app.correction', 'on', true);

  for v_rec in select * from jsonb_array_elements(v_req.records) loop
    if exists (select 1 from public.attendance_status_codes sc
               where sc.code = v_rec ->> 'to'
                 and sc.scope in (case when v_req.kind = 'day' then 'day' else 'period' end, 'both')) is not true then
      raise exception using errcode = 'P0001', message = 'ATT_INVALID_STATUS', detail = v_rec ->> 'to';
    end if;
    if v_req.kind = 'day' then
      update public.day_attendance set status_code = v_rec ->> 'to', source = 'correction',
             marked_by = auth.uid(), marked_at = now()
       where day_register_id = v_req.register_id and student_id = (v_rec ->> 'student_id')::uuid;
    else
      update public.attendance_records set status_code = v_rec ->> 'to', source = 'correction',
             marked_by = auth.uid(), marked_at = now()
       where register_id = v_req.register_id and student_id = (v_rec ->> 'student_id')::uuid;
    end if;
    if found then
      insert into public.attendance_record_history (kind, register_id, student_id, old_status, new_status, source, reason, changed_by)
      values (v_req.kind, v_req.register_id, (v_rec ->> 'student_id')::uuid, v_rec ->> 'from', v_rec ->> 'to',
              'correction', v_req.reason, auth.uid());
      v_students := v_students || (v_rec ->> 'student_id')::uuid;
    end if;
  end loop;

  if v_req.kind = 'day' then
    select term_id, month_closed into v_term, v_closed from public.day_registers where id = v_req.register_id;
    update public.day_registers set version = version + 1 where id = v_req.register_id;
    perform app.recompute_day_summaries(v_students, v_term);
  else
    select cs.offering_id, cs.component, r.month_closed into v_offering, v_component, v_closed
    from public.attendance_registers r join public.class_sessions cs on cs.id = r.session_id where r.id = v_req.register_id;
    update public.attendance_registers set version = version + 1 where id = v_req.register_id;
    perform app.recompute_subject_summaries(v_students, v_offering, v_component);
  end if;

  if v_closed then
    update public.attendance_months set revised = true
     where division_id = v_req.division_id and month = date_trunc('month', v_req.att_date)::date;
  end if;

  -- Tell the students and their guardians.
  perform app.enqueue_notification(u.user_id, 'attendance_corrected',
            format('corr:%s:%s:%s', p_request_id, u.student_id, u.user_id),
            'Attendance corrected',
            format('Attendance for %s has been corrected.', to_char(v_req.att_date, 'DD Mon YYYY')),
            jsonb_build_object('studentId', u.student_id, 'date', v_req.att_date, 'invalidate', 'day,subjects,eligibility'))
  from (
    select s.id as student_id, s.user_id from public.students s where s.id = any (v_students) and s.user_id is not null
    union
    select gl.student_id, g.user_id from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
    where gl.student_id = any (v_students) and gl.status = 'verified' and g.user_id is not null
  ) u;

  return jsonb_build_object('result', 'approved', 'changed', coalesce(array_length(v_students, 1), 0));
end $$;

-- ---------------------------------------------------------------------------
-- Declare a holiday after the fact (e.g. rain holiday)
-- ---------------------------------------------------------------------------
create function public.declare_holiday(p_date date, p_title text, p_division_ids uuid[] default null,
                                       p_kind text default 'emergency_holiday') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_year uuid;
  v_voided_day int;
  v_voided_period int;
  v_term uuid := app.term_for_date(p_date);
  v_rec record;
begin
  perform app.assert_active();
  if not app.can('calendar.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  select academic_year_id into v_year from public.academic_terms where id = v_term;
  if v_year is null then
    raise exception using errcode = 'P0001', message = 'DATE_OUTSIDE_TERMS';
  end if;
  if exists (select 1 from public.day_registers where att_date = p_date and month_closed
             and (p_division_ids is null or division_id = any (p_division_ids))) then
    raise exception using errcode = 'P0001', message = 'MONTH_CLOSED';
  end if;

  insert into public.academic_calendar_events (academic_year_id, kind, title, starts_on, ends_on, division_ids, created_by)
  values (v_year, p_kind, p_title, p_date, p_date, p_division_ids, auth.uid());

  update public.day_registers set state = 'voided'
   where att_date = p_date and (p_division_ids is null or division_id = any (p_division_ids));
  get diagnostics v_voided_day = row_count;

  update public.class_sessions set status = 'cancelled', status_reason = p_title
   where session_date = p_date and status in ('scheduled','held')
     and (p_division_ids is null or division_id = any (p_division_ids));

  update public.attendance_registers r set state = 'voided'
    from public.class_sessions cs
   where cs.id = r.session_id and cs.session_date = p_date
     and (p_division_ids is null or cs.division_id = any (p_division_ids));
  get diagnostics v_voided_period = row_count;

  -- Recompute summaries for everyone affected.
  perform app.recompute_day_summaries(array_agg(distinct da.student_id), v_term)
  from public.day_attendance da where da.att_date = p_date
    and (p_division_ids is null or da.division_id = any (p_division_ids));

  for v_rec in select distinct ar.offering_id, ar.component, array_agg(distinct ar.student_id) as students
           from public.attendance_records ar where ar.session_date = p_date
             and (p_division_ids is null or ar.division_id = any (p_division_ids))
           group by ar.offering_id, ar.component loop
    perform app.recompute_subject_summaries(v_rec.students, v_rec.offering_id, v_rec.component);
  end loop;

  perform app.audit('declare_holiday', 'calendar', p_date::text, null,
                    jsonb_build_object('title', p_title, 'division_ids', p_division_ids), null);
  return jsonb_build_object('result', 'ok', 'voided_day_registers', v_voided_day, 'voided_period_registers', v_voided_period);
end $$;

-- ---------------------------------------------------------------------------
-- Month close and muster sign-off
-- ---------------------------------------------------------------------------
create function public.close_attendance_month(p_division_id uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_missing jsonb;
begin
  perform app.assert_active();
  if not (app.can('month.close', 'all')
          or (app.can('month.close', 'class') and p_division_id = any (app.my_class_division_ids()))) then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  if v_end >= app.today() then
    raise exception using errcode = 'P0001', message = 'MONTH_NOT_OVER';
  end if;
  if exists (select 1 from public.attendance_months
             where division_id = p_division_id and month = v_month and state = 'closed') then
    return jsonb_build_object('result', 'already_closed');
  end if;

  select coalesce(jsonb_agg(d::date order by d), '[]') into v_missing
  from generate_series(v_month, v_end, interval '1 day') d
  where app.is_working_day(p_division_id, d::date)
    and not exists (select 1 from public.day_registers dr
                    where dr.division_id = p_division_id and dr.att_date = d::date
                      and dr.state in ('submitted','locked','voided'));
  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('result', 'incomplete', 'missing_dates', v_missing);
  end if;

  update public.day_registers
     set state = case when state = 'voided' then state else 'locked' end,
         locked_at = coalesce(locked_at, now()), month_closed = true
   where division_id = p_division_id and att_date between v_month and v_end;

  update public.attendance_registers r
     set state = case when r.state in ('voided','pending') then r.state else 'locked' end,
         locked_at = coalesce(r.locked_at, now()), month_closed = true
    from public.class_sessions cs
   where cs.id = r.session_id and cs.division_id = p_division_id and cs.session_date between v_month and v_end;

  insert into public.attendance_months (division_id, month, state, closed_by, closed_at)
  values (p_division_id, v_month, 'closed', auth.uid(), now())
  on conflict (division_id, month) do update
    set state = 'closed', closed_by = auth.uid(), closed_at = now();

  return jsonb_build_object('result', 'ok');
end $$;

create function public.sign_muster(p_division_id uuid, p_month date, p_as text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  perform app.assert_active();
  if not exists (select 1 from public.attendance_months
                 where division_id = p_division_id and month = v_month and state = 'closed') then
    raise exception using errcode = 'P0001', message = 'MONTH_NOT_CLOSED';
  end if;
  if p_as = 'class_teacher' then
    if not (p_division_id = any (app.my_class_division_ids())) then
      raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
    end if;
    update public.attendance_months set class_teacher_signed_by = auth.uid(), class_teacher_signed_at = now()
     where division_id = p_division_id and month = v_month;
  elsif p_as = 'principal' then
    if not ('principal' = any (app.my_roles())) then
      raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
    end if;
    update public.attendance_months set principal_signed_by = auth.uid(), principal_signed_at = now()
     where division_id = p_division_id and month = v_month;
  else
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- Background jobs (pg_cron, see 0009)
-- ---------------------------------------------------------------------------
create function app.generate_day_registers(p_date date default app.today()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.day_registers (division_id, att_date, term_id)
  select d.id, p_date, app.term_for_date(p_date)
  from public.divisions d
  where d.academic_year_id = app.active_year_id() and d.archived_at is null
    and app.is_working_day(d.id, p_date)
  on conflict (division_id, att_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function app.lock_due_registers() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_day int; v_period int;
begin
  update public.day_registers dr
     set state = 'locked', locked_at = now()
    from public.divisions d
   where d.id = dr.division_id
     and (
       (dr.state in ('pending','submitted')
         and app.ist(dr.att_date + 1, time '00:00')
             + make_interval(hours => (app.effective_policy(d.standard_id, d.stream_id, dr.att_date)).lock_after_hours) < now())
       or (dr.state = 'reopened' and dr.reopened_until < now())
     );
  get diagnostics v_day = row_count;

  update public.attendance_registers r
     set state = 'locked', locked_at = now()
    from public.class_sessions cs
   where cs.id = r.session_id
     and (
       (r.state in ('pending','submitted')
         and cs.ends_at + make_interval(hours => (app.effective_policy(cs.standard_id, cs.stream_id, cs.session_date)).lock_after_hours) < now())
       or (r.state = 'reopened' and r.reopened_until < now())
     );
  get diagnostics v_period = row_count;
  return v_day + v_period;
end $$;

-- Remind class teachers (30 min) and escalate to Supervisors (60 min) about missing roll-calls.
create function app.rollcall_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select dr.id, dr.division_id, dr.att_date, d.name, s.starts_at, st.user_id,
           extract(epoch from (now() - app.ist(dr.att_date, s.starts_at))) / 60 as late_min
    from public.day_registers dr
    join public.divisions d on d.id = dr.division_id
    join public.shifts s on s.id = d.shift_id
    left join public.class_teacher_assignments ct on ct.division_id = d.id and ct.valid_during @> dr.att_date
    left join public.staff st on st.id = ct.staff_id
    where dr.att_date = app.today() and dr.state = 'pending'
  loop
    if r.late_min >= 30 and r.user_id is not null then
      perform app.enqueue_notification(r.user_id, 'rollcall_missing',
        format('rcm:%s:%s:teacher', r.division_id, r.att_date),
        format('Roll-call pending: %s', r.name), 'Please submit today''s roll-call.',
        jsonb_build_object('divisionId', r.division_id, 'date', r.att_date, 'url', 'jcas://teacher/today'));
    end if;
    if r.late_min >= 60 then
      perform app.enqueue_notification(ur.user_id, 'rollcall_missing',
        format('rcm:%s:%s:supervisor:%s', r.division_id, r.att_date, ur.user_id),
        format('Roll-call still pending: %s', r.name), 'The class teacher has not submitted today''s roll-call.',
        jsonb_build_object('divisionId', r.division_id, 'date', r.att_date))
      from public.user_roles ur where ur.role = 'supervisor';
    end if;
  end loop;
end $$;
