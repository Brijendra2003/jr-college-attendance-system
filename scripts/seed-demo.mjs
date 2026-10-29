// LOCAL DEMO DATA ONLY. Builds a small college through the real RPCs, signed in as the real roles,
// so the web app and the mobile app have something to show:
//   npm run seed:demo            (refuses if the college is already set up)
//   npm run seed:demo -- --force (adds demo data anyway; never on production)
import { admin, assertEdition, must, signedIn } from './env.mjs';

const PASSWORD = 'Demo@12345';
const force = process.argv.includes('--force');
await assertEdition();

const { data: existing } = await admin.from('college').select('setup_completed_at').maybeSingle();
if (existing?.setup_completed_at && !force) {
  console.error('The college is already set up. Re-run with --force only on a local/dev database.');
  process.exit(1);
}

// ---------------------------------------------------------------- deterministic randomness
let seed = 20261028;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const SURNAMES = ['Patil', 'Shinde', 'Kulkarni', 'Deshmukh', 'Jadhav', 'More', 'Pawar', 'Gaikwad', 'Chavan', 'Joshi', 'Kale', 'Sawant', 'Bhosale', 'Kadam', 'Salunkhe', 'Shaikh', 'Mane', 'Wagh', 'Thorat', 'Nikam'];
const SURNAMES_MR = ['पाटील', 'शिंदे', 'कुलकर्णी', 'देशमुख', 'जाधव', 'मोरे', 'पवार', 'गायकवाड', 'चव्हाण', 'जोशी', 'काळे', 'सावंत', 'भोसले', 'कदम', 'साळुंखे', 'शेख', 'माने', 'वाघ', 'थोरात', 'निकम'];
const FIRST = [['Aarav', 'male'], ['Aditi', 'female'], ['Om', 'male'], ['Sakshi', 'female'], ['Pranav', 'male'], ['Sneha', 'female'], ['Atharva', 'male'], ['Vaishnavi', 'female'], ['Soham', 'male'], ['Rutuja', 'female'], ['Tanmay', 'male'], ['Gauri', 'female'], ['Yash', 'male'], ['Siddhi', 'female'], ['Varad', 'male'], ['Mrunal', 'female'], ['Aryan', 'male'], ['Isha', 'female'], ['Harsh', 'male'], ['Pooja', 'female']];
const FATHERS = ['Sunil', 'Ramesh', 'Vijay', 'Anil', 'Prakash', 'Sanjay', 'Mahesh', 'Dattatray', 'Rajendra', 'Santosh'];

// ---------------------------------------------------------------- dates (IST)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const [ty, tm] = today.split('-').map(Number);
const y0 = tm >= 6 ? ty : ty - 1;
const year = { label: `${y0}-${String((y0 + 1) % 100).padStart(2, '0')}`, starts_on: `${y0}-06-15`, ends_on: `${y0 + 1}-04-30` };
const t1End = `${y0}-10-31`;
const t2Start = `${y0}-11-16`;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const inTerm = (d) => (d >= year.starts_on && d <= t1End) || (d >= t2Start && d <= year.ends_on);
const isSunday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

console.log(`Seeding demo college for ${year.label} (today ${today})…`);

// ---------------------------------------------------------------- college, template, year
must(await admin.from('college').upsert({
  id: 1, name: 'Demo Junior College of Arts, Commerce & Science', name_mr: 'डेमो कनिष्ठ कला, वाणिज्य व विज्ञान महाविद्यालय',
  address: 'Shivajinagar, Pune 411005', district: 'Pune', taluka: 'Haveli', divisional_board: 'pune',
  board_index_no: 'J11.01.001', udise_code: '27250000000', management_type: 'aided', mediums: ['en', 'mr'],
}, { onConflict: 'id' }), 'college');
must(await admin.rpc('apply_msbshse_template'), 'template');

must(await admin.from('academic_years').update({ status: 'archived' }).eq('status', 'active'), 'archive');
const { data: yr } = await admin.from('academic_years').select('id').eq('label', year.label).maybeSingle();
const yearId = yr?.id ?? must(await admin.from('academic_years').insert({ ...year, status: 'active' }).select('id').single(), 'year').id;
must(await admin.from('academic_years').update({ status: 'active' }).eq('id', yearId), 'activate');
must(await admin.from('academic_terms').upsert([
  { academic_year_id: yearId, seq: 1, name: 'First term', starts_on: year.starts_on, ends_on: t1End },
  { academic_year_id: yearId, seq: 2, name: 'Second term', starts_on: t2Start, ends_on: year.ends_on },
], { onConflict: 'academic_year_id,seq' }), 'terms');
must(await admin.from('academic_calendar_events').insert([
  { academic_year_id: yearId, kind: 'public_holiday', title: 'Independence Day', title_mr: 'स्वातंत्र्य दिन', starts_on: `${y0}-08-15`, ends_on: `${y0}-08-15` },
  { academic_year_id: yearId, kind: 'public_holiday', title: 'Ganesh Chaturthi', title_mr: 'गणेश चतुर्थी', starts_on: `${y0}-09-14`, ends_on: `${y0}-09-14` },
  { academic_year_id: yearId, kind: 'vacation', title: 'Diwali vacation', title_mr: 'दिवाळी सुट्टी', starts_on: `${y0}-11-01`, ends_on: `${y0}-11-15` },
]), 'calendar');

const shift = must(await admin.from('shifts').upsert({ name: 'Morning', starts_at: '07:30', ends_at: '13:00' }, { onConflict: 'name' }).select('id').single(), 'shift');
const ids = async (table, col) => Object.fromEntries((must(await admin.from(table).select(`id, ${col}`), table)).map((r) => [r[col], r.id]));
const std = await ids('standards', 'code');
const stream = await ids('streams', 'code');

const divisionDefs = [
  { name: 'XI-SCI-A', standard: 'XI', stream: 'SCI', medium: 'en', ct: 'ct.sci' },
  { name: 'XI-COM-A', standard: 'XI', stream: 'COM', medium: 'en', ct: 'ct.com' },
  { name: 'XII-ARTS-A', standard: 'XII', stream: 'ARTS', medium: 'mr', ct: null },
];
const divisions = {};
for (const d of divisionDefs) {
  divisions[d.name] = must(await admin.from('divisions').upsert({
    academic_year_id: yearId, standard_id: std[d.standard], stream_id: stream[d.stream], medium_code: d.medium,
    code: 'A', name: d.name, capacity: 120, shift_id: shift.id,
  }, { onConflict: 'academic_year_id,standard_id,stream_id,code' }).select('id').single(), d.name).id;
}
const batches = must(await admin.from('batches').upsert([
  { division_id: divisions['XI-SCI-A'], code: 'P1', name: 'Batch P1 (roll 1–15)' },
  { division_id: divisions['XI-SCI-A'], code: 'P2', name: 'Batch P2 (roll 16+)' },
], { onConflict: 'division_id,code' }).select('id, code'), 'batches');

// ---------------------------------------------------------------- staff and logins
async function user(email, name, roles) {
  const found = must(await admin.from('profiles').select('id').eq('email', email).maybeSingle(), 'profile');
  let id = found?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } });
    if (error) throw new Error(`${email}: ${error.message}`);
    id = data.user.id;
  }
  must(await admin.from('user_roles').upsert(roles.map((role) => ({ user_id: id, role })), { onConflict: 'user_id,role', ignoreDuplicates: true }), 'roles');
  return id;
}

const staffDefs = [
  ['principal', 'Dr. Smita Kulkarni', 'principal', ['principal', 'admin']],
  ['supervisor', 'Mr. Rajesh Deshpande', 'supervisor', ['supervisor', 'teacher']],
  ['office', 'Mrs. Sunanda Pawar', 'clerk', ['office']],
  ['ct.sci', 'Mrs. Anjali Joshi', 'lecturer', ['teacher']],
  ['ct.com', 'Mr. Nitin Kale', 'lecturer', ['teacher']],
  ['physics', 'Mr. Vivek Sathe', 'lecturer', ['teacher']],
];
const staff = {};
for (const [key, name, designation, roles] of staffDefs) {
  const email = `${key}@demo.jcas.local`;
  const uid = await user(email, name, roles);
  staff[key] = must(await admin.from('staff').upsert({ employee_id: `E-${key.toUpperCase()}`, full_name: name, designation, email, user_id: uid }, { onConflict: 'employee_id' }).select('id').single(), 'staff').id;
}
for (const d of divisionDefs.filter((d) => d.ct)) {
  const { count } = await admin.from('class_teacher_assignments').select('id', { count: 'exact', head: true }).eq('division_id', divisions[d.name]);
  if (!count) must(await admin.from('class_teacher_assignments').insert({ division_id: divisions[d.name], staff_id: staff[d.ct], valid_during: `[${year.starts_on},)` }), 'ct');
}

// ---------------------------------------------------------------- students via the import RPC (as Office)
const office = await signedIn('office@demo.jcas.local', PASSWORD);
const rows = [];
let n = 0;
for (const d of divisionDefs) {
  for (let i = 0; i < 30; i++) {
    const si = Math.floor(rand() * SURNAMES.length);
    const [first, gender] = pick(FIRST);
    const father = pick(FATHERS);
    n++;
    rows.push({
      surname: SURNAMES[si], first_name: first, father_name: father, mother_name: 'Sunita',
      name_mr: `${SURNAMES_MR[si]} ${first} ${father}`, dob: `${d.standard === 'XI' ? y0 - 16 : y0 - 17}-0${1 + (n % 9)}-1${n % 10}`,
      gender, division: d.name, admission_type: i < 25 ? 'cap' : 'in_house',
      // Late CAP admissions: the last three students of XI-SCI-A joined in September.
      admitted_on: d.name === 'XI-SCI-A' && i >= 27 ? `${y0}-09-16` : year.starts_on,
      cap_application_no: `DEMO-${y0}-${String(n).padStart(4, '0')}`,
      apaar_id: rand() < 0.7 ? String(100000000000 + n) : '', pen: rand() < 0.8 ? String(20000000000 + n) : '',
      father_email: `parent${n}@demo.jcas.local`, father_phone: `98${String(10000000 + n).slice(-8)}`,
    });
  }
}
const imported = must(await office.rpc('import_students', { p_rows: rows, p_commit: true }), 'import');
console.log(`Students: ${JSON.stringify(imported.summary)}`);

// Batches, verified guardians, consents and a parent + student login for the first XI-SCI-A student.
const sciStudents = must(await admin.from('student_enrollments').select('student_id, roll_no').eq('division_id', divisions['XI-SCI-A']), 'sci');
for (const s of sciStudents) {
  const b = Number(s.roll_no) <= 15 ? batches.find((x) => x.code === 'P1') : batches.find((x) => x.code === 'P2');
  must(await admin.from('student_enrollments').update({ batch_id: b.id }).eq('student_id', s.student_id), 'batch');
}
const first = sciStudents.find((s) => s.roll_no === '1');
const links = must(await admin.from('guardian_links').select('id, guardian_id, student_id, student:students(id)').in('student_id', sciStudents.slice(0, 10).map((s) => s.student_id)), 'links');
must(await admin.from('guardian_links').update({ status: 'verified', verified_at: new Date().toISOString() }).in('id', links.map((l) => l.id)), 'verify');
const firstLink = links.find((l) => l.student_id === first.student_id);
const parentEmail = must(await admin.from('guardians').select('email').eq('id', firstLink.guardian_id).single(), 'g').email;
const parentUid = await user(parentEmail, 'Demo Parent', ['parent']);
must(await admin.from('guardians').update({ user_id: parentUid, preferred_language: 'mr' }).eq('id', firstLink.guardian_id), 'parent link');
must(await admin.from('consents').insert(['app_account', 'communications', 'apaar'].map((purpose) => ({ student_id: first.student_id, guardian_id: firstLink.guardian_id, purpose, method: 'paper' }))), 'consent');
const studentUid = await user('student1@demo.jcas.local', 'Demo Student', ['student']);
must(await admin.from('students').update({ user_id: studentUid, login_email: 'student1@demo.jcas.local' }).eq('id', first.student_id), 'student login');

// ---------------------------------------------------------------- teaching group + timetable (as Principal)
const principal = await signedIn('principal@demo.jcas.local', PASSWORD);
const physics = must(await admin.from('subjects').select('id').eq('name', 'Physics').single(), 'physics');
const groupId = must(await principal.rpc('create_teaching_group', { p_subject_id: physics.id, p_division_id: divisions['XI-SCI-A'], p_component: 'TH', p_staff_id: staff.physics }), 'group');
const term = must(await admin.from('academic_terms').select('id, seq').eq('academic_year_id', yearId), 'terms').find((t) => (today <= t1End ? t.seq === 1 : t.seq === 2));
const version = must(await admin.from('timetable_versions').insert({
  academic_year_id: yearId, term_id: term.id, standard_id: std.XI, stream_id: stream.SCI, name: 'XI Science · demo', effective_from: today,
}).select('id').single(), 'version');
must(await admin.from('timetable_slots').insert([1, 3, 5].map((weekday) => ({ version_id: version.id, weekday, period_no: 2, starts_at: '08:15', ends_at: '09:00', teaching_group_id: groupId }))), 'slots');
const published = must(await principal.rpc('publish_timetable', { p_version_id: version.id }), 'publish');
console.log(`Timetable: ${published.sessions_created} Physics sessions generated`);

// ---------------------------------------------------------------- three weeks of roll-calls
const markers = {
  'XI-SCI-A': await signedIn('ct.sci@demo.jcas.local', PASSWORD),
  'XI-COM-A': await signedIn('ct.com@demo.jcas.local', PASSWORD),
  'XII-ARTS-A': office,
};
const holidays = new Set([`${y0}-08-15`, `${y0}-09-14`]);
let submitted = 0;
for (let back = 21; back >= 1; back--) {
  const date = addDays(today, -back);
  if (!inTerm(date) || isSunday(date) || holidays.has(date)) continue;
  for (const d of divisionDefs) {
    const roster = must(await markers[d.name].rpc('division_roster_for_marking', { p_division_id: divisions[d.name], p_date: date }), 'roster');
    if (!roster.working_day) continue;
    const records = roster.students.map((s) => {
      const chronic = ['3', '7', '12'].includes(s.roll_no);
      return { student_id: s.student_id, status: s.suggested_status ?? (rand() < (chronic ? 0.45 : 0.06) ? 'A' : rand() < 0.01 ? 'HD' : 'P') };
    });
    const res = must(await markers[d.name].rpc('submit_day_register', {
      p_division_id: divisions[d.name], p_date: date, p_client_submission_id: crypto.randomUUID(), p_base_version: roster.register?.version ?? 0, p_records: records,
    }), `submit ${d.name} ${date}`);
    if (res.result === 'ok') submitted++;
  }
}
console.log(`Roll-calls submitted: ${submitted}`);

const evaluated = must(await principal.rpc('evaluate_eligibility', { p_kind: 'projected' }), 'eligibility');
console.log(`Eligibility evaluated for ${evaluated} students`);

must(await admin.from('college').update({ setup_completed_at: new Date().toISOString() }).eq('id', 1), 'setup complete');

console.log(`
Demo logins (password for all: ${PASSWORD})
  principal@demo.jcas.local   Principal + Admin
  supervisor@demo.jcas.local  Supervisor
  office@demo.jcas.local      Office
  ct.sci@demo.jcas.local      Class teacher XI-SCI-A (web desk + mobile)
  ct.com@demo.jcas.local      Class teacher XI-COM-A
  physics@demo.jcas.local     Physics teacher (mobile)
  ${parentEmail.padEnd(27)} Parent of roll 1, XI-SCI-A (mobile, Marathi)
  student1@demo.jcas.local    Student (mobile)
`);
