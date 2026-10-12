-- seed.sql : sample data for local development (supabase start / supabase db reset).
-- Idempotent: every insert is ON CONFLICT DO NOTHING, so re-running it changes nothing.
--
-- Adds one finished co-op game (won in round 3) with its seats and command log, so the web client's finished-games
-- list is not empty locally. The token hash is a placeholder: no live seat can resume this game.

insert into public.games (
  id, room_code, room_name, status, scenario, society, difficulty, mode, extra_pack, seed,
  config, round, end_reason, command_count, created_at, updated_at, finished_at
) values (
  '00000000-0000-4000-8000-000000000001',
  'SAMPLE',
  'Sample co-op table',
  'won',
  'crater',
  1,
  'normal',
  'coop',
  false,
  1234,
  '{"scenario":"crater","society":1,"difficulty":"normal","mode":"coop","players":[{"name":"Ann","id":"seed-guest-ann"},{"name":"Ben","id":"seed-guest-ben"}],"seed":1234,"extraPack":false,"advisors":[]}'::jsonb,
  3,
  'three decisions done',
  3,
  now() - interval '1 day',
  now() - interval '1 day',
  now() - interval '1 day'
)
on conflict (id) do nothing;

insert into public.game_players (game_id, seat, guest_id, display_name, is_host, token_hash) values
  ('00000000-0000-4000-8000-000000000001', 0, 'seed-guest-ann', 'Ann', true,  repeat('0', 64)),
  ('00000000-0000-4000-8000-000000000001', 1, 'seed-guest-ben', 'Ben', false, repeat('0', 64))
on conflict (game_id, seat) do nothing;

insert into public.game_commands (game_id, seq, seat, pending_id, pick) values
  ('00000000-0000-4000-8000-000000000001', 1, 0, 1, '["a"]'::jsonb),
  ('00000000-0000-4000-8000-000000000001', 2, 1, 2, '["b"]'::jsonb),
  ('00000000-0000-4000-8000-000000000001', 3, 0, 3, '["a"]'::jsonb)
on conflict (game_id, seq) do nothing;
