# Service-role key usage

The service-role key bypasses RLS. It exists only on the server (`JR_SUPABASE_SERVICE_ROLE_KEY`)
and in Edge Function secrets. Every use is listed here (web doc §18). Each web use runs **after**
the `action()` wrapper has verified the caller's session, active account and permission.

| Where | Why the service role is needed | Caller check |
|---|---|---|
| `src/features/auth/actions.ts` → `signIn` | Resolve a sign-in **username** to the account's email (`profiles.username`), before any session exists | None possible (pre-auth). Reads one column for one exact username; the response is identical for unknown usernames and wrong passwords |
| `src/features/people/actions.ts` → `issueLogin` | Create or reset an Auth user (Admin API), link it to the guardian/staff/student row, grant the role, audit | `accounts.issue @ all`; non-Teacher roles only by Admin/Principal; student logins only with recorded `app_account` consent |
| `src/features/people/actions.ts` → `setAccountActive` | Ban/unban the Auth user so sessions cannot refresh | `accounts.issue @ all`; cannot deactivate yourself |
| `src/features/people/actions.ts` → `endEnrollment` | Ban the Auth user of a student whose admission was cancelled / who left | `students.manage @ all` (the RPC itself runs as the caller) |
| `supabase/functions/dispatch` | Claim and complete outbox rows (`claim_notification_batch`, `complete_notification` are granted to service_role only) | Request must carry the service-role bearer (pg_cron) |
| `scripts/bootstrap-admin.mjs`, `scripts/seed-demo.mjs` | First admin; local demo data | Run by an operator from a terminal; refuse to run on a non–Junior College database |

`src/lib/supabase/edition.ts` uses the **publishable** key (the edition row is public), not the service role.
