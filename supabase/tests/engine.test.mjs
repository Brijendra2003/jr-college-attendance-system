// Attendance engine, RLS and RPC behaviour tests (web doc §22), run against the real migrations
// in PGlite: `npm run test:db`. Scenarios run in order and share state.
import { boot, as, asService } from './harness.mjs';
import assert from 'node:assert/strict';
import { ELIGIBILITY_FIXTURES } from '../../src/shared/attendance.ts';

function fail(e) {
  console.error('\nFAIL:', e.message);
  if (e.where) console.error('where:', e.where.split('\n').slice(0, 6).join('\n'));
  if (e.detail) console.error('detail:', e.detail);
  if (!e.where) console.error(e.stack?.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const db = await boot();
const U = {
  principal: '00000000-0000-4000-8000-000000000001',
  office:    '00000000-0000-4000-8000-000000000002',
  ct:        '00000000-0000-4000-8000-000000000003', // class teacher of XI-SCI-A
  phy:       '00000000-0000-4000-8000-000000000004', // physics teacher
  parent:    '00000000-0000-4000-8000-000000000005', // verified guardian of s1
  student:   '00000000-0000-4000-8000-000000000006', // s1
  parent2:   '00000000-0000-4000-8000-000000000007', // pending link to s2
  coord:     '00000000-0000-4000-8000-000000000008', // commerce coordinator
};

await db.exec(`
insert into auth.users (id, email) values
 ('${U.principal}','principal@x.in'),('${U.office}','office@x.in'),('${U.ct}','ct@x.in'),('${U.phy}','phy@x.in'),
 ('${U.parent}','parent@x.in'),('${U.student}','s1@x.in'),('${U.parent2}','parent2@x.in'),('${U.coord}','coord@x.in');
insert into public.user_roles (user_id, role) values
 ('${U.principal}','principal'),('${U.office}','office'),('${U.ct}','teacher'),('${U.phy}','teacher'),
 ('${U.parent}','parent'),('${U.student}','student'),('${U.parent2}','parent'),('${U.coord}','teacher'),('${U.coord}','stream_coordinator');
update public.app_config set value = 'false' where key = 'require_aal2';
insert into public.college (name, divisional_board) values ('Demo Junior College', 'pune');
insert into public.academic_years (id, label, starts_on, ends_on, status)
  values ('10000000-0000-4000-8000-000000000001','2026-27','2026-06-15','2027-04-30','active');
insert into public.academic_terms (id, academic_year_id, seq, name, starts_on, ends_on) values
 ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'First term','2026-06-15','2026-10-31'),
 ('11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',2,'Second term','2026-11-16','2027-04-15');
insert into public.shifts (id, name, starts_at, ends_at) values ('12000000-0000-4000-8000-000000000001','Morning','07:30','13:00');
insert into public.divisions (id, academic_year_id, standard_id, stream_id, medium_code, code, name, shift_id)
select '13000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001', st.id, sm.id, 'en','A','XI-SCI-A','12000000-0000-4000-8000-000000000001'
from public.standards st, public.streams sm where st.code='XI' and sm.code='SCI';
insert into public.divisions (id, academic_year_id, standard_id, stream_id, medium_code, code, name, shift_id)
select '13000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000001', st.id, sm.id, 'en','A','XII-COM-A','12000000-0000-4000-8000-000000000001'
from public.standards st, public.streams sm where st.code='XII' and sm.code='COM';
insert into public.staff (id, employee_id, full_name, user_id) values
 ('14000000-0000-4000-8000-000000000003','E003','Class Teacher','${U.ct}'),
 ('14000000-0000-4000-8000-000000000004','E004','Physics Teacher','${U.phy}'),
 ('14000000-0000-4000-8000-000000000008','E008','Commerce Coordinator','${U.coord}');
insert into public.class_teacher_assignments (division_id, staff_id, valid_during)
 values ('13000000-0000-4000-8000-00000000000a','14000000-0000-4000-8000-000000000003', daterange('2026-06-01', null));
insert into public.stream_coordinators (stream_id, staff_id, valid_during)
 select id, '14000000-0000-4000-8000-000000000008', daterange('2026-06-01', null) from public.streams where code = 'COM';
insert into public.students (id, gr_no, surname, first_name, father_name, admitted_on, user_id) values
 ('15000000-0000-4000-8000-000000000001','1001','Patil','Aarav','Sunil','2026-06-15','${U.student}'),
 ('15000000-0000-4000-8000-000000000002','1002','Shinde','Bhakti','Ramesh','2026-06-15',null),
 ('15000000-0000-4000-8000-000000000003','1003','Kulkarni','Chinmay','Vijay','2026-06-15',null),
 ('15000000-0000-4000-8000-000000000004','1004','Deshmukh','Diya','Anil','2026-06-15',null),
 ('15000000-0000-4000-8000-000000000005','1005','Jadhav','Eshan','Prakash','2026-06-15',null),
 ('15000000-0000-4000-8000-000000000006','1006','More','Farah','Salim','2026-09-01',null),
 ('15000000-0000-4000-8000-000000000007','1007','Pawar','Gauri','Nitin','2026-06-15',null);
insert into public.student_enrollments (student_id, academic_year_id, standard_id, stream_id, medium_code, division_id, roll_no, valid_during)
select s.id, d.academic_year_id, d.standard_id, d.stream_id, 'en', d.id, x.roll, daterange(s.admitted_on, null)
from (values ('15000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-00000000000a','1'),
             ('15000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-00000000000a','2'),
             ('15000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-00000000000a','3'),
             ('15000000-0000-4000-8000-000000000004','13000000-0000-4000-8000-00000000000a','4'),
             ('15000000-0000-4000-8000-000000000005','13000000-0000-4000-8000-00000000000a','5'),
             ('15000000-0000-4000-8000-000000000006','13000000-0000-4000-8000-00000000000a','6'),
             ('15000000-0000-4000-8000-000000000007','13000000-0000-4000-8000-00000000000b','1')) x(sid, did, roll)
join public.students s on s.id = x.sid::uuid join public.divisions d on d.id = x.did::uuid;
insert into public.guardians (id, full_name, relation, email, user_id, preferred_language) values
 ('16000000-0000-4000-8000-000000000001','Sunil Patil','father','parent@x.in','${U.parent}','mr'),
 ('16000000-0000-4000-8000-000000000002','Ramesh Shinde','father','parent2@x.in','${U.parent2}','en');
insert into public.guardian_links (student_id, guardian_id, status) values
 ('15000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','verified'),
 ('15000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000002','pending');
select public.apply_msbshse_template();
insert into public.subject_offerings (id, subject_id, academic_year_id, standard_id, stream_id)
select '17000000-0000-4000-8000-000000000001', sub.id, '10000000-0000-4000-8000-000000000001', d.standard_id, d.stream_id
from public.subjects sub, public.divisions d where sub.name = 'Physics' and d.name = 'XI-SCI-A';
insert into public.teaching_groups (id, offering_id, component, kind, division_id, name)
values ('18000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','TH','division','13000000-0000-4000-8000-00000000000a','XI-SCI-A Physics');
insert into public.teaching_assignments (teaching_group_id, staff_id, valid_during)
values ('18000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000004', daterange('2026-06-01', null));
insert into public.class_sessions (id, session_date, starts_at, ends_at, teaching_group_id, offering_id, component, division_id, stream_id, standard_id, term_id)
select '19000000-0000-4000-8000-000000000001', '2026-10-12', app.ist('2026-10-12','08:00'), app.ist('2026-10-12','08:45'),
       '18000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'TH', d.id, d.stream_id, d.standard_id,
       '11000000-0000-4000-8000-000000000001'
from public.divisions d where d.name = 'XI-SCI-A';
`);
console.log('fixtures loaded');

const DIV_A = '13000000-0000-4000-8000-00000000000a';
const S = (n) => `15000000-0000-4000-8000-00000000000${n}`;
const uuid = () => crypto.randomUUID();
const one = async (tx, sql, p = []) => (await tx.query(sql, p)).rows[0];
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
const rejects = async (fn, code) => {
  try { await fn(); } catch (e) { assert.match(e.message, new RegExp(code)); return; }
  throw new Error(`expected ${code}`);
};

// 1. Class-teacher roll-call
const sub1 = uuid();
let r = await as(db, U.ct, (tx) => one(tx,
  `select public.submit_day_register($1,'2026-10-12',$2,0,$3) as r`,
  [DIV_A, sub1, JSON.stringify([{ student_id: S(1), status: 'P' }, { student_id: S(2), status: 'A' }])]));
assert.equal(r.r.result, 'ok');
assert.equal(r.r.defaulted_students.length, 4);
assert.equal(r.r.register.version, 1);
ok('roll-call submits; 4 unmarked students defaulted');

r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-12',$2,0,'[]') as r`, [DIV_A, sub1]));
assert.equal(r.r.result, 'duplicate');
ok('retry with same client_submission_id → duplicate');

r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-12',$2,0,'[]') as r`, [DIV_A, uuid()]));
assert.equal(r.r.result, 'conflict');
ok('stale base_version → conflict with server copy');

r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-12',$2,1,$3) as r`,
  [DIV_A, uuid(), JSON.stringify([{ student_id: S(1), status: 'A' }, { student_id: S(2), status: 'P' }])]));
assert.equal(r.r.result, 'ok');
const hist = await one(db, `select count(*)::int n from public.attendance_record_history where kind='day'`);
assert.ok(hist.n >= 2);
ok('edit within window bumps version and writes history');

await rejects(() => as(db, U.phy, (tx) => tx.query(`select public.submit_day_register($1,'2026-10-12',$2,2,'[]')`, [DIV_A, uuid()])), 'ATT_FORBIDDEN');
ok('non-class-teacher cannot mark the division');

r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-11',$2,0,'[]') as r`, [DIV_A, uuid()]));
assert.equal(r.r.result, 'not_working_day');
ok('Sunday → not_working_day');

await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.submit_day_register($1,'2026-10-13',$2,0,$3)`,
  [DIV_A, uuid(), JSON.stringify([{ student_id: S(7), status: 'P' }])])), 'ATT_STUDENT_NOT_IN_ROSTER');
ok('student from another division rejected');

await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.submit_day_register($1,'2026-10-13',$2,0,$3)`,
  [DIV_A, uuid(), JSON.stringify([{ student_id: S(1), status: 'LT' }])])), 'ATT_INVALID_STATUS');
ok('period-only status rejected on the day register');

// late admission: s6 admitted 2026-09-01 is not on the August roster
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-08-10') as r`, [DIV_A]));
assert.equal(r.r.students.length, 5);
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-10-12') as r`, [DIV_A]));
assert.equal(r.r.students.length, 6);
assert.equal(r.r.students[0].roll_no, '1');
ok('roster respects admission date (late CAP admission)');

// Summaries
const sum = await one(db, `select working_days, present_value::float, percent::float from public.day_attendance_summaries where student_id=$1`, [S(2)]);
assert.deepEqual(sum, { working_days: 1, present_value: 1, percent: 100 });
ok('day summary recomputed');

// Notifications: s1 absent after edit → verified parent alerted (Marathi)
const notif = await one(db, `select count(*)::int n, max(payload->>'title') t from public.notification_outbox where user_id=$1`, [U.parent]);
assert.equal(notif.n, 1);
assert.match(notif.t, /अनुपस्थित/);
const notif2 = await one(db, `select count(*)::int n from public.notification_outbox where user_id=$1`, [U.parent2]);
assert.equal(notif2.n, 0);
ok('absence alert to verified guardian only, in Marathi, deduped');

// RLS
r = await as(db, U.parent, (tx) => one(tx, `select count(*)::int n, count(distinct student_id)::int s from public.day_attendance`));
assert.deepEqual(r, { n: 1, s: 1 });
r = await as(db, U.parent2, (tx) => one(tx, `select count(*)::int n from public.day_attendance`));
assert.equal(r.n, 0);
r = await as(db, U.parent, (tx) => one(tx, `select count(*)::int n from public.students`));
assert.equal(r.n, 1);
r = await as(db, U.phy, (tx) => one(tx, `select count(*)::int n from public.day_attendance`));
assert.equal(r.n, 0);
r = await as(db, U.ct, (tx) => one(tx, `select count(*)::int n from public.students`));
assert.equal(r.n, 6);
r = await as(db, U.coord, (tx) => one(tx, `select count(*)::int n from public.students`));
assert.equal(r.n, 1);
r = await as(db, U.office, (tx) => one(tx, `select count(*)::int n from public.students`));
assert.equal(r.n, 7);
r = await as(db, U.student, (tx) => one(tx, `select count(*)::int n from public.day_attendance`));
assert.equal(r.n, 1);
r = await as(db, U.parent, (tx) => one(tx, `select count(*)::int n from public.student_sensitive`));
assert.equal(r.n, 0);
ok('RLS: parent/student/teacher/coordinator/office scopes');

await rejects(() => as(db, U.office, (tx) => tx.query(`insert into public.day_attendance (day_register_id, student_id, status_code, division_id, stream_id, standard_id, term_id, att_date) select id, $1, 'P', division_id, (select stream_id from public.divisions where id=division_id), (select standard_id from public.divisions where id=division_id), term_id, att_date from public.day_registers limit 1`, [S(3)])), 'row-level security');
ok('no direct writes to attendance tables');

// Views for mobile
r = await as(db, U.parent, (tx) => tx.query(`select * from public.v_my_children`));
assert.equal(r.rows.length, 1); assert.equal(r.rows[0].division_name, 'XI-SCI-A');
r = await as(db, U.parent, (tx) => tx.query(`select * from public.v_my_day_summary`));
assert.equal(r.rows.length, 1);
r = await as(db, U.ct, (tx) => one(tx, `select public.my_capabilities() as c`));
assert.equal(r.c.class_divisions[0].name, 'XI-SCI-A');
r = await as(db, U.phy, (tx) => tx.query(`select * from public.v_my_sessions`));
assert.equal(r.rows.length, 1); assert.equal(r.rows[0].subject_name, 'Physics');
ok('mobile views and my_capabilities');

// Period attendance
r = await as(db, U.phy, (tx) => one(tx, `select public.session_roster_for_marking('19000000-0000-4000-8000-000000000001') as r`));
assert.equal(r.r.students.length, 6);
r = await as(db, U.phy, (tx) => one(tx, `select public.submit_attendance('19000000-0000-4000-8000-000000000001',$1,0,$2) as r`,
  [uuid(), JSON.stringify([{ student_id: S(1), status: 'P' }, { student_id: S(2), status: 'LT' }])]));
assert.equal(r.r.result, 'ok');
const subj = await one(db, `select held::float, attended::float from public.attendance_summaries where student_id=$1`, [S(2)]);
assert.deepEqual(subj, { held: 1, attended: 1 });
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.submit_attendance('19000000-0000-4000-8000-000000000001',$1,1,'[]')`, [uuid()])), 'ATT_FORBIDDEN');
ok('period submission by assigned teacher, subject summary, others forbidden');

// Locking + corrections
await db.exec(`update public.day_registers set first_submitted_at = now() - interval '13 hours' where division_id='${DIV_A}' and att_date='2026-10-12'`);
r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-12',$2,2,'[]') as r`, [DIV_A, uuid()]));
assert.equal(r.r.result, 'locked');
ok('edit window closes after 12 h');
const locked = await one(db, `select app.lock_due_registers() n`);
assert.ok(locked.n >= 1);
const reg = await one(db, `select id, state from public.day_registers where division_id=$1 and att_date='2026-10-12'`, [DIV_A]);
assert.equal(reg.state, 'locked');
ok('lock job locks registers past the deadline');

const req = await as(db, U.ct, (tx) => one(tx, `select public.request_attendance_correction('day',$1,$2,'Was at NCC camp') as id`,
  [reg.id, JSON.stringify([{ student_id: S(1), status: 'OD' }])]));
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.decide_correction($1,true)`, [req.id])), 'ATT_FORBIDDEN');
r = await as(db, U.principal, (tx) => one(tx, `select public.decide_correction($1,true,'ok') as r`, [req.id]));
assert.equal(r.r.result, 'approved');
const corrected = await one(db, `select status_code, source from public.day_attendance where day_register_id=$1 and student_id=$2`, [reg.id, S(1)]);
assert.deepEqual(corrected, { status_code: 'OD', source: 'correction' });
ok('correction requested by class teacher, approved by principal, applied');

// Reopen
r = await as(db, U.office, (tx) => one(tx, `select public.reopen_register('day',$1, now() + interval '1 hour','late marking') as r`, [reg.id]));
const v = await one(db, `select version from public.day_registers where id=$1`, [reg.id]);
r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-12',$2,$3,$4) as r`,
  [DIV_A, uuid(), v.version, JSON.stringify([{ student_id: S(3), status: 'HD' }])]));
assert.equal(r.r.result, 'ok');
ok('reopened register accepts a resubmission');

// Holiday declared after the fact
await as(db, U.ct, (tx) => tx.query(`select public.submit_day_register($1,'2026-10-14',$2,0,'[]')`, [DIV_A, uuid()]));
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.declare_holiday('2026-10-14','Rain holiday')`)), 'ATT_FORBIDDEN');
r = await as(db, U.office, (tx) => one(tx, `select public.declare_holiday('2026-10-14','Rain holiday') as r`));
assert.equal(r.r.voided_day_registers, 1);
const after = await one(db, `select working_days from public.day_attendance_summaries where student_id=$1`, [S(4)]);
assert.equal(after.working_days, 1);
r = await as(db, U.ct, (tx) => one(tx, `select public.submit_day_register($1,'2026-10-14',$2,0,'[]') as r`, [DIV_A, uuid()]));
assert.equal(r.r.result, 'not_working_day');
ok('declare_holiday voids registers and removes the day from working days');

// Month close
r = await as(db, U.office, (tx) => one(tx, `select public.close_attendance_month($1,'2026-09-01') as r`, [DIV_A]));
assert.equal(r.r.result, 'incomplete');
assert.ok(r.r.missing_dates.length > 20);
ok('month close refuses with missing working days');
// fill September (Mon–Sat) and close
for (const d of r.r.missing_dates) {
  await as(db, U.office, (tx) => tx.query(`select public.submit_day_register($1,$2,$3,0,'[]')`, [DIV_A, d, uuid()]));
}
await db.exec(`update public.day_registers set state='locked' where att_date between '2026-09-01' and '2026-09-30'`);
r = await as(db, U.office, (tx) => one(tx, `select public.close_attendance_month($1,'2026-09-01') as r`, [DIV_A]));
assert.equal(r.r.result, 'ok');
const sepReg = await one(db, `select id from public.day_registers where division_id=$1 and att_date='2026-09-02'`, [DIV_A]);
await rejects(() => as(db, U.office, (tx) => tx.query(`select public.reopen_register('day',$1, now() + interval '1 hour','x')`, [sepReg.id])), 'MONTH_CLOSED');
const req2 = await as(db, U.ct, (tx) => one(tx, `select public.request_attendance_correction('day',$1,$2,'Certificate produced') as id`,
  [sepReg.id, JSON.stringify([{ student_id: S(5), status: 'ML' }])]));
await as(db, U.principal, (tx) => tx.query(`select public.decide_correction($1,true)`, [req2.id]));
const month = await one(db, `select state, revised from public.attendance_months where division_id=$1`, [DIV_A]);
assert.deepEqual(month, { state: 'closed', revised: true });
r = await as(db, U.ct, (tx) => one(tx, `select public.sign_muster($1,'2026-09-01','class_teacher') as r`, [DIV_A]));
assert.equal(r.r.result, 'ok');
ok('month close, guard, correction through closed month marks muster revised, sign-off');

// Eligibility
const n = await as(db, U.principal, (tx) => one(tx, `select public.evaluate_eligibility('2026-10-20') as n`));
assert.equal(n.n, 7);
// September was filled with empty submissions → everyone defaulted to A, so s5 is far below 75%
// but can still recover in the remaining working days.
const el = await one(db, `select status, working_days, present_value::float pv, remaining_days, days_needed from public.eligibility_snapshots where student_id=$1`, [S(5)]);
assert.equal(el.status, 'at_risk');
assert.ok(el.days_needed > 0 && el.days_needed <= el.remaining_days);
assert.equal(el.days_needed, Math.ceil((75 * el.working_days - 100 * el.pv) / 25));
await db.exec(`insert into public.condonation_cases (student_id, academic_year_id, ground, details, status)
  values ('${S(5)}', '10000000-0000-4000-8000-000000000001', 'medical', 'Hospitalised', 'recommended')`);
await as(db, U.principal, (tx) => tx.query(`select public.evaluate_eligibility('2026-10-20')`));
const el2 = await one(db, `select status from public.eligibility_snapshots where student_id=$1 and as_of='2026-10-20'`, [S(5)]);
assert.equal(el2.status, 'condonation_pending');
r = await as(db, U.parent, (tx) => tx.query(`select * from public.v_my_eligibility`));
assert.equal(r.rows.length, 1);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.evaluate_eligibility()`)), 'ATT_FORBIDDEN');
ok('evaluate_eligibility snapshots; parent sees own child only');

// Defaulter notice + acknowledgement
const notice = await as(db, U.ct, (tx) => one(tx, `select public.issue_defaulter_notice($1,'warning') as id`, [S(1)]));
await rejects(() => as(db, U.parent2, (tx) => tx.query(`select public.acknowledge_notice($1)`, [notice.id])), 'ATT_FORBIDDEN');
await as(db, U.parent, (tx) => tx.query(`select public.acknowledge_notice($1)`, [notice.id]));
const ack = await one(db, `select acknowledged_by from public.defaulter_notices where id=$1`, [notice.id]);
assert.equal(ack.acknowledged_by, U.parent);
r = await as(db, U.ct, (tx) => one(tx, `select public.class_overview($1) as r`, [DIV_A]));
assert.equal(r.r.students.length, 6);
ok('defaulter notice issued by class teacher, acknowledged by guardian; class overview');

// Leave
const leave = await as(db, U.student, (tx) => one(tx, `select public.apply_leave('personal', app.today() + 1, app.today() + 2, 'Family function') as id`));
let lr = await one(db, `select status from public.leave_requests where id=$1`, [leave.id]);
assert.equal(lr.status, 'awaiting_guardian');
await as(db, U.parent, (tx) => tx.query(`select public.acknowledge_leave($1)`, [leave.id]));
await rejects(() => as(db, U.phy, (tx) => tx.query(`select public.decide_leave($1,'approved')`, [leave.id])), 'ATT_FORBIDDEN');
await as(db, U.ct, (tx) => tx.query(`select public.decide_leave($1,'approved','ok')`, [leave.id]));
lr = await one(db, `select status from public.leave_requests where id=$1`, [leave.id]);
assert.equal(lr.status, 'approved');
await rejects(() => as(db, U.parent, (tx) => tx.query(`select public.apply_leave('personal', app.today() + 2, app.today() + 3, 'x', $1)`, [S(1)])), 'LEAVE_OVERLAP');
r = await as(db, U.parent, (tx) => tx.query(`select * from public.v_my_leave`));
assert.equal(r.rows.length, 1);
ok('student leave → guardian ack → class teacher approval; overlap blocked');

// Import
const rows = [
  { surname: 'Gaikwad', first_name: 'Harsh', father_name: 'Rajesh', division: 'XI-SCI-A', dob: '2010-05-04', cap_application_no: 'CAP-1', father_name: 'Rajesh Gaikwad', father_email: 'rajesh@x.in' },
  { surname: '', first_name: 'NoSurname', division: 'XI-SCI-A' },
  { surname: 'Patil', first_name: 'Aarav', division: 'XI-SCI-A', gr_no: '1001' },
  { surname: 'X', first_name: 'Y', division: 'XI-ZZZ' },
];
r = await as(db, U.office, (tx) => one(tx, `select public.import_students($1, false) as r`, [JSON.stringify(rows)]));
assert.deepEqual(r.r.summary, { new: 1, existing: 1, error: 2 });
r = await as(db, U.office, (tx) => one(tx, `select public.import_students($1, true) as r`, [JSON.stringify(rows)]));
assert.equal(r.r.summary.new, 1);
const imported = await one(db, `select s.gr_no, e.roll_no, (select count(*)::int from public.guardian_links gl where gl.student_id=s.id) g
  from public.students s join public.student_enrollments e on e.student_id=s.id where s.cap_application_no='CAP-1'`);
assert.equal(imported.roll_no, '7'); assert.equal(imported.g, 1);
r = await as(db, U.office, (tx) => one(tx, `select public.import_students($1, true) as r`, [JSON.stringify(rows.slice(0, 1))]));
assert.equal(r.r.summary.existing, 1);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.import_students('[]', false)`)), 'ATT_FORBIDDEN');
ok('import preview/commit, idempotent on CAP no., roll appended, guardian linked');

// Timetable publish
await db.exec(`
insert into public.timetable_versions (id, academic_year_id, term_id, standard_id, stream_id, name, effective_from)
select '1a000000-0000-4000-8000-000000000001', d.academic_year_id, '11000000-0000-4000-8000-000000000002', d.standard_id, d.stream_id, 'T2 v1', '2026-11-16'
from public.divisions d where d.name = 'XI-SCI-A';
insert into public.timetable_slots (version_id, weekday, period_no, starts_at, ends_at, teaching_group_id)
values ('1a000000-0000-4000-8000-000000000001', 1, 1, '07:30', '08:15', '18000000-0000-4000-8000-000000000001'),
       ('1a000000-0000-4000-8000-000000000001', 3, 2, '08:15', '09:00', '18000000-0000-4000-8000-000000000001');`);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.publish_timetable('1a000000-0000-4000-8000-000000000001')`)), 'ATT_FORBIDDEN');
r = await as(db, U.principal, (tx) => one(tx, `select public.publish_timetable('1a000000-0000-4000-8000-000000000001') as r`));
console.log('    publish', r.r);
assert.ok(r.r.sessions_created > 40);
const staffed = await one(db, `select count(*)::int n from public.session_staff ss join public.class_sessions cs on cs.id = ss.session_id where cs.session_date >= '2026-11-16'`);
assert.equal(staffed.n, r.r.sessions_created);
r = await as(db, U.principal, (tx) => one(tx, `select public.publish_timetable('1a000000-0000-4000-8000-000000000001') as r`));
assert.equal(r.r.sessions_replaced, r.r.sessions_created);
ok('publish_timetable generates staffed sessions; republish replaces unmarked ones');

// Access token hook
r = await one(db, `select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) as e`, [U.ct]);
assert.deepEqual(r.e.claims.app_roles, ['teacher']);
assert.equal(r.e.claims.staff_id, '14000000-0000-4000-8000-000000000003');
ok('custom access token hook adds roles and staff_id');

// Inactive account
await db.exec(`update public.profiles set is_active = false where id = '${U.ct}'`);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.submit_day_register($1,'2026-10-15',$2,0,'[]')`, [DIV_A, uuid()])), 'ACCOUNT_INACTIVE');
r = await as(db, U.ct, (tx) => one(tx, `select count(*)::int n from public.students`));
assert.equal(r.n, 0);
await db.exec(`update public.profiles set is_active = true where id = '${U.ct}'`);
ok('deactivated account loses access');

// Anonymous
r = await db.transaction(async (tx) => { await tx.exec('set local role anon'); return one(tx, `select count(*)::int n from public.app_config`); });
assert.ok(r.n >= 4);
await rejects(() => db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query(`select public.my_capabilities()`); }), 'permission denied');
ok('anon reads public config only, cannot call RPCs');

// Misc jobs
await one(db, `select app.generate_day_registers('2026-10-26') n`);
await one(db, `select app.reconcile_summaries() n`);
await one(db, `select app.build_parent_digest() n`);
await one(db, `select app.rollcall_reminders()`);
await one(db, `select app.cleanup()`);
ok('jobs run');

// ---------------------------------------------------------------- shared fixtures (SQL = TypeScript)
for (const f of ELIGIBILITY_FIXTURES) {
  const r = await one(db, `select app.days_needed($1, $2, $3) n, app.classify_eligibility($1, $2, $4, $3, $5) s`,
    [f.present, f.working, f.min, f.remaining, f.kind]);
  assert.equal(r.n, f.needed, `days_needed ${JSON.stringify(f)}`);
  assert.equal(r.s, f.status, `classify ${JSON.stringify(f)}`);
}
ok(`SQL eligibility maths matches src/shared/attendance.ts (${ELIGIBILITY_FIXTURES.length} fixtures)`);

// ---------------------------------------------------------------- 0010: records RPCs
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-09-02') as r`, [DIV_A]));
assert.equal(r.r.register.block, 'month_closed');
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-10-11') as r`, [DIV_A]));
assert.equal(r.r.working_day, false);
ok('marking roster reports why a register is not editable');

await db.exec(`insert into public.divisions (id, academic_year_id, standard_id, stream_id, medium_code, code, name)
  select '13000000-0000-4000-8000-00000000000c', academic_year_id, standard_id, stream_id, 'en', 'B', 'XI-SCI-B'
  from public.divisions where id = '${DIV_A}'`);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.transfer_student($1, '13000000-0000-4000-8000-00000000000c', '2026-10-20', null, 'x')`, [S(4)])), 'ATT_FORBIDDEN');
r = await as(db, U.office, (tx) => one(tx, `select public.transfer_student($1, '13000000-0000-4000-8000-00000000000c', '2026-10-20', null, 'parent request') as r`, [S(4)]));
assert.equal(r.r.roll_no, '1');
const enr = (await db.query(`select division_id, lower(valid_during)::text lo, upper(valid_during)::text hi from public.student_enrollments where student_id=$1 order by lower(valid_during)`, [S(4)])).rows;
assert.deepEqual(enr.map((e) => [e.lo, e.hi]), [['2026-06-15', '2026-10-20'], ['2026-10-20', null]]);
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-10-21') as r`, [DIV_A]));
assert.ok(!r.r.students.some((s) => s.student_id === S(4)));
ok('division transfer closes one enrollment and opens another; rosters follow the date');

r = await as(db, U.office, (tx) => one(tx, `select public.end_enrollment($1, 'admission_cancelled', '2026-10-21', 'CAP seat surrendered') as r`, [S(6)]));
const s6 = await one(db, `select status, gr_no from public.students where id=$1`, [S(6)]);
assert.deepEqual(s6, { status: 'admission_cancelled', gr_no: '1006' });
r = await as(db, U.ct, (tx) => one(tx, `select public.division_roster_for_marking($1,'2026-10-23') as r`, [DIV_A]));
assert.ok(!r.r.students.some((s) => s.student_id === S(6)));
await rejects(() => db.query(`delete from public.students where id=$1`, [S(6)]), 'STUDENT_NO_DELETE');
await rejects(() => db.query(`update public.students set gr_no='X' where id=$1`, [S(6)]), 'GR_NO_IMMUTABLE');
ok('admission cancelled: enrollment closed, GR No. kept and immutable, no hard delete');

await as(db, U.office, (tx) => tx.query(`select public.assign_class_teacher('13000000-0000-4000-8000-00000000000c', '14000000-0000-4000-8000-000000000004', '2026-10-25')`));
await as(db, U.office, (tx) => tx.query(`select public.assign_class_teacher('13000000-0000-4000-8000-00000000000c', '14000000-0000-4000-8000-000000000008', '2026-10-26')`));
const cts = (await db.query(`select staff_id, lower(valid_during)::text lo, upper(valid_during)::text hi from public.class_teacher_assignments where division_id = '13000000-0000-4000-8000-00000000000c' order by lower(valid_during)`)).rows;
assert.deepEqual(cts.map((c) => [c.lo, c.hi]), [['2026-10-25', '2026-10-26'], ['2026-10-26', null]]);
ok('class-teacher hand-over is effective-dated without overlap');

const sub = await one(db, `select id from public.subjects where name = 'Chemistry'`);
const grp = await as(db, U.principal, (tx) => one(tx, `select public.create_teaching_group($1, $2, 'PR', null, '14000000-0000-4000-8000-000000000004') g`, [sub.id, DIV_A]));
const g = await one(db, `select tg.name, tg.kind, (select count(*)::int from public.teaching_assignments ta where ta.teaching_group_id = tg.id) n from public.teaching_groups tg where id=$1`, [grp.g]);
assert.deepEqual(g, { name: 'XI-SCI-A Chemistry PR', kind: 'division', n: 1 });
ok('create_teaching_group makes offering, group and assignment');

await db.exec(`insert into public.announcements (id, title, body, scope, audience, created_by)
  values ('1b000000-0000-4000-8000-000000000001', 'PTM on Saturday', 'Parents meeting at 10 am', 'class',
          '{"roles":["parent","student"],"division_ids":["${DIV_A}"]}', '${U.principal}')`);
await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.publish_announcement('1b000000-0000-4000-8000-000000000001')`)), 'ATT_FORBIDDEN');
r = await as(db, U.principal, (tx) => one(tx, `select public.publish_announcement('1b000000-0000-4000-8000-000000000001') n`));
assert.equal(r.n, 2); // verified parent of s1 + student s1
r = await as(db, U.parent, (tx) => tx.query(`select title from public.announcements`));
assert.equal(r.rows.length, 1);
r = await as(db, U.parent2, (tx) => tx.query(`select title from public.announcements`));
assert.equal(r.rows.length, 0);
ok('announcement audience resolves to verified parents and students of the division only');

await rejects(() => as(db, U.ct, (tx) => tx.query(`select public.log_export('readiness', '{}', 3, 'readiness')`)), 'ATT_FORBIDDEN');
await as(db, U.office, (tx) => tx.query(`select public.log_export('readiness', '{}', 3, 'readiness')`));
const logged = await one(db, `select (select count(*)::int from public.govt_exports) g, (select count(*)::int from public.audit_log where entity = 'report:readiness') a`);
assert.deepEqual(logged, { g: 1, a: 1 });
// Clients have no UPDATE policy (0 rows affected); even the table owner is stopped by the trigger.
r = await as(db, U.office, (tx) => tx.query(`update public.audit_log set reason = 'x'`));
assert.equal(r.affectedRows ?? 0, 0);
await rejects(() => db.query(`update public.audit_log set reason = 'x'`), 'AUDIT_APPEND_ONLY');
ok('exports are audited and logged; audit log is append-only');

// ---------------------------------------------------------------- 0011: usernames
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000099', 'principle@accounts.invalid', '{"username":"Principle","display_name":"Principal"}')`);
const prof = await one(db, `select username, email from public.profiles where id = '00000000-0000-4000-8000-000000000099'`);
assert.deepEqual(prof, { username: 'principle', email: 'principle@accounts.invalid' });
await rejects(() => db.query(`update public.profiles set username = 'Bad Name' where id = '00000000-0000-4000-8000-000000000099'`), 'check constraint');
await db.exec(`update auth.users set email = 'principal@college.edu.in' where id = '00000000-0000-4000-8000-000000000099'`);
assert.equal((await one(db, `select email from public.profiles where id = '00000000-0000-4000-8000-000000000099'`)).email, 'principal@college.edu.in');
r = await db.query(`select has_function_privilege('anon', 'app.can(text,text)', 'execute') a,
  has_function_privilege('anon', 'public.submit_day_register(uuid,date,uuid,integer,jsonb,timestamptz,text)', 'execute') b,
  has_schema_privilege('anon', 'app', 'usage') c`);
assert.deepEqual(r.rows[0], { a: false, b: false, c: false });
ok('usernames are stored lower-case and validated; email changes sync; anon cannot execute functions');

// ---------------------------------------------------------------- notification dispatch contract
await rejects(() => as(db, U.office, (tx) => tx.query(`select * from public.claim_notification_batch(10)`)), 'permission denied');
r = await asService(db, (tx) => tx.query(`select * from public.claim_notification_batch(500)`));
assert.ok(r.rows.length > 0);
await asService(db, (tx) => tx.query(`select public.complete_notification($1, true)`, [r.rows[0].id]));
const sent = await one(db, `select status from public.notification_outbox where id=$1`, [r.rows[0].id]);
assert.equal(sent.status, 'sent');
ok('outbox claim/complete is service-role only');

console.log(`\n${passed} checks passed`);
