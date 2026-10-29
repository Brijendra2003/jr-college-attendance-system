// Creates the first leadership login for a new deployment. Run once:
//
//   BOOTSTRAP_PASSWORD='…' npm run bootstrap:admin -- --username principle --name "Principal" --role principal
//   npm run bootstrap:admin -- --email admin@college.edu.in --name "Admin" --role admin   (generates a password)
//
// Options:
//   --username <u>   sign-in username (3–40 chars: letters, digits, . _ -), stored lower-case
//   --email <e>      real email (recommended: enables password reset). Without it a non-deliverable
//                    placeholder <username>@accounts.invalid is used.
//   --name <n>       display name
//   --role <r>       principal | admin | supervisor | office (repeatable; default principal)
//   --streams SCI,COM  streams the college runs; the others are deactivated
// The password comes from BOOTSTRAP_PASSWORD (never a command-line argument, so it stays out of
// shell history) or is generated and printed once.
import { randomInt } from 'node:crypto';
import { admin, assertEdition, must } from './env.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const username = opt('username')?.trim().toLowerCase();
const name = opt('name') ?? 'Principal';
const roles = all('role').length ? all('role') : ['principal'];
const streams = opt('streams')?.split(',').map((s) => s.trim().toUpperCase());

if (!username && !opt('email')) {
  console.error('Give --username and/or --email. See the header of scripts/bootstrap-admin.mjs.');
  process.exit(1);
}
if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) {
  console.error('Username must be 3–40 characters: letters, digits, dot, underscore or hyphen.');
  process.exit(1);
}
const bad = roles.filter((r) => !['principal', 'admin', 'supervisor', 'office', 'exam_incharge'].includes(r));
if (bad.length) { console.error(`Unknown role(s): ${bad.join(', ')}`); process.exit(1); }

const email = (opt('email') ?? `${username}@accounts.invalid`).toLowerCase();
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const supplied = process.env.BOOTSTRAP_PASSWORD;
const password = supplied || `${Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('')}#7`;
if (supplied && (supplied.length < 10 || !/[a-z]/.test(supplied) || !/[A-Z]/.test(supplied) || !/\d/.test(supplied))) {
  console.error('BOOTSTRAP_PASSWORD must be at least 10 characters with upper- and lower-case letters and a digit.');
  process.exit(1);
}

await assertEdition();

if (username) {
  const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) { console.error(`Username "${username}" already exists. Reset its password from the web app instead.`); process.exit(1); }
}

const { data, error } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { display_name: name, ...(username ? { username } : {}) },
});
if (error) { console.error(`Could not create the account: ${error.message}`); process.exit(1); }
const userId = data.user.id;

// The profile row is created by the auth trigger; make sure the username landed on it.
if (username) must(await admin.from('profiles').update({ username, display_name: name }).eq('id', userId), 'username');
must(await admin.from('user_roles').insert(roles.map((role) => ({ user_id: userId, role }))), 'roles');
must(await admin.from('audit_log').insert({ action: 'bootstrap_account', entity: 'profiles', entity_id: userId, after: { username, email, roles } }), 'audit');

if (streams?.length) {
  must(await admin.from('streams').update({ is_active: false }).not('code', 'in', `(${streams.join(',')})`), 'streams');
  must(await admin.from('streams').update({ is_active: true }).in('code', streams), 'streams');
}

console.log(`\nCreated ${roles.join(' + ')} account`);
if (username) console.log(`  Username: ${username} (case-insensitive)`);
console.log(`  Email:    ${email}${opt('email') ? '' : '  (placeholder: add a real email in Supabase Auth to enable password reset)'}`);
console.log(supplied ? '  Password: as supplied in BOOTSTRAP_PASSWORD' : `  Password (shown once): ${password}`);
if (streams?.length) console.log(`  Active streams: ${streams.join(', ')}`);
console.log('\nPrincipal and Admin accounts set up an authenticator app (two-step verification) on first sign-in.');
