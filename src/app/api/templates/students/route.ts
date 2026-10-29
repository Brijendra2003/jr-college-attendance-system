const HEADERS = [
  'surname', 'first_name', 'father_name', 'mother_name', 'name_mr', 'dob', 'gender', 'division', 'roll_no',
  'admission_type', 'admitted_on', 'gr_no', 'cap_application_no', 'ssc_seat_no', 'ssc_board', 'ssc_percent',
  'apaar_id', 'pen', 'saral_id', 'father_email', 'father_phone', 'mother_email', 'mother_phone',
];
const EXAMPLE = [
  'Patil', 'Aarav', 'Sunil', 'Sunita', 'पाटील आरव सुनील', '2010-04-12', 'male', 'XI-SCI-A', '',
  'cap', '2026-07-01', '', 'CAP26-123456', 'M123456', 'MSBSHSE', '88.40',
  '', '', '', 'sunil.patil@example.com', '9800000000', '', '',
];

/** CSV template for student / CAP imports (UTF-8 with BOM so Excel keeps Devanagari). */
export function GET() {
  const csv = `﻿${HEADERS.join(',')}\n${EXAMPLE.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')}\n`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="student-import-template.csv"',
    },
  });
}
