// A start the rules refuse is reported with the rule's own text (bad_request), not a generic internal error.
// Uses the real engine: a 3-seat table with 2 chosen Advisors breaks the one-Advisor-per-player rule (rulebook p15).
import { describe, expect, it } from 'vitest';
import type { LobbySettings, ServerMessage } from '../../../packages/engine/src/protocol';
import { loadRealEngine } from '../src/engine';
import { RoomManager, type Session } from '../src/rooms';
import { MemoryStore } from '../src/store';

interface Client extends Session {
  out: ServerMessage[];
}

function client(label: string): Client {
  const c: Client = {
    id: `c-${label}`,
    guestId: `guest-${label}-0001`,
    name: label,
    room: null,
    seat: null,
    out: [],
    send(m) {
      c.out.push(m);
    },
    close() {},
  };
  return c;
}

const last = <T extends ServerMessage['t']>(c: Client, t: T) =>
  c.out.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t).at(-1);

function manager(): RoomManager {
  return new RoomManager({
    engine: loadRealEngine(),
    store: new MemoryStore(),
    snapshotEvery: 10,
    lobbyGraceMs: 60_000,
    endedRoomTtlMs: 60_000,
    maxRooms: 10,
    abandonAfterMs: 3_600_000,
    retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('start with a table the rules do not allow', () => {
  it('refuses with bad_request and the engine rule text, and the lobby stays open for a fix', () => {
    const m = manager();
    const host = client('host');
    const b = client('b');
    const c = client('c');
    [host, b, c].forEach((s) => m.connect(s));
    const settings: Partial<LobbySettings> = { seats: 3, advisors: ['ADV_GENERATOR', 'ADV_HEALTH'], seed: 77 };
    m.handle(host, { t: 'create', name: 'Host', settings });
    const code = last(host, 'joined')!.code;
    m.handle(b, { t: 'join', code, name: 'Ben' });
    m.handle(c, { t: 'join', code, name: 'Cy' });
    m.handle(b, { t: 'ready', ready: true });
    m.handle(c, { t: 'ready', ready: true });

    m.handle(host, { t: 'start' });
    expect(last(host, 'error')).toEqual({
      t: 'error',
      code: 'bad_request',
      message: 'the table needs at least 3 Advisors (one per player)',
    });
    expect(m.describeRoom(code)?.status).toBe('lobby');
    expect(last(host, 'state')).toBeUndefined();

    // The host fixes the table and starts again.
    m.handle(host, { t: 'settings', settings: { advisors: ['ADV_GENERATOR', 'ADV_HEALTH', 'ADV_SOCIAL'] } });
    const errorsBefore = host.out.filter((x) => x.t === 'error').length;
    m.handle(host, { t: 'start' });
    expect(host.out.filter((x) => x.t === 'error').length).toBe(errorsBefore);
    expect(m.describeRoom(code)?.status).toBe('playing');
    expect(last(host, 'state')?.seq).toBe(0);
  });

  it('a solo or two-seat table with no chosen Advisors starts as before', () => {
    const m = manager();
    const host = client('host');
    m.connect(host);
    m.handle(host, { t: 'create', name: 'Solo', settings: { seats: 1, seed: 5 } });
    m.handle(host, { t: 'start' });
    expect(host.out.some((x) => x.t === 'error')).toBe(false);
    expect(last(host, 'state')?.status).toBe('playing');
  });
});
