-- 0001 Foundation: extensions, private `app` schema, edition guard, audit log, shared triggers.
-- Junior College edition. This database is never shared with the engineering edition (web doc §5).

-- Supabase keeps extensions out of `public` (database linter rule 0014).
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- The college runs on IST. The database server runs on UTC, so never use current_date for
-- "today" in business logic: between 18:30 and 24:00 UTC the dates differ.
create function app.today() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Timestamp for a local IST date + time.
create function app.ist(p_date date, p_time time) returns timestamptz
language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Kolkata'
$$;

-- ---------------------------------------------------------------------------
-- app_config: feature flags, minimum mobile version, edition marker
-- ---------------------------------------------------------------------------
create table public.app_config (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,   -- readable before sign-in (edition, min version, maintenance)
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value, is_public) values
  ('edition',              '"junior_college"', true),
  ('min_mobile_version',   '"1.0.0"',          true),
  ('maintenance_banner',   'null',             true),
  ('roster_stale_hours',   '6',                true),
  ('require_aal2',         'true',             false),  -- Principal/Admin role and policy edits need MFA
  ('features',             '{"biometric": false, "roster_photos": false, "sms": false, "whatsapp": false}', true);

-- The edition marker can never be changed or removed.
create function app.guard_edition() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'DELETE' and old.key = 'edition')
     or (tg_op = 'UPDATE' and old.key = 'edition' and new.value is distinct from old.value) then
    raise exception using errcode = 'P0001', message = 'EDITION_IMMUTABLE';
  end if;
  return coalesce(new, old);
end $$;

create trigger app_config_edition_guard
  before update or delete on public.app_config
  for each row execute function app.guard_edition();

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only, web doc §12.18)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,               -- insert | update | delete | rpc name
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_actor_idx  on public.audit_log (actor_id, created_at desc);
create index audit_log_time_idx   on public.audit_log (created_at desc);

create function app.reject_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'AUDIT_APPEND_ONLY';
end $$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.reject_audit_mutation();

-- Request headers forwarded by PostgREST, when present.
create function app.request_header(name text) returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> name
$$;

-- Generic row audit trigger. Attach to any table whose changes must be audited.
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id     text  := coalesce(v_after ->> 'id', v_before ->> 'id');
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after, reason, ip, user_agent)
  values (
    auth.uid(),
    lower(tg_op), tg_table_name, v_id, v_before, v_after,
    nullif(current_setting('app.audit_reason', true), ''),
    nullif(split_part(coalesce(app.request_header('x-forwarded-for'), ''), ',', 1), '')::inet,
    app.request_header('user-agent')
  );
  return coalesce(new, old);
end $$;

-- Explicit audit entry from inside RPCs.
create function app.audit(p_action text, p_entity text, p_entity_id text,
                          p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after, p_reason);
$$;
