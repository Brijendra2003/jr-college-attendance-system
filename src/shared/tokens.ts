// Design tokens. Mapped into Tailwind v4 @theme (src/app/globals.css) and NativeWind on mobile.
// Keep the two in step: globals.css repeats these values as CSS variables.
// SHARED.

export const colors = {
  brand: { 50: '#eef4ff', 100: '#dbe6fe', 500: '#3b5bdb', 600: '#2f4ac0', 700: '#263b99', 900: '#1b2961' },
  ink: { 900: '#111827', 700: '#374151', 500: '#6b7280', 300: '#d1d5db', 100: '#f3f4f6' },
  ok: '#16a34a',
  warn: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
} as const;

/** Fallback colours for status codes; the live values come from attendance_status_codes.color. */
export const statusColors: Record<string, string> = {
  P: '#16a34a', A: '#dc2626', HD: '#d97706', LT: '#ca8a04', L: '#2563eb', ML: '#7c3aed', OD: '#0891b2', SP: '#0d9488',
};

export const eligibilityColors: Record<string, { fg: string; bg: string }> = {
  eligible: { fg: '#166534', bg: '#dcfce7' },
  at_risk: { fg: '#92400e', bg: '#fef3c7' },
  short: { fg: '#991b1b', bg: '#fee2e2' },
  condonation_pending: { fg: '#5b21b6', bg: '#ede9fe' },
  condoned: { fg: '#155e75', bg: '#cffafe' },
  not_eligible: { fg: '#7f1d1d', bg: '#fecaca' },
};

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const fonts = {
  sans: 'Noto Sans',
  devanagari: 'Noto Sans Devanagari',
} as const;
