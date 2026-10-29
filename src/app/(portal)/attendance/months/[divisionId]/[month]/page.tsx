import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/viewer';
import { getCollege, getYearContext } from '@/features/academics/context';
import { getMuster } from '@/features/attendance/queries';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { formatDate, formatMonth, isISODate } from '@/shared/dates';
import { percent } from '@/shared/attendance';
import { statusColors } from '@/shared/tokens';

export const metadata = { title: 'Monthly muster' };

/** Monthly muster (हजेरी पत्रक): roll no × date grid, A4 landscape when printed. */
export default async function MusterPage({ params }: PageProps<'/attendance/months/[divisionId]/[month]'>) {
  await requirePermission(['month.close', 'reports.view']);
  const { divisionId, month } = await params;
  if (!isISODate(month)) notFound();
  const [{ year }, college] = await Promise.all([getYearContext(), getCollege()]);
  if (!year) notFound();
  const muster = await getMuster(divisionId, month, year.id);
  if (!muster) notFound();
  const working = muster.days.filter((d) => d.working).length;

  return (
    <div className="bg-white p-4 text-[11px] leading-tight print:p-0">
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <LinkButton href={`/attendance/months?month=${muster.month}`} size="sm">← Back</LinkButton>
        <PrintButton />
        <LinkButton href={`/api/reports/muster?division=${divisionId}&month=${muster.month}`} size="sm">Download Excel</LinkButton>
      </div>

      <header className="mb-3 text-center">
        <div className="text-base font-semibold">{college?.name}</div>
        {college?.name_mr ? <div className="deva text-sm" lang="mr">{college.name_mr}</div> : null}
        <div className="mt-1 text-sm font-semibold">
          <span className="deva" lang="mr">हजेरी पत्रक</span> / Monthly attendance muster · {formatMonth(muster.month)}
        </div>
        <div>
          Std {muster.division.standard} · {muster.division.stream} · Division {muster.division.name} · Working days this month: {working}
          {college?.board_index_no ? ` · Index No. ${college.board_index_no}` : ''}
        </div>
        {muster.monthRow?.revised ? <Badge tone="amber" className="mt-1">Revised after close</Badge> : null}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-1">Roll</th>
              <th className="border border-gray-400 px-1 text-left">Name</th>
              {muster.days.map((d) => (
                <th key={d.date} className={`border border-gray-400 px-0.5 ${d.working ? '' : 'bg-gray-200 text-gray-400'}`}>{Number(d.date.slice(8))}</th>
              ))}
              <th className="border border-gray-400 px-1">Month</th>
              <th className="border border-gray-400 px-1">To date</th>
              <th className="border border-gray-400 px-1">%</th>
            </tr>
          </thead>
          <tbody>
            {muster.students.map((s) => {
              const pct = percent(s.toDatePresent, s.toDateWorking);
              return (
                <tr key={s.id}>
                  <td className="border border-gray-300 px-1 text-right tabular-nums">{s.roll_no}</td>
                  <td className="whitespace-nowrap border border-gray-300 px-1">{s.name}</td>
                  {muster.days.map((d) => {
                    const code = s.marks[d.date];
                    return (
                      <td key={d.date} className={`border border-gray-300 text-center font-semibold ${d.working ? '' : 'bg-gray-100'}`} style={code ? { color: statusColors[code] } : undefined}>
                        {code ?? ''}
                      </td>
                    );
                  })}
                  <td className="border border-gray-300 px-1 text-right tabular-nums">{s.present}/{s.working}</td>
                  <td className="border border-gray-300 px-1 text-right tabular-nums">{s.toDatePresent}/{s.toDateWorking}</td>
                  <td className={`border border-gray-300 px-1 text-right tabular-nums ${pct !== null && pct < 75 ? 'font-bold text-red-700' : ''}`}>{pct ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2">P present · A absent · HD half day · L leave · ML medical leave · OD on duty · SP sports. Shaded columns are not working days.</p>

      <footer className="mt-10 grid grid-cols-2 gap-10 text-center">
        <div>
          <div className="border-t border-gray-500 pt-1">Class teacher</div>
          {muster.monthRow?.class_teacher_signed_at ? <div>Signed electronically {formatDate(muster.monthRow.class_teacher_signed_at)}</div> : null}
        </div>
        <div>
          <div className="border-t border-gray-500 pt-1">Principal</div>
          {muster.monthRow?.principal_signed_at ? <div>Signed electronically {formatDate(muster.monthRow.principal_signed_at)}</div> : null}
        </div>
      </footer>
    </div>
  );
}
