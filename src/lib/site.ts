// Deployment identity. The official profile (address, board index no., Marathi name) lives in the
// `college` table and is edited in Settings; this constant is used where the database is not
// readable yet (sign-in page, page titles, first-run wizard defaults).
export const SITE = {
  collegeName: 'Lokmanya Jr College of Science and Commerce',
  shortName: 'Lokmanya Jr College',
  appName: 'Attendance',
  /** Streams this college runs; the setup script deactivates the others. */
  streams: ['SCI', 'COM'] as const,
} as const;
