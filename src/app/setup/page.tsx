import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import { can, getViewer, needsMfa } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { getCollege } from '@/features/academics/context';
import { applyTemplate, completeSetup } from '@/features/academics/actions';
import { CollegeForm, DivisionsForm, ShiftForm, YearForm } from '@/features/academics/forms';
import { ActionButton } from '@/components/action-button';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui/primitives';

export const metadata = { title: 'Setup' };

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Set up your junior college</h1>
      <p className="mt-1 text-sm text-gray-600">
        Work through the steps in order. You can leave and come back: everything is saved as you go.
      </p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-xl bg-white" />}>
        <Wizard />
      </Suspense>
    </main>
  );
}

async function Wizard() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/setup');
  if (needsMfa(viewer) && process.env.JR_REQUIRE_MFA !== 'false') redirect('/mfa');
  const college = await getCollege();
  if (college?.setup_completed_at) redirect('/dashboard');
  if (!can(viewer, 'settings.manage', 'all')) {
    return <Notice tone="warn">The college is not set up yet. Please ask the Admin to complete setup.</Notice>;
  }

  const supabase = await createClient();
  const [{ count: subjects }, { data: years }, { data: shifts }, { data: standards }, { data: streams }] = await Promise.all([
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
    supabase.from('academic_years').select('id, label, status').order('starts_on', { ascending: false }),
    supabase.from('shifts').select('id, name').order('starts_at'),
    supabase.from('standards').select('id, code, label').order('level'),
    supabase.from('streams').select('id, code, name').eq('is_active', true).order('sort_order'),
  ]);
  const active = (years ?? []).find((y: { status: string }) => y.status === 'active') as { id: string; label: string } | undefined;
  const { count: divisions } = active
    ? await supabase.from('divisions').select('id', { count: 'exact', head: true }).eq('academic_year_id', active.id)
    : { count: 0 };

  const steps = [
    { done: Boolean(college), title: '1. College profile', body: <CollegeForm college={college} /> },
    {
      done: (subjects ?? 0) > 0,
      title: '2. MSBSHSE Junior College XI–XII template',
      body: (
        <div className="space-y-3 text-sm text-gray-600">
          <p>Adds the HSC subjects (languages, EVS, HPE, Science, Commerce, Arts and bifocal subjects), theory/practical components and the second-language baskets. Standards, streams, status codes and the 75% policy are already seeded.</p>
          <ActionButton action={applyTemplate} payload={{}} label={subjects ? 'Re-apply (adds anything missing)' : 'Apply template'} variant="primary" size="md" />
        </div>
      ),
    },
    { done: Boolean(active), title: '3. Academic year and terms', body: active ? <p className="text-sm text-gray-600">Active year: <strong>{active.label}</strong>. Add more in Academics → Years later.</p> : <YearForm /> },
    {
      done: (shifts ?? []).length > 0,
      title: '4. Shifts',
      body: (
        <div className="space-y-3">
          {(shifts ?? []).length ? <p className="text-sm text-gray-600">Shifts: {(shifts ?? []).map((s: { name: string }) => s.name).join(', ')}</p> : null}
          <ShiftForm />
        </div>
      ),
    },
    {
      done: (divisions ?? 0) > 0,
      title: '5. Divisions',
      body: active ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{divisions ?? 0} division(s) in {active.label}. Create them per standard × stream × medium. Practical batches can be added later in Academics → Structure.</p>
          <DivisionsForm yearId={active.id} standards={standards ?? []} streams={streams ?? []} shifts={shifts ?? []} />
        </div>
      ) : <p className="text-sm text-gray-500">Create the academic year first.</p>,
    },
    {
      done: true,
      title: '6. Attendance policy',
      body: <p className="text-sm text-gray-600">The board defaults are in place: 75% of working days across both terms, warning at 80%, roll-call by the class teacher, late admissions counted from their admission date, edit window 12 h, lock after 48 h. Adjust them in Settings after setup.</p>,
    },
  ];

  return (
    <div className="mt-8 space-y-5">
      {steps.map((s) => (
        <Card key={s.title}>
          <CardHeader title={<span className="flex items-center gap-2">{s.done ? <CheckCircle2 className="size-5 text-green-600" /> : <Circle className="size-5 text-gray-300" />}{s.title}</span>} />
          <CardBody>{s.body}</CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="7. Finish" description="Checks the essentials and opens the portal." />
        <CardBody><ActionButton action={completeSetup} payload={{}} label="Complete setup" variant="primary" size="md" /></CardBody>
      </Card>
    </div>
  );
}
