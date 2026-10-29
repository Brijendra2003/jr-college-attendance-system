# Production deployment: Lokmanya Jr College of Science and Commerce

Supabase project `ltalpbgxkhjvrandhyoz` (Junior College edition only) + Vercel (`divine-attendance`).
Run the commands from `jr-college-attendance-system/` in PowerShell.

## 1. Database schema (once, then after every new migration)

```powershell
npx supabase login                                        # opens the browser
npx supabase link --project-ref ltalpbgxkhjvrandhyoz      # asks for the database password
npx supabase db push                                      # applies supabase/migrations/0001–0011
```

Check: `https://<your-site>/api/health` returns `{"ok":true}` once the app is deployed.

## 2. Principal account

```powershell
$env:BOOTSTRAP_PASSWORD = '<the Principal password>'
npm run bootstrap:admin -- --username Principle --name "Principal" --role principal --streams SCI,COM
Remove-Item Env:BOOTSTRAP_PASSWORD
```

- Sign in with username **Principle** (any letter case) and that password.
- `--streams SCI,COM` turns off the Arts stream, since the college runs Science and Commerce only.
- Without `--email`, the account gets a non-deliverable placeholder email (`principle@accounts.invalid`), so "Forgot password" cannot reach it. Add a real address later in Supabase → Authentication → Users, or re-run the bootstrap with `--email`.
- On first sign-in the Principal is asked to scan a QR code with an authenticator app (Google or Microsoft Authenticator). The college's security rules require this two-step verification for Principal and Admin accounts.
- After that, the setup wizard opens. The college name is pre-filled; enter the divisional board, index number, UDISE code, year, terms and divisions.

## 3. Supabase dashboard settings (hosted projects ignore `supabase/config.toml`)

| Where | Setting |
|---|---|
| Authentication → Sign In / Providers → Email | **Allow new users to sign up: OFF** (accounts are issued by the office); confirm email: off |
| Authentication → Policies (Passwords) | Minimum length 10; require lower + upper case letters and digits; enable leaked-password protection if your plan has it |
| Authentication → URL Configuration | Site URL `https://divine-attendance.vercel.app` (or the college domain); add redirect `https://divine-attendance.vercel.app/auth/confirm` |
| Authentication → Email Templates → Reset password | Link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` |
| Authentication → Emails → SMTP | Your provider (Resend / Amazon SES). The built-in sender is rate-limited and not for production |
| Authentication → Multi-factor | TOTP enabled |
| Authentication → Hooks | Custom Access Token → `public.custom_access_token_hook` (adds role claims for the mobile app) |
| Authentication → Sessions | JWT expiry 900 seconds |
| Database → Backups | Daily backups; turn on Point-in-Time Recovery |
| Project Settings → General | Region should be **Mumbai (ap-south-1)** for data residency (web doc §18). The region cannot be changed later |

## 4. Background jobs and notifications

The migration schedules the pg_cron jobs. The dispatcher needs two Vault secrets and the Edge Function:

```sql
-- SQL editor, once
select vault.create_secret('https://ltalpbgxkhjvrandhyoz.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
```

```powershell
npx supabase functions deploy dispatch --no-verify-jwt
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(Get-Content firebase-service-account.json -Raw)" RESEND_API_KEY=... MAIL_FROM="Lokmanya Jr College <attendance@your-domain>"
```

Until Firebase is set up, notifications still appear in the in-app notification centre.

## 5. Vercel environment variables (Production)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_JR_SUPABASE_URL` | `https://ltalpbgxkhjvrandhyoz.supabase.co` |
| `NEXT_PUBLIC_JR_SUPABASE_PUBLISHABLE_KEY` | publishable (anon) key |
| `JR_SUPABASE_SERVICE_ROLE_KEY` | service_role key (**Production only, never "Expose to browser"**) |
| `NEXT_PUBLIC_SITE_URL` | `https://divine-attendance.vercel.app`: **must include `https://`**, or the server refuses to start |
| `JR_REQUIRE_MFA` | `true` (or unset). `false` is refused in production |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional (also enable CAPTCHA in Supabase Auth) |

## 6. Before go-live

- [ ] `npm run lint && npm test && npm run test:db && npm run build` pass (CI runs them on every push)
- [ ] `/api/health` is OK; the Principal can sign in, enrol MFA and complete setup
- [ ] Sign-ups disabled; SMTP configured; reset-password email works for a staff member with a real email
- [ ] Office, Supervisor and class-teacher logins issued from **Staff**
- [ ] Do **not** run `npm run seed:demo` against this project
- [ ] Keep the database password and the service_role key out of the repository. The `# DB password` comment in `.env.local` is better kept in a password manager
