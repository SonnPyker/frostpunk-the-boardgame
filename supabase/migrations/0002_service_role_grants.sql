-- 0002_service_role_grants.sql : explicit table privileges for the server's role.
-- Idempotent: grant can be repeated.
--
-- The server (apps/server) connects with the service_role key. Supabase grants service_role these privileges on new
-- public tables by default, so on a standard project this file changes nothing. It is here so that the schema also
-- works on a project whose default privileges differ (found by supabase/tests/pglite_check.mjs: without these grants
-- every server write fails with "permission denied for table games"). service_role bypasses RLS, so no policy is needed.
-- anon and authenticated are not granted anything here: see 0001_init.sql.

grant usage on schema public to service_role;
grant select, insert, update, delete on public.games, public.game_players, public.game_commands, public.game_snapshots
  to service_role;
