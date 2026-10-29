-- 0011 Username sign-in and production hardening.

-- ---------------------------------------------------------------------------
-- Usernames: some staff (e.g. the Principal) sign in with a username instead of an email.
-- The web sign-in resolves username → email on the server; Supabase Auth still authenticates
-- by email + password.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column username text unique
  check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$');

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, email, preferred_language, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en'),
    lower(nullif(new.raw_user_meta_data ->> 'username', ''))
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Keep profiles.email in step when an admin changes a user's email.
create function app.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function app.sync_user_email();

-- ---------------------------------------------------------------------------
-- Privileges: nothing in the private schema is callable by anon, and functions created after
-- the earlier blanket revokes get the same treatment.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
revoke execute on function public.claim_notification_batch(integer) from authenticated;
revoke execute on function public.complete_notification(bigint, boolean, text, text[]) from authenticated;

-- Future functions in public are not executable by anon unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;
