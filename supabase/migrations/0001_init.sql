-- 0001_init.sql : persistence for the Frostpunk realtime server (apps/server).
-- Idempotent: safe to re-run. The server writes with the service-role key (bypasses RLS).
-- Clients never write: anon/authenticated have no write privileges and no write policies.
-- Anonymous (anon key) readers can see finished games' summaries only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  room_code      text        not null check (room_code ~ '^[A-HJ-NP-Z]{6}$'),
  room_name      text        not null default '',
  status         text        not null default 'playing' check (status in ('playing', 'won', 'lost', 'abandoned')),
  scenario       text        not null check (scenario in ('crater', 'frozenGrove', 'dreadnought')),
  society        integer     not null check (society between 1 and 6),
  difficulty     text        not null check (difficulty in ('normal', 'hard')),
  mode           text        not null check (mode in ('solo', 'coop')),
  extra_pack     boolean     not null default false,
  seed           bigint      not null check (seed between 0 and 4294967295),
  config         jsonb       not null,               -- engine GameConfig as started (player names and guest ids)
  round          integer     check (round is null or round >= 1),
  end_reason     text,
  command_count  integer     not null default 0 check (command_count >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create table if not exists public.game_players (
  game_id       uuid    not null references public.games (id) on delete cascade,
  seat          integer not null check (seat between 0 and 3),
  guest_id      text    not null,
  display_name  text    not null,
  is_host       boolean not null default false,
  token_hash    text    not null,                    -- sha256 of the seat token; the raw token is never stored
  primary key (game_id, seat)
);

-- Append-only command log: one row per accepted answer, in order.
create table if not exists public.game_commands (
  game_id     uuid        not null references public.games (id) on delete cascade,
  seq         integer     not null check (seq >= 1),
  seat        integer     not null check (seat >= 0),
  pending_id  integer     not null check (pending_id >= 0),
  pick        jsonb       not null check (jsonb_typeof(pick) = 'array'), -- array of option ids
  created_at  timestamptz not null default now(),
  primary key (game_id, seq)
);

-- Engine state snapshots (engine serialize() output), written every PERSIST_SNAPSHOT_EVERY commands.
create table if not exists public.game_snapshots (
  game_id     uuid        not null references public.games (id) on delete cascade,
  command_seq integer     not null check (command_seq >= 0),
  state       text        not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, command_seq)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists games_status_idx on public.games (status);
create index if not exists games_room_code_idx on public.games (room_code, created_at desc);
create index if not exists games_finished_idx on public.games (finished_at desc)
  where status in ('won', 'lost', 'abandoned');
create index if not exists game_players_guest_idx on public.game_players (guest_id);

-- ---------------------------------------------------------------------------
-- Append-only guard on the command log
-- ---------------------------------------------------------------------------

create or replace function public.forbid_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'table % is append-only', tg_table_name;
end;
$$;

drop trigger if exists game_commands_append_only on public.game_commands;
create trigger game_commands_append_only
  before update or delete on public.game_commands
  for each row execute function public.forbid_log_mutation();
-- To delete a game (cascade removes its commands), first run:
--   alter table public.game_commands disable trigger game_commands_append_only;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_commands enable row level security;
alter table public.game_snapshots enable row level security;

-- Client roles: no table privileges except reading finished-game summaries (no config, no player tokens).
revoke all on public.games, public.game_players, public.game_commands, public.game_snapshots
  from anon, authenticated;
grant select (
  id, room_code, room_name, status, scenario, society, difficulty, mode, extra_pack, seed,
  round, end_reason, command_count, created_at, finished_at
) on public.games to anon, authenticated;

drop policy if exists games_read_finished on public.games;
create policy games_read_finished on public.games
  for select to anon, authenticated
  using (status in ('won', 'lost', 'abandoned'));

-- No policies on game_players, game_commands, game_snapshots: only the service role can read them.
-- No insert/update/delete policies anywhere: clients cannot write directly.
