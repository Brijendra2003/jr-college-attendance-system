import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { rangeContains } from '@/lib/ranges';
import { getDivisions } from '@/features/academics/context';
import { assignClassTeacher, assignCoordinator, createStaff, setAccountActive } from '@/features/people/actions';
import { IssueLoginButton } from '@/features/people/issue-login-button';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, StateBadge, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { ROLE_LABELS, type Role } from '@/shared/permissions';
import { todayIST } from '@/shared/dates';

export const metadata = { title: 'Staff' };

interface StaffRow {
  id: string; employee_id: string; full_name: string; designation: string; employment_type: string; email: string | null; phone: string | null; status: string; user_id: string | null;
  class_teacher_assignments: { valid_during: string; division: { name: string } }[];
  stream_coordinators: { valid_during: string; stream: { name: string } }[];
}

export default async function StaffPage() {
  const viewer = await requirePermission('staff.view');
  const supabase = await createClient();
  const today = todayIST();
  const [{ data }, divisions, { data: streams }, { data: roleRows }, { data: profiles }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, employee_id, full_name, designation, employment_type, email, phone, status, user_id, class_teacher_assignments(valid_during, division:divisions(name)), stream_coordinators(valid_during, stream:streams(name))')
      .order('full_name'),
    getDivisions(),
    supabase.from('streams').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('profiles').select('id, is_active'),
  ]);
  const staff = asRows<StaffRow>(data);
  const rolesBy = new Map<string, Role[]>();
  for (const r of asRows<{ user_id: string; role: Role }>(roleRows)) rolesBy.set(r.user_id, [...(rolesBy.get(r.user_id) ?? []), r.role]);
  const activeBy = new Map(asRows<{ id: string; is_active: boolean }>(profiles).map((p) => [p.id, p.is_active]));
  const manage = can(viewer, 'staff.manage', 'all');
  const assign = can(viewer, 'assignments.manage', 'all');
  const canIssue = can(viewer, 'accounts.issue', 'all');

  return (
    <>
      <PageHeader title="Staff" description="Lecturers, supervisors and office staff. Class teacher and Stream Coordinator are effective-dated assignments, not separate logins." />

      <Card>
        <Table>
          <THead><tr><TH>Name</TH><TH>Designation</TH><TH>Assignments</TH><TH>Roles</TH><TH>Login</TH></tr></THead>
          <tbody>
            {staff.map((s) => {
              const ct = s.class_teacher_assignments.filter((a) => rangeContains(a.valid_during, today));
              const sc = s.stream_coordinators.filter((a) => rangeContains(a.valid_during, today));
              const roles = s.user_id ? rolesBy.get(s.user_id) ?? [] : [];
              const active = s.user_id ? activeBy.get(s.user_id) ?? true : null;
              return (
                <TR key={s.id}>
                  <TD>
                    <div className="font-medium">{s.full_name}</div>
                    <div className="text-xs text-gray-500">{s.employee_id} · {s.email ?? 'no email'}</div>
                  </TD>
                  <TD className="capitalize">{s.designation.replace(/_/g, ' ')} <span className="text-xs text-gray-500">({s.employment_type.replace('_', ' ')})</span></TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {ct.map((a) => <Badge key={a.division.name} tone="blue">Class teacher {a.division.name}</Badge>)}
                      {sc.map((a) => <Badge key={a.stream.name} tone="violet">Coordinator {a.stream.name}</Badge>)}
                    </div>
                  </TD>
                  <TD className="text-sm">{roles.map((r) => ROLE_LABELS[r]).join(', ') || '–'}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-2">
                      {active === false ? <StateBadge state="revoked" /> : null}
                      {canIssue ? <IssueLoginButton kind="staff" id={s.id} name={s.full_name} hasLogin={Boolean(s.user_id)} roles={roles.filter((r) => r !== 'student' && r !== 'parent') as never} /> : null}
                      {canIssue && s.user_id && s.user_id !== viewer.userId ? (
                        <ActionButton action={setAccountActive} payload={{ userId: s.user_id, active: !active }} label={active ? 'Deactivate' : 'Re-activate'} variant="ghost"
                          confirm={active ? `Deactivate ${s.full_name}? They are signed out everywhere and cannot sign in.` : undefined} />
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {assign ? (
          <Card>
            <CardHeader title="Assign class teacher" description="One class teacher per division at a time. The previous assignment ends the day before." />
            <CardBody>
              <ActionForm action={assignClassTeacher} submitLabel="Assign">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Division"><Select name="division_id">{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                  <Field label="Teacher"><Select name="staff_id">{staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
                  <Field label="From"><Input type="date" name="from" defaultValue={today} required /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
        {assign ? (
          <Card>
            <CardHeader title="Assign stream coordinator" description="Gives stream-scoped oversight on the web and in the app." />
            <CardBody>
              <ActionForm action={assignCoordinator} submitLabel="Assign">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Stream"><Select name="stream_id">{(streams ?? []).map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                  <Field label="Staff member"><Select name="staff_id">{staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
                  <Field label="From"><Input type="date" name="from" defaultValue={today} required /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
        {manage ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Add staff member" description="Logins default to the Teacher role; the Admin or Principal can grant web roles when issuing the login from the user's roles (edit roles in Settings → Roles)." />
            <CardBody>
              <ActionForm action={createStaff} submitLabel="Add staff" resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Employee ID"><Input name="employee_id" required /></Field>
                  <Field label="Full name"><Input name="full_name" required /></Field>
                  <Field label="Email" hint="Login username."><Input type="email" name="email" /></Field>
                  <Field label="Phone"><Input name="phone" /></Field>
                  <Field label="Designation">
                    <Select name="designation" defaultValue="lecturer">
                      {['lecturer', 'senior_lecturer', 'supervisor', 'vice_principal', 'principal', 'lab_assistant', 'librarian', 'clerk', 'peon', 'other'].map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
                    </Select>
                  </Field>
                  <Field label="Employment">
                    <Select name="employment_type"><option value="full_time">Full time</option><option value="clock_hour">Clock hour</option><option value="visiting">Visiting</option></Select>
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
