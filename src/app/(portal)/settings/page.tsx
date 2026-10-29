import { can, requirePermission } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { asRows } from '@/lib/rows';
import { getCollege } from '@/features/academics/context';
import { getCollegePolicy } from '@/features/eligibility/queries';
import { CollegeForm } from '@/features/academics/forms';
import { saveAppConfig, savePolicy, setUserRole, updateStatusCode } from '@/features/settings/actions';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, StatusPill, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { PERMISSIONS, ROLE_LABELS, ROLES, type Role } from '@/shared/permissions';
import { todayIST } from '@/shared/dates';

export const metadata = { title: 'Settings' };

const SCOPE_SHORT: Record<string, string> = { all: '✓', stream: 'S', class: 'C', assigned: 'A', self: 'self', linked: 'link' };

export default async function SettingsPage() {
  const viewer = await requirePermission(['settings.manage', 'attendance.policy.manage', 'roles.manage']);
  const supabase = await createClient();
  const [college, policy, { data: codes }, { data: grants }, { data: roleRows }, { data: staffUsers }, { data: config }] = await Promise.all([
    getCollege(),
    getCollegePolicy(),
    supabase.from('attendance_status_codes').select('*').order('sort_order'),
    supabase.from('role_permissions').select('role, permission, scope'),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('staff').select('full_name, user_id').not('user_id', 'is', null).order('full_name'),
    supabase.from('app_config').select('key, value'),
  ]);
  const cfg = Object.fromEntries(asRows<{ key: string; value: unknown }>(config).map((c) => [c.key, c.value]));
  const features = (cfg.features ?? {}) as Record<string, boolean>;
  const matrix = new Map<string, string[]>();
  for (const g of asRows<{ role: string; permission: string; scope: string }>(grants)) {
    const k = `${g.role}|${g.permission}`;
    matrix.set(k, [...(matrix.get(k) ?? []), g.scope]);
  }
  const rolesBy = new Map<string, Role[]>();
  for (const r of asRows<{ user_id: string; role: Role }>(roleRows)) rolesBy.set(r.user_id, [...(rolesBy.get(r.user_id) ?? []), r.role]);
  const staffRoles = ROLES.filter((r) => r !== 'student' && r !== 'parent');

  return (
    <>
      <PageHeader title="Settings" description="Changes to roles, permissions and policies are audited and, for Principal/Admin, require two-step verification." />
      <div className="space-y-6">
        {can(viewer, 'settings.manage', 'all') ? (
          <Card>
            <CardHeader title="College profile & letterhead" description="Shown on notices, the muster and certificates." />
            <CardBody><CollegeForm college={college} /></CardBody>
          </Card>
        ) : null}

        {can(viewer, 'attendance.policy.manage', 'all') && policy ? (
          <Card>
            <CardHeader title="Attendance policy (college-wide)" description="Defaults come from the board rules. Confirm leave, OD and sports treatment with the Principal (architecture §24)." />
            <CardBody>
              <ActionForm action={savePolicy} submitLabel="Save policy">
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  <Field label="Minimum %" hint="Board threshold."><Input type="number" step="0.01" name="min_percent" defaultValue={policy.min_percent} /></Field>
                  <Field label="Warning %" hint="Early-warning band."><Input type="number" step="0.01" name="warn_percent" defaultValue={policy.warn_percent} /></Field>
                  <Field label="Eligibility basis">
                    <Select name="eligibility_basis" defaultValue={policy.eligibility_basis}>
                      <option value="working_days">Working days (board rule)</option>
                      <option value="working_days_and_subject">Working days + each subject</option>
                      <option value="per_subject">Each subject</option>
                      <option value="per_subject_component">Each subject, theory & practical</option>
                    </Select>
                  </Field>
                  <Field label="Terms">
                    <Select name="term_rule" defaultValue={policy.term_rule}><option value="annual">Both terms together</option><option value="each_term">Each term separately</option></Select>
                  </Field>
                  <Field label="Day attendance source">
                    <Select name="day_source" defaultValue={policy.day_source}>
                      <option value="roll_call">Class-teacher roll-call</option>
                      <option value="derived">Derived from periods (Phase 04)</option>
                      <option value="biometric">Biometric (Phase 04)</option>
                      <option value="biometric_confirmed_by_roll_call">Biometric, confirmed by roll-call (Phase 04)</option>
                    </Select>
                  </Field>
                  <Field label="Late admissions count from">
                    <Select name="count_from" defaultValue={policy.count_from}><option value="enrollment_start">Their admission date</option><option value="term_start">Term start</option></Select>
                  </Field>
                  <Field label="Unmarked students become"><Select name="default_unmarked_status" defaultValue={policy.default_unmarked_status}><option value="A">Absent</option><option value="P">Present</option></Select></Field>
                  <Field label="Edit window (hours)"><Input type="number" name="edit_window_hours" defaultValue={policy.edit_window_hours} /></Field>
                  <Field label="Lock after (hours)"><Input type="number" name="lock_after_hours" defaultValue={policy.lock_after_hours} /></Field>
                  <Field label="Close month by working day"><Input type="number" name="month_close_working_day" defaultValue={policy.month_close_working_day} /></Field>
                  <Field label="Effective from"><Input type="date" name="effective_from" defaultValue={todayIST()} /></Field>
                </div>
                <div className="flex flex-wrap gap-6 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="leave_requires_guardian_ack" defaultChecked={policy.leave_requires_guardian_ack} /> A student&apos;s own leave needs a guardian&apos;s acknowledgement</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="leave_applies_retroactively" defaultChecked={policy.leave_applies_retroactively} /> Approved leave turns past absences into leave</label>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {can(viewer, 'attendance.policy.manage', 'all') ? (
          <Card>
            <CardHeader title="Status codes" description="Day value counts toward present days. 'Counts in working days' off = excused (not in the denominator)." />
            <Table>
              <THead><tr><TH>Code</TH><TH>Label</TH><TH>Used for</TH><TH>Settings</TH></tr></THead>
              <tbody>
                {asRows<{ code: string; label: string; label_mr: string; color: string; scope: string; day_value: number; counts_in_held: boolean; teacher_can_set: boolean }>(codes).map((c) => (
                  <TR key={c.code}>
                    <TD><StatusPill code={c.code} color={c.color} /></TD>
                    <TD>{c.label}</TD>
                    <TD className="text-sm">{c.scope}</TD>
                    <TD>
                      <ActionForm action={updateStatusCode} extra={{ code: c.code }} submitLabel="Save" className="flex flex-wrap items-end gap-3 space-y-0">
                        <Field label="Marathi" className="w-36"><Input name="label_mr" className="deva h-8" lang="mr" defaultValue={c.label_mr} /></Field>
                        <Field label="Day value" className="w-24"><Input name="day_value" type="number" step="0.5" min={0} max={1} className="h-8" defaultValue={c.day_value} /></Field>
                        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="counts_in_held" defaultChecked={c.counts_in_held} /> Counts in working days</label>
                        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="teacher_can_set" defaultChecked={c.teacher_can_set} /> Teacher can set</label>
                      </ActionForm>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}

        {can(viewer, 'roles.manage', 'all') ? (
          <Card>
            <CardHeader title="Staff roles" description="Teacher is the default. Class Teacher and Stream Coordinator are assignments (Staff page), not roles." />
            <Table>
              <THead><tr><TH>Staff member</TH>{staffRoles.map((r) => <TH key={r} className="text-center">{ROLE_LABELS[r]}</TH>)}</tr></THead>
              <tbody>
                {asRows<{ full_name: string; user_id: string }>(staffUsers).map((s) => {
                  const has = rolesBy.get(s.user_id) ?? [];
                  return (
                    <TR key={s.user_id}>
                      <TD>{s.full_name}</TD>
                      {staffRoles.map((r) => (
                        <TD key={r} className="text-center">
                          <ActionButton action={setUserRole} payload={{ userId: s.user_id, role: r, grant: !has.includes(r) }} label={has.includes(r) ? '✓' : '·'} variant={has.includes(r) ? 'primary' : 'ghost'}
                            confirm={has.includes(r) ? `Remove ${ROLE_LABELS[r]} from ${s.full_name}?` : `Grant ${ROLE_LABELS[r]} to ${s.full_name}?`} />
                        </TD>
                      ))}
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Permission matrix" description="✓ whole college · S own stream · C own class (division) · A assigned groups. Edit grants in the database (role_permissions) until the editor ships." />
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr><th className="px-3 py-2 text-left">Permission</th>{ROLES.map((r) => <th key={r} className="px-2 py-2">{ROLE_LABELS[r]}</th>)}</tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p} className="border-t border-gray-100">
                    <td className="px-3 py-1 font-mono">{p}</td>
                    {ROLES.map((r) => <td key={r} className="px-2 py-1 text-center">{(matrix.get(`${r}|${p}`) ?? []).map((s) => SCOPE_SHORT[s]).join(' ') || <span className="text-gray-300">–</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {can(viewer, 'settings.manage', 'all') ? (
          <Card>
            <CardHeader title="Mobile app" description="Read by the app on launch (public config)." />
            <CardBody>
              <ActionForm action={saveAppConfig} submitLabel="Save app settings">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Minimum app version" hint="Older versions show a blocking update screen."><Input name="min_mobile_version" defaultValue={String(cfg.min_mobile_version ?? '1.0.0')} /></Field>
                  <Field label="Maintenance banner" hint="Leave empty for none."><Input name="maintenance_banner" defaultValue={cfg.maintenance_banner ? String(cfg.maintenance_banner) : ''} /></Field>
                </div>
                <div className="flex flex-wrap gap-6 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="biometric" defaultChecked={features.biometric} /> Biometric hints (needs terminals + Phase 04)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="roster_photos" defaultChecked={features.roster_photos} /> Photos on rosters (needs photo consent)</label>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {!policy ? <Notice tone="danger">No college attendance policy found. Attendance cannot be submitted until one exists.</Notice> : null}
        <p className="text-xs text-gray-500">Edition: <Badge>{String(cfg.edition ?? 'junior_college')}</Badge></p>
      </div>
    </>
  );
}
