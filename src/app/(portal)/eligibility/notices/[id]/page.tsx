import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/viewer';
import { getCollege } from '@/features/academics/context';
import { getCollegePolicy, getNotice } from '@/features/eligibility/queries';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui/button';
import { formatDate } from '@/shared/dates';

export const metadata = { title: 'Defaulter notice' };

const LEVEL_MR: Record<string, string> = { warning: 'प्रथम सूचना', second: 'द्वितीय सूचना', final: 'अंतिम सूचना' };
const LEVEL_EN: Record<string, string> = { warning: 'First notice', second: 'Second notice', final: 'Final notice' };

/** Bilingual letter on the college letterhead (web doc §12.11). Print or save as PDF from the browser. */
export default async function NoticeLetter({ params }: PageProps<'/eligibility/notices/[id]'>) {
  await requirePermission(['notices.defaulter.issue', 'eligibility.view']);
  const { id } = await params;
  const [notice, college, policy] = await Promise.all([getNotice(id), getCollege(), getCollegePolicy()]);
  if (!notice) notFound();
  const min = Number(policy?.min_percent ?? 75);
  const pct = notice.day_percent === null ? '–' : `${Number(notice.day_percent).toFixed(2)}%`;
  const short = notice.subject_percents.filter((s) => s.percent < min);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[14px] leading-relaxed shadow-sm print:shadow-none">
      <div className="no-print mb-6 flex gap-2">
        <LinkButton href="/eligibility/notices" size="sm">← Notices</LinkButton>
        <PrintButton />
      </div>
      <header className="border-b-2 border-gray-800 pb-3 text-center">
        <div className="text-xl font-bold">{college?.name}</div>
        {college?.name_mr ? <div className="deva text-lg font-semibold" lang="mr">{college.name_mr}</div> : null}
        <div className="text-sm">{college?.address}</div>
        {college?.board_index_no ? <div className="text-xs">Junior College Index No. {college.board_index_no}</div> : null}
      </header>

      <div className="mt-4 flex justify-between text-sm">
        <span>Ref: DN/{notice.id.slice(0, 8).toUpperCase()}</span>
        <span>Date: {formatDate(notice.issued_at)}</span>
      </div>

      <section className="deva mt-6" lang="mr">
        <h1 className="text-center text-lg font-bold">{LEVEL_MR[notice.level]}: अपुरी उपस्थिती</h1>
        <p className="mt-4">प्रति, पालक,</p>
        <p className="mt-2">
          आपला पाल्य <strong>{notice.student.name_mr ?? notice.student.full_name}</strong> (GR क्र. {notice.student.gr_no}, तुकडी {notice.division.name}) याची
          दि. {formatDate(notice.period_from, 'mr')} ते {formatDate(notice.period_to, 'mr')} या कालावधीतील उपस्थिती <strong>{pct}</strong> आहे.
          महाराष्ट्र राज्य माध्यमिक व उच्च माध्यमिक शिक्षण मंडळाच्या नियमानुसार उच्च माध्यमिक प्रमाणपत्र (HSC) परीक्षेसाठी कामकाजाच्या दिवसांपैकी किमान <strong>{min}%</strong> उपस्थिती आवश्यक आहे.
        </p>
        {short.length ? <p className="mt-2">खालील विषयांमध्ये उपस्थिती कमी आहे: {short.map((s) => `${s.subject} (${s.component}) ${s.percent}%`).join(', ')}.</p> : null}
        <p className="mt-2">
          कृपया आपल्या पाल्याची नियमित उपस्थिती सुनिश्चित करावी. उपस्थिती अपुरी राहिल्यास मंडळाचा परीक्षा अर्ज रोखला जाऊ शकतो / पुढील वर्गात प्रवेश दिला जाणार नाही.
          कृपया वर्गशिक्षकांशी संपर्क साधावा.
        </p>
      </section>

      <hr className="my-6 border-dashed" />

      <section>
        <h2 className="text-center text-lg font-bold">{LEVEL_EN[notice.level]}: Attendance shortage</h2>
        <p className="mt-4">Dear Parent / Guardian,</p>
        <p className="mt-2">
          The attendance of your ward <strong>{notice.student.full_name}</strong> (GR No. {notice.student.gr_no}, Division {notice.division.name}) for the period
          {' '}{formatDate(notice.period_from)} to {formatDate(notice.period_to)} is <strong>{pct}</strong>. Under the rules of the Maharashtra State Board of
          Secondary and Higher Secondary Education, a regular HSC candidate must attend at least <strong>{min}%</strong> of the working days.
        </p>
        {short.length ? <p className="mt-2">Attendance is also low in: {short.map((s) => `${s.subject} (${s.component}) ${s.percent}%`).join(', ')}.</p> : null}
        <p className="mt-2">
          Please ensure regular attendance. If the shortfall continues, the board examination form may be withheld or promotion refused. Kindly meet the class teacher.
        </p>
      </section>

      <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <div>
          <div className="border-t border-gray-500 pt-1">Guardian&apos;s signature / पालकांची सही</div>
          {notice.acknowledged_at ? <div className="mt-1 text-xs text-green-700">Acknowledged in the app on {formatDate(notice.acknowledged_at)}</div> : null}
        </div>
        <div className="text-right">
          <div className="border-t border-gray-500 pt-1">Principal / प्राचार्य</div>
        </div>
      </footer>
    </div>
  );
}
