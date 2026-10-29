// Zod schemas shared by web Server Actions and the mobile app (React Hook Form).
// SHARED: depends only on zod.
import { z } from 'zod';
import { DAY_STATUS_CODES, PERIOD_STATUS_CODES } from '../attendance';

const isoDate = z.iso.date();
const uuid = z.uuid();
const text = (max = 200) => z.string().trim().max(max);
const required = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max = 200) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

// ---------------------------------------------------------------- auth
/** Sign in with an email, or with a username for accounts issued without one (e.g. the Principal). */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your email or username')
    .max(254)
    .refine((v) => (v.includes('@') ? z.email().safeParse(v).success : /^[A-Za-z0-9._-]{3,40}$/.test(v)), 'Enter a valid email or username'),
  password: z.string().min(1, 'Enter your password'),
});

export const resetRequestSchema = z.object({ email: z.email('Enter a valid email') });

export const newPasswordSchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

// ---------------------------------------------------------------- attendance
export const dayRecordSchema = z.object({
  student_id: uuid,
  status: z.enum(DAY_STATUS_CODES),
});

export const submitDayRegisterSchema = z.object({
  divisionId: uuid,
  date: isoDate,
  clientSubmissionId: uuid,
  baseVersion: z.number().int().min(0),
  records: z.array(dayRecordSchema).max(400),
});

export const periodRecordSchema = z.object({
  student_id: uuid,
  status: z.enum(PERIOD_STATUS_CODES),
});

export const submitPeriodSchema = z.object({
  sessionId: uuid,
  clientSubmissionId: uuid,
  baseVersion: z.number().int().min(0),
  records: z.array(periodRecordSchema).max(400),
});

export const correctionRequestSchema = z.object({
  kind: z.enum(['day', 'period']),
  registerId: uuid,
  records: z.array(z.object({ student_id: uuid, status: z.string().min(1).max(4) })).min(1),
  reason: required(500),
});

export const decideCorrectionSchema = z.object({
  requestId: uuid,
  approve: z.boolean(),
  note: optionalText(500),
});

export const reopenRegisterSchema = z.object({
  kind: z.enum(['day', 'period']),
  registerId: uuid,
  hours: z.coerce.number().int().min(1).max(72),
  reason: required(500),
});

export const closeMonthSchema = z.object({ divisionId: uuid, month: isoDate });
export const signMusterSchema = z.object({ divisionId: uuid, month: isoDate, as: z.enum(['class_teacher', 'principal']) });

export const declareHolidaySchema = z.object({
  date: isoDate,
  title: required(120),
  kind: z.enum(['emergency_holiday', 'college_holiday', 'public_holiday']).default('emergency_holiday'),
  divisionIds: z.array(uuid).optional(),
});

// ---------------------------------------------------------------- structure & calendar
export const collegeSchema = z.object({
  name: required(200),
  name_mr: optionalText(200),
  address: optionalText(500),
  district: optionalText(80),
  taluka: optionalText(80),
  divisional_board: z.enum(['pune', 'mumbai', 'nagpur', 'chh_sambhajinagar', 'kolhapur', 'amravati', 'nashik', 'latur', 'konkan']),
  board_index_no: optionalText(30),
  udise_code: optionalText(20),
  management_type: z.enum(['government', 'aided', 'partially_aided', 'unaided', 'self_financed']),
  is_minority: z.coerce.boolean().default(false),
  mediums: z.array(z.enum(['en', 'mr', 'hi', 'ur'])).min(1),
});

export const academicYearSchema = z
  .object({
    label: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27'),
    starts_on: isoDate,
    ends_on: isoDate,
    term1_ends_on: isoDate,
    term2_starts_on: isoDate,
    activate: z.coerce.boolean().default(false),
  })
  .refine((v) => v.starts_on < v.term1_ends_on && v.term1_ends_on < v.term2_starts_on && v.term2_starts_on < v.ends_on, {
    message: 'Dates must run: year start < first term end < second term start < year end',
    path: ['ends_on'],
  });

export const divisionSchema = z.object({
  academic_year_id: uuid,
  standard_id: uuid,
  stream_id: uuid,
  medium_code: z.enum(['en', 'mr', 'hi', 'ur']),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, 'Use a short code such as A'),
  capacity: z.coerce.number().int().min(1).max(250).default(120),
  shift_id: uuid.optional().nullable(),
});

export const batchSchema = z.object({
  division_id: uuid,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/),
  name: required(40),
});

export const calendarEventSchema = z
  .object({
    kind: z.enum(['public_holiday', 'college_holiday', 'emergency_holiday', 'vacation', 'exam_block', 'event', 'working_override']),
    title: required(120),
    title_mr: optionalText(120),
    starts_on: isoDate,
    ends_on: isoDate,
  })
  .refine((v) => v.ends_on >= v.starts_on, { message: 'End date is before start date', path: ['ends_on'] });

export const shiftSchema = z.object({
  name: required(40),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
});

// ---------------------------------------------------------------- people
export const studentSchema = z.object({
  gr_no: optionalText(20),
  surname: required(80),
  first_name: required(80),
  father_name: optionalText(80),
  mother_name: optionalText(80),
  name_mr: optionalText(200),
  dob: isoDate.optional().or(z.literal('')).transform((v) => v || null),
  gender: z.enum(['male', 'female', 'other']).optional().or(z.literal('')).transform((v) => v || null),
  admission_type: z.enum(['cap', 'in_house', 'management', 'minority', 'transfer', 're_admission']),
  admitted_on: isoDate,
  cap_application_no: optionalText(40),
  saral_id: optionalText(30),
  pen: optionalText(20),
  apaar_id: optionalText(20),
  ssc_seat_no: optionalText(20),
  division_id: uuid,
  roll_no: optionalText(10),
});

export const guardianSchema = z.object({
  student_id: uuid,
  full_name: required(120),
  relation: z.enum(['father', 'mother', 'guardian']),
  email: z.email().optional().or(z.literal('')).transform((v) => v?.toLowerCase() || null),
  phone: optionalText(20),
  preferred_language: z.enum(['en', 'mr', 'hi']).default('mr'),
});

export const staffSchema = z.object({
  employee_id: required(20),
  full_name: required(120),
  designation: z.enum(['principal', 'vice_principal', 'supervisor', 'senior_lecturer', 'lecturer', 'lab_assistant', 'librarian', 'clerk', 'peon', 'other']),
  employment_type: z.enum(['full_time', 'clock_hour', 'visiting']),
  email: z.email().optional().or(z.literal('')).transform((v) => v?.toLowerCase() || null),
  phone: optionalText(20),
});

export const issueLoginSchema = z.object({
  kind: z.enum(['guardian', 'staff', 'student']),
  id: uuid,
  roles: z.array(z.enum(['principal', 'supervisor', 'admin', 'office', 'exam_incharge', 'stream_coordinator', 'teacher'])).optional(),
});

export const classTeacherSchema = z.object({ division_id: uuid, staff_id: uuid, from: isoDate });

export const importRowSchema = z.record(z.string(), z.string().optional());

// ---------------------------------------------------------------- eligibility, leave, notices
export const issueNoticeSchema = z.object({
  studentId: uuid,
  level: z.enum(['warning', 'second', 'final']),
  language: z.enum(['en', 'mr', 'hi']).default('mr'),
  channel: z.enum(['app', 'print', 'both']).default('both'),
});

export const condonationSchema = z.object({
  student_id: uuid,
  ground: z.enum(['state_national_sports', 'medical', 'other']),
  details: required(1000),
});

export const decideLeaveSchema = z.object({
  id: uuid,
  decision: z.enum(['approved', 'rejected', 'needs_info']),
  note: optionalText(500),
});

export const applyLeaveSchema = z
  .object({
    studentId: uuid.optional(),
    leaveType: z.string().min(1),
    span: z.enum(['full_day', 'half_day', 'periods']).default('full_day'),
    from: isoDate,
    to: isoDate,
    reason: required(500),
  })
  .refine((v) => v.to >= v.from, { message: 'End date is before start date', path: ['to'] });

export const announcementSchema = z.object({
  title: required(160),
  body: required(4000),
  title_mr: optionalText(160),
  body_mr: optionalText(4000),
  priority: z.enum(['normal', 'high']).default('normal'),
  audience_roles: z.array(z.enum(['teacher', 'student', 'parent'])).min(1, 'Choose at least one audience'),
  stream_ids: z.array(uuid).default([]),
  division_ids: z.array(uuid).default([]),
});

export const policySchema = z.object({
  min_percent: z.coerce.number().min(1).max(100),
  warn_percent: z.coerce.number().min(1).max(100),
  eligibility_basis: z.enum(['working_days', 'per_subject', 'per_subject_component', 'working_days_and_subject']),
  term_rule: z.enum(['annual', 'each_term']),
  day_source: z.enum(['roll_call', 'derived', 'biometric', 'biometric_confirmed_by_roll_call']),
  count_from: z.enum(['enrollment_start', 'term_start']),
  default_unmarked_status: z.enum(['A', 'P']),
  edit_window_hours: z.coerce.number().int().min(0).max(168),
  lock_after_hours: z.coerce.number().int().min(1).max(720),
  month_close_working_day: z.coerce.number().int().min(1).max(15),
  leave_requires_guardian_ack: z.coerce.boolean(),
  leave_applies_retroactively: z.coerce.boolean(),
  effective_from: isoDate,
}).refine((v) => v.warn_percent >= v.min_percent, { message: 'Warning band must be at or above the minimum', path: ['warn_percent'] });

export const timetableVersionSchema = z.object({
  term_id: uuid,
  standard_id: uuid,
  stream_id: uuid,
  name: required(80),
  effective_from: isoDate,
});

export const timetableSlotSchema = z.object({
  version_id: uuid,
  weekday: z.coerce.number().int().min(1).max(6),
  period_no: z.coerce.number().int().min(1).max(12),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
  teaching_group_id: uuid,
  staff_id: uuid.optional().or(z.literal('')).transform((v) => v || null),
  session_type: z.enum(['theory', 'practical', 'oral', 'pe']).default('theory'),
});

export const teachingGroupSchema = z.object({
  subject_id: uuid,
  division_id: uuid,
  component: z.enum(['TH', 'PR', 'OR']),
  batch_id: uuid.optional().or(z.literal('')).transform((v) => v || null),
  staff_id: uuid.optional().or(z.literal('')).transform((v) => v || null),
});

export { text };
