-- Local development only (applied by `supabase db reset`). Reference data and the MSBSHSE
-- template live in the migrations; demo people and attendance come from `npm run seed:demo`.

-- Let local Principal/Admin accounts work without enrolling an authenticator app.
update public.app_config set value = 'false' where key = 'require_aal2';
