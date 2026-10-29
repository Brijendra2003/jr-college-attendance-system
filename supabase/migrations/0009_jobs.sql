-- 0009 Background jobs (web doc §17) and the outbox claim/complete RPCs used by the `dispatch`
-- Edge Function. pg_cron schedules are in UTC; the comments give IST.

-- ---------------------------------------------------------------------------
-- Job bodies
-- ---------------------------------------------------------------------------
create function app.reconcile_summaries() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v int := 0;
begin
  for r in select t.id as term_id, array_agg(distinct da.student_id) as students
           from public.academic_terms t
           join public.day_attendance da on da.term_id = t.id
           where t.academic_year_id = app.active_year_id()
           group by t.id loop
    perform app.recompute_day_summaries(r.students, r.term_id);
    v := v + coalesce(array_length(r.students, 1), 0);
  end loop;
  for r in select ar.offering_id, ar.component, array_agg(distinct ar.student_id) as students
           from public.attendance_records ar
           join public.subject_offerings o on o.id = ar.offering_id and o.academic_year_id = app.active_year_id()
           group by ar.offering_id, ar.component loop
    perform app.recompute_subject_summaries(r.students, r.offering_id, r.component);
  end loop;
  return v;
end $$;

-- 18:30 IST: fold the day's held absence alerts into one digest per guardian.
create function app.build_parent_digest() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v int := 0;
begin
  for r in
    select o.user_id, count(*) as n, array_agg(o.id) as ids,
           string_agg(o.payload ->> 'body', E'\n' order by o.created_at) as lines
    from public.notification_outbox o
    where o.status = 'held' and o.event_type = 'student_absent_day'
      and (o.created_at at time zone 'Asia/Kolkata')::date = app.today()
    group by o.user_id
  loop
    insert into public.notification_outbox (dedupe_key, event_type, user_id, payload)
    values (format('digest:%s:%s', app.today(), r.user_id), 'parent_daily_digest', r.user_id,
            jsonb_build_object('title', 'Today''s attendance', 'body', r.lines,
                               'data', jsonb_build_object('type', 'parent_daily_digest', 'invalidate', 'day')))
    on conflict (dedupe_key) do nothing;
    update public.notification_outbox set status = 'sent', sent_at = now(), last_error = 'folded into digest'
     where id = any (r.ids);
    v := v + 1;
  end loop;
  return v;
end $$;

create function app.cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.notification_outbox where status in ('sent','dead') and created_at < now() - interval '30 days';
  delete from public.import_jobs where status in ('staged','validated','discarded') and created_at < now() - interval '7 days';
  delete from public.attendance_submissions where created_at < now() - interval '120 days';
  update public.device_tokens set disabled_at = now() where disabled_at is null and last_seen_at < now() - interval '60 days';
$$;

-- ---------------------------------------------------------------------------
-- Outbox claim / complete (service role only; called by supabase/functions/dispatch)
-- ---------------------------------------------------------------------------
create function public.claim_notification_batch(p_limit integer default 100)
returns table (id bigint, event_type text, user_id uuid, channel text, payload jsonb, attempts smallint,
               tokens text[], email text, language text)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  return query
  with due as (
    select o.id from public.notification_outbox o
    where o.status = 'queued' and o.next_attempt_at <= now()
      -- quiet hours 21:00–07:00 IST hold non-urgent pushes
      and (extract(hour from now() at time zone 'Asia/Kolkata') between 7 and 20
           or o.event_type in ('student_absent_day','attendance_corrected'))
    order by o.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1
    from due where o.id = due.id
    returning o.*
  )
  select c.id, c.event_type, c.user_id, c.channel, c.payload, c.attempts,
         coalesce((select array_agg(t.token) from public.device_tokens t
                   where t.user_id = c.user_id and t.disabled_at is null), '{}'),
         p.email, p.preferred_language
  from claimed c join public.profiles p on p.id = c.user_id;
end $$;

create function public.complete_notification(p_id bigint, p_ok boolean, p_error text default null,
                                             p_dead_tokens text[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'ATT_FORBIDDEN';
  end if;
  update public.notification_outbox o
     set status = case when p_ok then 'sent' when o.attempts >= 5 then 'dead' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = p_error,
         next_attempt_at = now() + make_interval(secs => 30 * power(2, o.attempts))
   where o.id = p_id;
  update public.device_tokens set disabled_at = now() where token = any (p_dead_tokens);
end $$;

revoke execute on function public.claim_notification_batch(integer) from public, anon, authenticated;
revoke execute on function public.complete_notification(bigint, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.claim_notification_batch(integer) to service_role;
grant execute on function public.complete_notification(bigint, boolean, text, text[]) to service_role;
grant execute on all functions in schema app to service_role;

-- ---------------------------------------------------------------------------
-- Schedules. Skipped where pg_cron is unavailable (e.g. some local test databases).
-- The dispatcher needs Vault secrets `project_url` and `service_role_key`.
-- ---------------------------------------------------------------------------
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available: background jobs not scheduled';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.schedule('generate-day-registers', '30 23 * * *',     $$select app.generate_day_registers()$$);      -- 05:00 IST
  perform cron.schedule('lock-registers',         '*/15 * * * *',    $$select app.lock_due_registers()$$);
  perform cron.schedule('rollcall-reminders',     '*/10 1-9 * * 1-6', $$select app.rollcall_reminders()$$);         -- 07:00–15:00 IST
  perform cron.schedule('evaluate-eligibility',   '30 19 * * *',     $$select public.evaluate_eligibility()$$);     -- 01:00 IST
  perform cron.schedule('reconcile-summaries',    '30 20 * * *',     $$select app.reconcile_summaries()$$);         -- 02:00 IST
  perform cron.schedule('cleanup',                '30 21 * * *',     $$select app.cleanup()$$);                     -- 03:00 IST
  perform cron.schedule('parent-daily-digest',    '0 13 * * *',      $$select app.build_parent_digest()$$);         -- 18:30 IST
  perform cron.schedule('dispatch-notifications', '* * * * *', $$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
      body    := '{}'::jsonb)
  $$);
end
$outer$;
