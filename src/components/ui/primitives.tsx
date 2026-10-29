import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { eligibilityColors, statusColors } from '@/shared/tokens';

// ---------------------------------------------------------------- layout
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-gray-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('rounded-[var(--radius-card)] border border-gray-200 bg-white shadow-sm', className)} {...props} />;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'ok' | 'warn' | 'danger' }) {
  const toneClass = { default: 'text-gray-900', ok: 'text-green-700', warn: 'text-amber-700', danger: 'text-red-700' }[tone];
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-gray-800">{title}</p>
      {children ? <div className="mt-2 text-sm text-gray-500">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    ok: 'border-green-200 bg-green-50 text-green-900',
  }[tone];
  return <div className={cn('rounded-lg border px-4 py-3 text-sm', cls)}>{children}</div>;
}

// ---------------------------------------------------------------- badges
const badgeTones = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  violet: 'bg-violet-100 text-violet-800',
} as const;

export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', badgeTones[tone], className)}>{children}</span>;
}

/** Status letter with colour. The letter is always shown, so colour is never the only signal. */
export function StatusPill({ code, color, title }: { code: string; color?: string | null; title?: string }) {
  const c = color ?? statusColors[code] ?? '#6b7280';
  return (
    <span
      title={title ?? code}
      className="inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-semibold"
      style={{ color: c, backgroundColor: `${c}1a`, boxShadow: `inset 0 0 0 1px ${c}40` }}
    >
      {code}
    </span>
  );
}

const ELIGIBILITY_LABELS: Record<string, string> = {
  eligible: 'Eligible', at_risk: 'At risk', short: 'Short', condonation_pending: 'Condonation pending',
  condoned: 'Condoned', not_eligible: 'Not eligible',
};

export function EligibilityChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-gray-400">–</span>;
  const c = eligibilityColors[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: c.fg, backgroundColor: c.bg }}>
      {ELIGIBILITY_LABELS[status] ?? status}
    </span>
  );
}

const STATE_TONES: Record<string, keyof typeof badgeTones> = {
  pending: 'amber', submitted: 'green', locked: 'gray', reopened: 'blue', voided: 'gray',
  open: 'blue', closed: 'gray', approved: 'green', rejected: 'red', needs_info: 'amber', cancelled: 'gray',
  awaiting_guardian: 'violet', draft: 'gray', published: 'green', archived: 'gray', scheduled: 'blue', held: 'green',
  verified: 'green', revoked: 'red', active: 'green', left: 'gray', admission_cancelled: 'red',
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  if (!state) return <Badge>–</Badge>;
  return <Badge tone={STATE_TONES[state] ?? 'gray'}>{state.replace(/_/g, ' ')}</Badge>;
}

export function Percent({ value, min = 75, warn = 80 }: { value: number | string | null | undefined; min?: number; warn?: number }) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">–</span>;
  const n = Number(value);
  const cls = n < min ? 'text-red-700 font-semibold' : n < warn ? 'text-amber-700 font-medium' : 'text-gray-900';
  return <span className={cn('tabular-nums', cls)}>{n.toFixed(2)}%</span>;
}

// ---------------------------------------------------------------- tables
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: ReactNode }) => (
  <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">{children}</thead>
);
export const TH = ({ className, ...p }: ComponentProps<'th'>) => <th className={cn('px-4 py-2.5 font-medium', className)} {...p} />;
export const TR = ({ className, ...p }: ComponentProps<'tr'>) => <tr className={cn('border-b border-gray-100 last:border-0 hover:bg-gray-50/60', className)} {...p} />;
export const TD = ({ className, ...p }: ComponentProps<'td'>) => <td className={cn('px-4 py-2.5 align-middle text-gray-800', className)} {...p} />;
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-gray-500">{children}</td>
    </tr>
  );
}

// ---------------------------------------------------------------- form controls
const control =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-xs placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-gray-50';

export const Input = ({ className, ...p }: ComponentProps<'input'>) => <input className={cn(control, 'h-10', className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<'select'>) => <select className={cn(control, 'h-10 pr-8', className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<'textarea'>) => <textarea className={cn(control, 'py-2', className)} rows={3} {...p} />;

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}
