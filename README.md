# Jr College Attendance: web app and backend

Junior College (Std XI–XII, MSBSHSE) attendance system, single-tenant edition. This project is the
**Next.js web app** and the **Supabase backend that the mobile app also uses**. The design is in
[`../webApp_Architecture.md`](../webApp_Architecture.md) and [`../mobileApp_Architecture.md`](../mobileApp_Architecture.md).

| | |
|---|---|
| Web | Next.js 16 (App Router, Cache Components), React 19, TypeScript strict, Tailwind v4 |
| Backend | Supabase Postgres: RLS on every table, attendance engine as RPCs, pg_cron jobs, Edge Function dispatcher |
| Shared with mobile | `src/shared/`: permissions, Zod schemas, attendance maths, error codes, IST dates, ID validators, design tokens |

## Run it locally

Prerequisites: Node 22, Docker, and the Supabase CLI (`npx supabase` works).

```bash
npm install
npx supabase start            # Jr College stack on ports 554xx (separate from the engineering edition)
npx supabase db reset         # applies supabase/migrations + supabase/seed/dev.sql
cp .env.example .env.local    # paste the API URL, publishable key and service_role key that `supabase status` prints
# For local work without an authenticator app, set JR_REQUIRE_MFA=false in .env.local
npm run seed:demo             # optional: demo college, ~100 students, three weeks of roll-calls (password Demo@12345)
npm run dev                   # http://localhost:3000
```

**Production:** follow [docs/DEPLOY.md](docs/DEPLOY.md) (schema push, Principal account, Supabase and
Vercel settings, go-live checklist). Never run `seed:demo` there. After the Principal signs in, the
first-run wizard at `/setup` walks through the college profile (name pre-filled from `src/lib/site.ts`),
the MSBSHSE template, year and terms, shifts and divisions.

Password-reset email template (Supabase → Auth → Email templates):
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

## Tests

| Command | What it checks |
|---|---|
| `npm run test` | Vitest: attendance maths, absentee keypad, error mapping, ID validators, permissions |
| `npm run test:db` | Runs **all migrations in PGlite** (Postgres in WASM, no Docker) and 40 behaviour checks: idempotent day/period submission, conflict, edit window, locking, corrections through closed months, holiday voiding, late CAP admissions, eligibility (SQL = TypeScript on shared fixtures), leave with guardian ack, import idempotency, timetable publish, the RLS matrix for each persona, transfers, announcements, export logging |
| `npm run lint`, `npm run build` | ESLint and a production build with type checking |

PGlite emulates only the Supabase pieces the migrations need (auth.uid/jwt, API roles). Keep the full
`supabase start` stack and pgTAP as the CI reference (web doc §20, §22).

## Layout

```
src/
  app/(auth)/          login, forgot/reset password, MFA (TOTP for Principal/Admin)
  app/(portal)/        dashboard, attendance (today, day registers, corrections, months + muster),
                       eligibility (defaulters, bilingual notices, condonation), people (students 360,
                       guardians & logins, staff), admissions import, academics (structure, years,
                       calendar), timetable (+ daily sessions), leave, announcements, reports, govt, audit, settings, my-class
  app/setup/           first-run wizard
  app/api/             report exports (xlsx/csv), import template
  features/<domain>/   queries.ts (RLS-scoped reads), actions.ts (Server Actions through action())
  lib/auth/            getViewer / requirePermission (pages), action() wrapper (mutations)
  shared/              source of truth for code shared with the mobile app (pure TS: zod, date-fns)
  proxy.ts             session refresh + sign-in redirect
supabase/
  migrations/          0001–0010: schema, RLS, attendance engine, operations RPCs, mobile views, jobs
  functions/dispatch/  notification outbox → FCM (Android/iOS) + email
  tests/               PGlite engine suite
scripts/               bootstrap-admin, seed-demo
```

Every mutation goes: client form → Server Action wrapped in `action()` (verified user, active account,
permission, Zod) → RPC or RLS-checked write. The database is the final gate: RLS on all 74 tables,
and attendance tables have **no write policies**. Only the RPCs write them.

## Mobile app contract

The mobile app (`../JrCollegeMobile`) talks to Supabase directly, never through Next.js.

**Shared code.**
- Copy `src/shared/` into the app with its `scripts/sync-shared.mjs` (mobile doc §5).
- The shared files depend only on `zod`, `date-fns` and `@date-fns/tz`.

**Teacher endpoints.**
- `v_my_sessions`, `v_my_day_registers`, `division_roster_for_marking`, `session_roster_for_marking`
- `submit_day_register` and `submit_attendance`: idempotent on `client_submission_id`. They return `ok | duplicate | conflict | locked | month_closed | not_working_day | cancelled` plus `defaulted_students`.
- The marking rosters include `register.block`, so the app knows before submitting why a register is read-only.
- `class_overview`, `issue_defaulter_notice`, `log_parent_meeting`, `v_my_class_guardians`, `v_leave_pending_for_me`, `decide_leave`, `request_attendance_correction`, `my_capabilities`

**Student and parent endpoints.**
- `v_my_profile`, `v_my_children`, `v_my_day_summary`, `v_my_eligibility`, `v_my_attendance_summary`, `v_my_timetable`, `v_academic_calendar`
- `my_day_history`, `my_subject_attendance`
- `apply_leave`, `acknowledge_leave`, `cancel_leave`, `v_my_leave`, `v_my_notices`, `acknowledge_notice`
- `raise_attendance_dispute`, `record_consent`

**All users.**
- `notifications`, `mark_notifications_read`, `register_device`
- Public `app_config` (edition, `min_mobile_version`, maintenance banner, features)

**Errors.** RPCs raise stable codes (`ATT_FORBIDDEN`, `MONTH_CLOSED`, `LEAVE_OVERLAP`…). `src/shared/errors.ts` maps them to en/mr/hi messages.

## Built vs. planned (architecture §23 phases)

**Built:**
- **Phase 01, foundation:** the setup wizard (Admin creates the first account with `bootstrap:admin`), structure, calendar, student and CAP imports, guardians and issuing logins, staff with class teachers and coordinators, the timetable editor and publishing.
- **Phase 02, core attendance:** web roll-call (absentee keypad), the live today board, day registers, corrections, reopen, holidays, month close with the printable muster, policies, reports.
- **Phase 03, core:**
  - eligibility (projected/final), defaulter notices with bilingual letters, the condonation workflow
  - leave with guardian acknowledgement, announcements, notification outbox and dispatcher
  - government readiness and MahaDBT exports, the audit log

**Not built yet:**
- Year rollover and promotion wizard
- Exams and exam attendance
- Certificates
- Biometric device ingest and bridge (Phase 04)
- Period-derived and biometric day sources
- Cloudinary media (photos, documents, notice PDFs; notices and the muster print from the browser for now)
- next-intl UI translation (the UI is in English; notices, notifications and names are bilingual)
- Per-year government format adapters
- Role-permission editor UI (the matrix is shown read-only; role assignment per user is editable)

## Deviations from the documents (deliberate)

- **`app.can` signature.** The doc's `app.can(perm, scope)` snippet compares `rp.scope = scope`. In a SQL function that resolves to the column on both sides, so **every scope check passes**. The migration uses `p_perm` / `p_scope`. Fix the snippet in the doc too.
- **RLS array subqueries.** `= any ((select app.my_stream_ids()))` parses as a subquery over arrays and fails. The policies use `= any ((select …)::uuid[])`.
- **Roles are read from `user_roles` at query time** rather than trusted from the JWT claim. Role changes then apply immediately. The access-token hook still adds the claims for the mobile app.
- **Office has `eligibility.manage`** so it can record the divisional board's condonation decision (§8.3, §9.7). The §6.3 matrix shows Office as read-only, so confirm with the college.
- **"Today" is IST everywhere** (`app.today()`). The database server runs in UTC.
- **Filters use plain GET forms** instead of nuqs, and the UI kit is local Tailwind components instead of shadcn/ui.
