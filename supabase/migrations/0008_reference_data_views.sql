-- 0008 Reference data (permissions, default role matrix, status codes, MSBSHSE template),
-- the RLS-protected views the mobile app reads (mobile doc §8.3), and function grants.

-- ---------------------------------------------------------------------------
-- Permissions (keys mirror src/shared/permissions.ts)
-- ---------------------------------------------------------------------------
insert into public.permissions (key) values
  ('settings.manage'), ('roles.manage'), ('audit.view'),
  ('structure.view'), ('structure.manage'), ('structure.activate'),
  ('calendar.manage'), ('year.rollover'), ('month.close'),
  ('admissions.import'), ('students.view'), ('students.manage'), ('students.promote'),
  ('students.ids.view'), ('students.sensitive.view'),
  ('guardians.view'), ('guardians.manage'), ('accounts.issue'), ('consents.manage'),
  ('staff.view'), ('staff.manage'), ('assignments.manage'),
  ('timetable.view'), ('timetable.edit'), ('timetable.publish'), ('sessions.manage'),
  ('attendance.view'), ('attendance.mark'), ('attendance.day.mark'), ('attendance.override'),
  ('attendance.reopen'), ('attendance.correct.approve'), ('attendance.policy.manage'),
  ('devices.manage'), ('biometric.view'),
  ('eligibility.view'), ('eligibility.manage'), ('condonation.recommend'),
  ('notices.defaulter.issue'), ('certificates.issue'), ('scholarships.manage'), ('govt.export'),
  ('leave.student.decide'), ('leave.staff.decide'),
  ('exams.manage'), ('exams.attendance.mark'),
  ('announcements.college'), ('announcements.class'),
  ('reports.view'), ('reports.export');

-- Default matrix (web doc §6.3). Admin can edit it in Settings → Roles.
insert into public.role_permissions (role, permission, scope)
select v.role, p, v.scope
from (values
  ('principal', 'all', array[
    'settings.manage','roles.manage','audit.view','structure.view','structure.manage','structure.activate',
    'calendar.manage','year.rollover','month.close','admissions.import','students.view','students.manage',
    'students.promote','students.ids.view','students.sensitive.view','guardians.view','guardians.manage',
    'accounts.issue','consents.manage','staff.view','staff.manage','assignments.manage','timetable.view',
    'timetable.edit','timetable.publish','sessions.manage','attendance.view','attendance.mark',
    'attendance.day.mark','attendance.override','attendance.reopen','attendance.correct.approve',
    'attendance.policy.manage','devices.manage','biometric.view','eligibility.view','eligibility.manage',
    'condonation.recommend','notices.defaulter.issue','certificates.issue','scholarships.manage','govt.export',
    'leave.student.decide','leave.staff.decide','exams.manage','announcements.college','reports.view','reports.export']),
  ('supervisor', 'all', array[
    'structure.view','students.view','students.ids.view','guardians.view','staff.view','staff.manage',
    'assignments.manage','timetable.view','timetable.edit','timetable.publish','sessions.manage',
    'attendance.view','attendance.mark','attendance.day.mark','attendance.override','attendance.reopen',
    'attendance.correct.approve','month.close','biometric.view','eligibility.view','eligibility.manage',
    'notices.defaulter.issue','leave.student.decide','leave.staff.decide','announcements.college',
    'reports.view','reports.export']),
  ('admin', 'all', array[
    'settings.manage','roles.manage','audit.view','structure.view','structure.manage','structure.activate',
    'calendar.manage','year.rollover','admissions.import','students.view','students.manage','students.ids.view',
    'guardians.view','guardians.manage','accounts.issue','consents.manage','staff.view','staff.manage',
    'assignments.manage','timetable.view','timetable.edit','timetable.publish','sessions.manage',
    'attendance.view','attendance.day.mark','attendance.override','attendance.reopen',
    'attendance.correct.approve','attendance.policy.manage','devices.manage','biometric.view','exams.manage',
    'govt.export','announcements.college','reports.view','reports.export']),
  ('office', 'all', array[
    'structure.view','calendar.manage','admissions.import','students.view','students.manage','students.promote',
    'students.ids.view','students.sensitive.view','guardians.view','guardians.manage','accounts.issue',
    'consents.manage','staff.view','staff.manage','assignments.manage','timetable.view','timetable.edit',
    'sessions.manage','attendance.view','attendance.day.mark','attendance.override','attendance.reopen',
    -- eligibility.manage: Office submits condonation cases and records the board's decision (web doc §8.3, §9.7)
    'attendance.correct.approve','month.close','biometric.view','eligibility.view','eligibility.manage','notices.defaulter.issue',
    'leave.student.decide','leave.staff.decide','certificates.issue','scholarships.manage','govt.export',
    'announcements.college','reports.view','reports.export']),
  ('exam_incharge', 'all', array[
    'structure.view','students.view','students.ids.view','staff.view','timetable.view','attendance.view',
    'eligibility.view','eligibility.manage','exams.manage','exams.attendance.mark','govt.export',
    'reports.view','reports.export']),
  ('stream_coordinator', 'all', array['structure.view','staff.view','timetable.view']),
  ('stream_coordinator', 'stream', array[
    'students.view','guardians.view','assignments.manage','timetable.edit','sessions.manage','attendance.view',
    'attendance.reopen','attendance.correct.approve','eligibility.view','notices.defaulter.issue',
    'biometric.view','leave.student.decide','reports.view','reports.export']),
  ('teacher', 'assigned', array['attendance.mark','attendance.view']),
  ('teacher', 'all', array['timetable.view']),
  -- Class Teacher is an assignment, not a role: the `class` scope resolves through class_teacher_assignments.
  ('teacher', 'class', array[
    'attendance.day.mark','attendance.view','students.view','guardians.view','leave.student.decide',
    'notices.defaulter.issue','month.close','eligibility.view','announcements.class','reports.view',
    'biometric.view']),
  ('student', 'self', array['attendance.view','students.view','eligibility.view']),
  ('parent', 'linked', array['attendance.view','students.view','eligibility.view'])
) as v(role, scope, perms)
cross join lateral unnest(v.perms) as p;

-- ---------------------------------------------------------------------------
-- Academic reference data
-- ---------------------------------------------------------------------------
insert into public.standards (code, level, label) values ('XI', 11, 'FYJC'), ('XII', 12, 'SYJC');

insert into public.streams (code, name, name_mr, sort_order) values
  ('SCI', 'Science', 'विज्ञान', 1),
  ('COM', 'Commerce', 'वाणिज्य', 2),
  ('ARTS', 'Arts', 'कला', 3);

insert into public.mediums (code, name) values
  ('en', 'English'), ('mr', 'Marathi'), ('hi', 'Hindi'), ('ur', 'Urdu');

insert into public.attendance_status_codes
  (code, label, label_mr, color, scope, day_value, counts_as_attended, counts_in_held, teacher_can_set, requires_reason, sort_order)
values
  ('P',  'Present',      'उपस्थित',       '#16a34a', 'both',   1,   true,  true, true,  false, 1),
  ('A',  'Absent',       'अनुपस्थित',     '#dc2626', 'both',   0,   false, true, true,  false, 2),
  ('HD', 'Half day',     'अर्धा दिवस',    '#d97706', 'day',    0.5, true,  true, true,  false, 3),
  ('LT', 'Late',         'उशीरा',         '#ca8a04', 'period', 1,   true,  true, true,  false, 4),
  ('L',  'Leave',        'रजा',           '#2563eb', 'both',   0,   false, true, false, false, 5),
  ('ML', 'Medical leave','वैद्यकीय रजा',  '#7c3aed', 'both',   0,   false, true, false, true,  6),
  ('OD', 'On duty',      'कर्तव्यावर',    '#0891b2', 'both',   1,   true,  true, true,  true,  7),
  ('SP', 'Sports',       'क्रीडा',         '#0d9488', 'day',    1,   true,  true, true,  true,  8);

insert into public.attendance_policies (scope_kind, effective_from) values ('college', date '2020-01-01');

insert into public.leave_types (code, label, label_mr, status_code, requires_document_after_days, max_backdate_days) values
  ('personal', 'Personal leave', 'वैयक्तिक रजा', 'L',  null, 3),
  ('medical',  'Medical leave',  'वैद्यकीय रजा', 'ML', 2,    7),
  ('family',   'Family event',   'कौटुंबिक कार्यक्रम', 'L', null, 3);

-- ---------------------------------------------------------------------------
-- "MSBSHSE – Junior College XI–XII" subject template (setup wizard step 2). Idempotent.
-- Board subject codes are left blank: enter them from the current MSBSHSE list in Settings.
-- ---------------------------------------------------------------------------
create function public.apply_msbshse_template() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_scheme uuid;
  v_count  int;
begin
  if auth.uid() is not null and not app.can('structure.manage', 'all') then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;

  insert into public.curriculum_schemes (code, name, effective_from)
  values ('HSC-2019', 'HSC (current MSBSHSE scheme)', '{"XI": "2019-20", "XII": "2020-21"}')
  on conflict (code) do nothing;
  select id into v_scheme from public.curriculum_schemes where code = 'HSC-2019';

  insert into public.subjects (scheme_id, name, name_mr, kind, in_eligibility, stream_codes)
  select v_scheme, s.name, s.name_mr, s.kind, s.elig, s.streams
  from (values
    ('English',                                'इंग्रजी',                     'language', true,  '{}'::text[]),
    ('Marathi',                                'मराठी',                       'language', true,  '{}'),
    ('Hindi',                                  'हिंदी',                       'language', true,  '{}'),
    ('Sanskrit',                               'संस्कृत',                      'language', true,  '{}'),
    ('Urdu',                                   'उर्दू',                        'language', true,  '{}'),
    ('Environment Education & Water Security', 'पर्यावरण शिक्षण व जलसुरक्षा',   'graded',   false, '{}'),
    ('Health & Physical Education',            'आरोग्य व शारीरिक शिक्षण',      'graded',   false, '{}'),
    ('Physics',                                'भौतिकशास्त्र',                 'core',     true,  '{SCI}'),
    ('Chemistry',                              'रसायनशास्त्र',                 'core',     true,  '{SCI}'),
    ('Biology',                                'जीवशास्त्र',                   'optional', true,  '{SCI}'),
    ('Mathematics & Statistics',               'गणित व संख्याशास्त्र',          'optional', true,  '{SCI,ARTS}'),
    ('Information Technology',                 'माहिती तंत्रज्ञान',             'optional', true,  '{SCI,COM,ARTS}'),
    ('Computer Science (Bifocal)',             'संगणकशास्त्र (द्विलक्षी)',       'bifocal',  true,  '{SCI}'),
    ('Electronics (Bifocal)',                  'इलेक्ट्रॉनिक्स (द्विलक्षी)',      'bifocal',  true,  '{SCI}'),
    ('Economics',                              'अर्थशास्त्र',                   'core',     true,  '{COM,ARTS}'),
    ('Book-Keeping & Accountancy',             'पुस्तपालन व लेखाकर्म',          'core',     true,  '{COM}'),
    ('Organisation of Commerce & Management',  'वाणिज्य संघटन व व्यवस्थापन',    'core',     true,  '{COM}'),
    ('Secretarial Practice',                   'चिटणीसाची कार्यपद्धती',          'optional', true,  '{COM}'),
    ('Mathematics & Statistics (Commerce)',    'गणित व संख्याशास्त्र (वाणिज्य)', 'optional', true,  '{COM}'),
    ('History',                                'इतिहास',                       'core',     true,  '{ARTS}'),
    ('Geography',                              'भूगोल',                        'optional', true,  '{ARTS}'),
    ('Political Science',                      'राज्यशास्त्र',                  'optional', true,  '{ARTS}'),
    ('Psychology',                             'मानसशास्त्र',                   'optional', true,  '{ARTS}'),
    ('Sociology',                              'समाजशास्त्र',                   'optional', true,  '{ARTS}')
  ) as s(name, name_mr, kind, elig, streams)
  on conflict (scheme_id, name) do nothing;
  get diagnostics v_count = row_count;

  insert into public.subject_components (subject_id, component, weekly_periods)
  select sub.id, c.component, c.periods
  from public.subjects sub
  cross join lateral (values ('TH', 6)) c(component, periods)
  where sub.scheme_id = v_scheme
  on conflict (subject_id, component) do nothing;

  insert into public.subject_components (subject_id, component, weekly_periods)
  select sub.id, 'PR', 2
  from public.subjects sub
  where sub.scheme_id = v_scheme
    and sub.name in ('Physics','Chemistry','Biology','Information Technology',
                     'Computer Science (Bifocal)','Electronics (Bifocal)')
  on conflict (subject_id, component) do nothing;

  -- Second-language basket per stream (IT may replace the second language).
  insert into public.elective_baskets (scheme_id, stream_id, standard_id, name, min_picks, max_picks)
  select v_scheme, st.id, null, 'Second language', 1, 1 from public.streams st
  where not exists (select 1 from public.elective_baskets b
                    where b.scheme_id = v_scheme and b.stream_id = st.id and b.name = 'Second language');

  insert into public.elective_basket_subjects (basket_id, subject_id)
  select b.id, sub.id
  from public.elective_baskets b
  join public.streams st on st.id = b.stream_id
  join public.subjects sub on sub.scheme_id = v_scheme
   and sub.name in ('Marathi','Hindi','Sanskrit','Urdu','Information Technology')
   and (cardinality(sub.stream_codes) = 0 or st.code = any (sub.stream_codes))
  where b.scheme_id = v_scheme and b.name = 'Second language'
  on conflict do nothing;

  return jsonb_build_object('result', 'ok', 'subjects_added', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- Views for the mobile app. security_invoker = true so RLS on the base tables applies.
-- ---------------------------------------------------------------------------
create view public.v_my_sessions with (security_invoker = true) as
select cs.id, cs.session_date, cs.starts_at, cs.ends_at, cs.status, cs.status_reason, cs.component, cs.session_type,
       sub.name as subject_name, sub.name_mr as subject_name_mr,
       tg.id as teaching_group_id, tg.name as group_name, tg.kind as group_kind,
       d.id as division_id, d.name as division_name, rm.code as room,
       coalesce(ss.role, 'primary') as my_role,
       r.id as register_id, coalesce(r.state, 'pending') as register_state, coalesce(r.version, 0) as register_version
from public.class_sessions cs
join public.teaching_groups tg on tg.id = cs.teaching_group_id
join public.subject_offerings o on o.id = cs.offering_id
join public.subjects sub on sub.id = o.subject_id
left join public.divisions d on d.id = cs.division_id
left join public.rooms rm on rm.id = cs.room_id
left join public.session_staff ss on ss.session_id = cs.id and ss.staff_id = app.my_staff_id()
left join public.attendance_registers r on r.session_id = cs.id
where app.staff_on_session(cs.id);

create view public.v_my_day_registers with (security_invoker = true) as
select d.id as division_id, d.name as division_name, dates.att_date,
       app.is_working_day(d.id, dates.att_date) as working_day,
       dr.id as register_id, coalesce(dr.state, 'pending') as state, coalesce(dr.version, 0) as version,
       dr.submitted_at,
       (select count(*) from public.day_attendance da join public.attendance_status_codes sc on sc.code = da.status_code
        where da.day_register_id = dr.id and sc.counts_as_attended) as present_count,
       (select count(*) from public.day_attendance da where da.day_register_id = dr.id) as marked_count
from public.divisions d
cross join lateral (select (app.today() - g)::date as att_date from generate_series(0, 2) g) dates
left join public.day_registers dr on dr.division_id = d.id and dr.att_date = dates.att_date
where d.id = any (app.my_class_division_ids());

create view public.v_my_children with (security_invoker = true) as
select s.id as student_id, s.full_name, s.name_mr, s.gr_no, gl.is_primary,
       e.roll_no, d.id as division_id, d.name as division_name, st.code as standard, sm.code as stream
from public.guardian_links gl
join public.guardians g on g.id = gl.guardian_id and g.user_id = auth.uid()
join public.students s on s.id = gl.student_id
left join public.student_enrollments e on e.student_id = s.id and e.is_primary and e.valid_during @> app.today()
left join public.divisions d on d.id = e.division_id
left join public.standards st on st.id = e.standard_id
left join public.streams sm on sm.id = e.stream_id
where gl.status = 'verified';

create view public.v_my_profile with (security_invoker = true) as
select s.id as student_id, s.gr_no, s.full_name, s.name_mr, s.dob, s.apaar_id, s.saral_id, s.pen,
       e.roll_no, st.code as standard, sm.code as stream, sm.name as stream_name, e.medium_code,
       d.name as division_name, b.name as batch_name,
       (select br.hsc_seat_no from public.student_board_registrations br
        where br.student_id = s.id order by br.exam_session desc limit 1) as hsc_seat_no,
       coalesce((select jsonb_agg(sub.name order by sub.name)
                 from public.student_subject_choices c join public.subjects sub on sub.id = c.subject_id
                 where c.student_id = s.id and c.valid_during @> app.today()), '[]') as chosen_subjects
from public.students s
left join public.student_enrollments e on e.student_id = s.id and e.is_primary and e.valid_during @> app.today()
left join public.standards st on st.id = e.standard_id
left join public.streams sm on sm.id = e.stream_id
left join public.divisions d on d.id = e.division_id
left join public.batches b on b.id = e.batch_id
where s.id = app.my_student_id();

create view public.v_my_day_summary with (security_invoker = true) as
select s.student_id, s.term_id, t.seq as term_seq, t.name as term_name, t.academic_year_id,
       s.working_days, s.present_value, s.absent_days, s.percent, s.updated_at
from public.day_attendance_summaries s
join public.academic_terms t on t.id = s.term_id
where app.speaks_for(s.student_id);

create view public.v_my_eligibility with (security_invoker = true) as
select distinct on (es.student_id, es.academic_year_id)
       es.student_id, es.academic_year_id, es.as_of, es.kind, es.term1_percent, es.term2_percent,
       es.annual_percent, es.working_days, es.present_value, es.remaining_days, es.days_needed,
       es.subject_results, es.status
from public.eligibility_snapshots es
where app.speaks_for(es.student_id)
order by es.student_id, es.academic_year_id, es.as_of desc, es.kind desc;

create view public.v_my_attendance_summary with (security_invoker = true) as
select sm.student_id, sm.offering_id, sm.component, sub.name as subject_name, sub.name_mr as subject_name_mr,
       sm.held, sm.attended, sm.excused, sm.percent, sm.updated_at
from public.attendance_summaries sm
join public.subject_offerings o on o.id = sm.offering_id
join public.subjects sub on sub.id = o.subject_id
where app.speaks_for(sm.student_id);

create view public.v_my_timetable with (security_invoker = true) as
select cs.id, cs.session_date, cs.starts_at, cs.ends_at, cs.status, cs.status_reason, cs.component, cs.session_type,
       sub.name as subject_name, sub.name_mr as subject_name_mr, tg.name as group_name, rm.code as room
from public.class_sessions cs
join public.teaching_groups tg on tg.id = cs.teaching_group_id
join public.subject_offerings o on o.id = cs.offering_id
join public.subjects sub on sub.id = o.subject_id
left join public.rooms rm on rm.id = cs.room_id
where cs.teaching_group_id = any (app.student_group_ids(app.my_student_id(), cs.session_date));

create view public.v_academic_calendar with (security_invoker = true) as
select e.id, e.kind, e.title, e.title_mr, e.starts_on, e.ends_on, e.division_ids
from public.academic_calendar_events e
where e.academic_year_id = app.active_year_id();

create view public.v_my_leave with (security_invoker = true) as
select lr.id, lr.student_id, lr.leave_type, lt.label as leave_label, lt.label_mr as leave_label_mr, lr.span,
       lr.from_date, lr.to_date, lr.reason, lr.status, lr.applied_by_kind, lr.guardian_ack_at,
       lr.decision_note, lr.decided_at, lr.created_at
from public.leave_requests lr
join public.leave_types lt on lt.code = lr.leave_type
where app.speaks_for(lr.student_id) or lr.applied_by = auth.uid();

create view public.v_my_notices with (security_invoker = true) as
select n.id, n.student_id, n.level, n.period_from, n.period_to, n.day_percent, n.subject_percents,
       n.language, n.issued_at, n.acknowledged_at, n.pdf_asset_id
from public.defaulter_notices n
where app.speaks_for(n.student_id) and n.channel in ('app','both');

create view public.v_leave_pending_for_me with (security_invoker = true) as
select lr.id, lr.student_id, s.full_name, e.roll_no, d.name as division_name, lr.leave_type, lr.span,
       lr.from_date, lr.to_date, lr.reason, lr.status, lr.applied_by_kind, lr.document_asset_ids, lr.created_at
from public.leave_requests lr
join public.students s on s.id = lr.student_id
join public.divisions d on d.id = lr.division_id
left join public.student_enrollments e on e.student_id = lr.student_id and e.division_id = lr.division_id
  and upper_inf(e.valid_during)
where lr.status in ('pending','needs_info')
  and (lr.division_id = any (app.my_class_division_ids()) or app.can('leave.student.decide', 'all'));

create view public.v_my_class_guardians with (security_invoker = true) as
select e.division_id, s.id as student_id, s.full_name as student_name, e.roll_no,
       g.id as guardian_id, g.full_name as guardian_name, g.relation, g.phone, g.email, gl.status as link_status
from public.student_enrollments e
join public.students s on s.id = e.student_id
join public.guardian_links gl on gl.student_id = s.id and gl.status <> 'revoked'
join public.guardians g on g.id = gl.guardian_id
where e.division_id = any (app.my_class_division_ids()) and e.valid_during @> app.today();

-- ---------------------------------------------------------------------------
-- Grants. RPCs are callable by signed-in users only; the RPCs check permissions themselves.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;

-- RLS policy expressions call app.* as the invoking role.
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

grant select on all tables in schema public to authenticated;
grant select on public.app_config, public.college to anon;
