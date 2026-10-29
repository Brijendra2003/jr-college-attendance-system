import { requirePermission } from '@/lib/auth/viewer';
import { getDivisions } from '@/features/academics/context';
import { createStudent } from '@/features/people/actions';
import { ActionForm } from '@/components/action-form';
import { Card, CardBody, Field, Input, PageHeader, Select } from '@/components/ui/primitives';
import { todayIST } from '@/shared/dates';

export const metadata = { title: 'Add student' };

export default async function NewStudentPage() {
  await requirePermission('admissions.import');
  const divisions = await getDivisions();
  return (
    <>
      <PageHeader
        title="Add a student"
        description="For in-house, management, minority and transfer admissions. CAP allotment lists are faster through Admissions import. Names as printed on the SSC mark sheet, surname first."
      />
      <Card>
        <CardBody>
          <ActionForm action={createStudent} submitLabel="Create student" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Surname"><Input name="surname" required /></Field>
              <Field label="First name"><Input name="first_name" required /></Field>
              <Field label="Father's name"><Input name="father_name" /></Field>
              <Field label="Mother's name"><Input name="mother_name" /></Field>
              <Field label="Full name in Marathi" className="sm:col-span-2"><Input name="name_mr" className="deva" lang="mr" /></Field>
              <Field label="Date of birth"><Input type="date" name="dob" /></Field>
              <Field label="Gender">
                <Select name="gender" defaultValue=""><option value="">–</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>
              </Field>
              <Field label="Division">
                <Select name="division_id" required>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
              </Field>
              <Field label="Roll no." hint="Blank = next number in the division."><Input name="roll_no" /></Field>
              <Field label="Admission type">
                <Select name="admission_type" defaultValue="in_house">
                  {['cap', 'in_house', 'management', 'minority', 'transfer', 're_admission'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </Select>
              </Field>
              <Field label="Admitted on" hint="Attendance counts from this date."><Input type="date" name="admitted_on" defaultValue={todayIST()} required /></Field>
              <Field label="GR No." hint="Blank = next in the register."><Input name="gr_no" /></Field>
              <Field label="CAP application no."><Input name="cap_application_no" /></Field>
              <Field label="SSC seat no."><Input name="ssc_seat_no" /></Field>
              <Field label="APAAR ID"><Input name="apaar_id" inputMode="numeric" /></Field>
              <Field label="PEN"><Input name="pen" inputMode="numeric" /></Field>
              <Field label="Saral ID"><Input name="saral_id" inputMode="numeric" /></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
