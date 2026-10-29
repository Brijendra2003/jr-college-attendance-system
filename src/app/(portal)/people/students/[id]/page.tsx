import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requirePermission } from '@/lib/auth/viewer';
import { rangeContains, rangeEnd, rangeStart } from '@/lib/ranges';
import { getDivisions } from '@/features/academics/context';
import { getStudent360 } from '@/features/people/queries';
import { addGuardian, endEnrollment, recordPaperConsent, setGuardianLink, transferStudent, updateStudentIds, withdrawConsent } from '@/features/people/actions';
import { IssueLoginButton } from '@/features/people/issue-login-button';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, EligibilityChip, Field, Input, PageHeader, Percent, Select, StateBadge, StatusPill, Table, TD, TH, THead, TR } from '@/components/ui/primitives';
import { formatDate, todayIST } from '@/shared/dates';

export const metadata = { title: 'Student' };

export default async function Student360({ params }: PageProps<'/people/students/[id]'>) {
  const viewer = await requirePermission('students.view');
  const { id } = await params;
  const data = await getStudent360(id);
  if (!data) notFound();
  const { student: s, enrollments, guardians, consents, daySummaries, subjectSummaries, eligibility, notices, leave, history } = data;
  const today = todayIST();
  const current = enrollments.find((e) => rangeContains(e.valid_during, today));
  const manage = can(viewer, 'students.manage', 'all');
  const showIds = can(viewer, 'students.ids.view', 'all');
  const divisions = manage ? await getDivisions() : [];

  const terms = [...daySummaries].sort((a, b) => a.term.seq - b.term.seq);
  const yearWorking = terms.reduce((n, t) => n + t.working_days, 0);
  const yearPresent = terms.reduce((n, t) => n + Number(t.present_value), 0);

  return (
    <>
      <PageHeader
        title={s.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.name_mr ? <span className="deva" lang="mr">{s.name_mr}</span> : null}
            <span>GR No. {s.gr_no}</span>
            {current ? <span>· {current.division.name} · Roll {current.roll_no ?? '–'}{current.batch ? ` · Batch ${current.batch.code}` : ''}</span> : null}
            <StateBadge state={s.status} />
          </span>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        {terms.map((t) => (
          <Card key={t.term_id} className="px-5 py-4">
            <div className="text-xs font-medium uppercase text-gray-500">{t.term.name}</div>
            <div className="mt-1 text-2xl font-semibold"><Percent value={t.percent} /></div>
            <div className="text-xs text-gray-500">{Number(t.present_value)} present of {t.working_days} working days</div>
          </Card>
        ))}
        <Card className="px-5 py-4">
          <div className="text-xs font-medium uppercase text-gray-500">Year so far</div>
          <div className="mt-1 text-2xl font-semibold"><Percent value={yearWorking ? (yearPresent * 100) / yearWorking : null} /></div>
          <div className="mt-1"><EligibilityChip status={eligibility[0]?.status} />{eligibility[0]?.days_needed ? <span className="ml-2 text-xs text-gray-500">{eligibility[0].days_needed} days needed</span> : null}</div>
        </Card>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Subject attendance" description="Theory and practical, from period registers." />
            <Table>
              <THead><tr><TH>Subject</TH><TH>Component</TH><TH className="text-right">Held</TH><TH className="text-right">Attended</TH><TH className="text-right">%</TH></tr></THead>
              <tbody>
                {subjectSummaries.map((r) => (
                  <TR key={`${r.offering_id}${r.component}`}>
                    <TD>{r.offering.subject.name}</TD><TD>{r.component}</TD>
                    <TD className="text-right tabular-nums">{Number(r.held)}</TD><TD className="text-right tabular-nums">{Number(r.attended)}</TD>
                    <TD className="text-right"><Percent value={r.percent} /></TD>
                  </TR>
                ))}
                {subjectSummaries.length === 0 ? <TR><TD colSpan={5} className="text-gray-500">No period attendance yet.</TD></TR> : null}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Recent days" description="Last 60 day-register entries." />
            <CardBody className="flex flex-wrap gap-1.5">
              {history.map((h) => (
                <span key={h.id} className="flex flex-col items-center text-[10px] text-gray-500" title={`${formatDate(h.att_date)} · ${h.source}`}>
                  <StatusPill code={h.status_code} />
                  {h.att_date.slice(8)}/{h.att_date.slice(5, 7)}
                </span>
              ))}
              {history.length === 0 ? <span className="text-sm text-gray-500">No records yet.</span> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Enrollment history" description="Effective-dated: transfers close one row and open another." />
            <Table>
              <THead><tr><TH>Year</TH><TH>Division</TH><TH>Roll</TH><TH>From</TH><TH>To</TH><TH>Note</TH></tr></THead>
              <tbody>
                {enrollments.map((e) => (
                  <TR key={e.id}>
                    <TD>{e.academic_year.label}</TD><TD>{e.division.name}</TD><TD>{e.roll_no ?? '–'}</TD>
                    <TD>{formatDate(rangeStart(e.valid_during))}</TD><TD>{rangeEnd(e.valid_during) ? formatDate(rangeEnd(e.valid_during)) : 'open'}</TD>
                    <TD className="text-gray-500">{e.reason ?? ''}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Defaulter notices and leave" />
            <CardBody className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Notices</h3>
                <ul className="space-y-1 text-sm">
                  {notices.map((n) => (
                    <li key={n.id}>
                      <Link className="text-brand-700 hover:underline" href={`/eligibility/notices/${n.id}`}>{n.level} · {formatDate(n.issued_at)}</Link>{' '}
                      {n.acknowledged_at ? <Badge tone="green">acknowledged</Badge> : <Badge tone="amber">not acknowledged</Badge>}
                    </li>
                  ))}
                  {notices.length === 0 ? <li className="text-gray-500">None</li> : null}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Leave</h3>
                <ul className="space-y-1 text-sm">
                  {leave.map((l) => (
                    <li key={l.id}>{formatDate(l.from_date)}–{formatDate(l.to_date)} · {l.leave_type} <StateBadge state={l.status} /></li>
                  ))}
                  {leave.length === 0 ? <li className="text-gray-500">None</li> : null}
                </ul>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Guardians" description="Links stay pending until verified against the admission form." />
            <CardBody className="space-y-3">
              {guardians.map((g) => (
                <div key={g.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{g.guardian.full_name}</span>
                    <StateBadge state={g.status} />
                  </div>
                  <div className="text-gray-500 capitalize">{g.guardian.relation} · {g.guardian.email ?? 'no email'}{g.guardian.phone ? ` · ${g.guardian.phone}` : ''}</div>
                  {can(viewer, 'guardians.manage', 'all') ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {g.status !== 'verified' ? <ActionButton action={setGuardianLink} payload={{ linkId: g.id, status: 'verified' }} label="Verify" /> : null}
                      {g.status !== 'revoked' ? <ActionButton action={setGuardianLink} payload={{ linkId: g.id, status: 'revoked' }} label="Revoke" variant="ghost" confirm="Revoke this guardian's access to the student?" /> : null}
                      {g.status === 'verified' && can(viewer, 'accounts.issue', 'all') ? (
                        <IssueLoginButton kind="guardian" id={g.guardian.id} name={g.guardian.full_name} hasLogin={Boolean(g.guardian.user_id)} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {can(viewer, 'guardians.manage', 'all') ? (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-brand-700">Add guardian</summary>
                  <div className="mt-3">
                    <ActionForm action={addGuardian} extra={{ student_id: s.id }} submitLabel="Add guardian" resetOnSuccess>
                      <Field label="Full name"><Input name="full_name" required /></Field>
                      <Field label="Relation"><Select name="relation"><option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option></Select></Field>
                      <Field label="Email" hint="Becomes the app username."><Input type="email" name="email" /></Field>
                      <Field label="Phone (contact only)"><Input name="phone" /></Field>
                      <Field label="Language"><Select name="preferred_language" defaultValue="mr"><option value="mr">Marathi</option><option value="en">English</option><option value="hi">Hindi</option></Select></Field>
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Consents" description="Student accounts, photos, biometric and APAAR need guardian consent (DPDP Act)." />
            <CardBody className="space-y-2 text-sm">
              {consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="capitalize">{c.purpose.replace('_', ' ')} <span className="text-gray-500">· {c.method} · {formatDate(c.granted_at)}</span></span>
                  {c.withdrawn_at ? <Badge tone="red">withdrawn</Badge> : can(viewer, 'consents.manage', 'all') ? <ActionButton action={withdrawConsent} payload={{ id: c.id }} label="Withdraw" variant="ghost" confirm="Record that this consent was withdrawn?" /> : <Badge tone="green">active</Badge>}
                </div>
              ))}
              {can(viewer, 'consents.manage', 'all') ? (
                <ActionForm action={recordPaperConsent} extra={{ studentId: s.id }} submitLabel="Record paper consent">
                  <div className="flex flex-wrap gap-3">
                    {['app_account', 'photos', 'communications', 'apaar', 'biometric'].map((p) => (
                      <label key={p} className="flex items-center gap-1.5"><input type="checkbox" name="purposes[]" value={p} /> {p.replace('_', ' ')}</label>
                    ))}
                  </div>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>

          {showIds ? (
            <Card>
              <CardHeader title="Identifiers" />
              <CardBody>
                {manage ? (
                  <ActionForm action={updateStudentIds} extra={{ id: s.id }} submitLabel="Save">
                    <Field label="Name in Marathi"><Input name="name_mr" className="deva" lang="mr" defaultValue={s.name_mr ?? ''} /></Field>
                    <Field label="APAAR ID"><Input name="apaar_id" defaultValue={s.apaar_id ?? ''} /></Field>
                    <Field label="PEN"><Input name="pen" defaultValue={s.pen ?? ''} /></Field>
                    <Field label="Saral ID"><Input name="saral_id" defaultValue={s.saral_id ?? ''} /></Field>
                    <Field label="App login email" hint="Issued by the office."><Input type="email" name="login_email" defaultValue={s.login_email ?? ''} /></Field>
                  </ActionForm>
                ) : (
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-gray-500">APAAR</dt><dd>{s.apaar_id ?? '–'}</dd>
                    <dt className="text-gray-500">PEN</dt><dd>{s.pen ?? '–'}</dd>
                    <dt className="text-gray-500">Saral ID</dt><dd>{s.saral_id ?? '–'}</dd>
                    <dt className="text-gray-500">CAP no.</dt><dd>{s.cap_application_no ?? '–'}</dd>
                  </dl>
                )}
                {can(viewer, 'accounts.issue', 'all') ? (
                  <div className="mt-3"><IssueLoginButton kind="student" id={s.id} name={s.full_name} hasLogin={Boolean(s.user_id)} /></div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {manage && current ? (
            <Card>
              <CardHeader title="Record changes" />
              <CardBody className="space-y-5">
                <ActionForm action={transferStudent} extra={{ studentId: s.id }} submitLabel="Transfer division">
                  <Field label="New division">
                    <Select name="divisionId">{divisions.filter((d) => d.id !== current.division.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                  </Field>
                  <Field label="From"><Input type="date" name="on" defaultValue={today} required /></Field>
                  <Field label="Reason"><Input name="reason" required /></Field>
                </ActionForm>
                <hr className="border-gray-100" />
                <ActionForm action={endEnrollment} extra={{ studentId: s.id }} submitLabel="Close enrollment">
                  <Field label="Outcome">
                    <Select name="status">
                      <option value="left">Left (LC issued)</option>
                      <option value="admission_cancelled">Admission cancelled</option>
                      <option value="transferred">Transferred to another college</option>
                      <option value="detained">Detained</option>
                      <option value="passed_out">Passed out</option>
                    </Select>
                  </Field>
                  <Field label="Last attended on"><Input type="date" name="on" defaultValue={today} required /></Field>
                  <Field label="Reason"><Input name="reason" required /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
