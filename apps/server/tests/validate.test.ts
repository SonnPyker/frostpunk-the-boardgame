import { describe, expect, it } from 'vitest';
import { cleanName, cleanText, normalizeCode, parseClientMessage, parseSettingsPatch } from '../src/validate';
import { TokenBucket } from '../src/util';

describe('parseClientMessage', () => {
  it('accepts every client message type', () => {
    const frames = [
      '{"t":"hello"}',
      '{"t":"hello","guestId":"abcdefgh12","name":"Ann"}',
      '{"t":"create","name":"Ann","settings":{"seats":2,"society":3}}',
      '{"t":"join","code":"abcdef","name":"Bob"}',
      '{"t":"resume","code":"ABCDEF","token":"abcdefghijklmnopqrstu"}',
      '{"t":"settings","settings":{"extraPack":true,"advisors":[null,"ADV_HEALTH"]}}',
      '{"t":"ready","ready":true}',
      '{"t":"start"}',
      '{"t":"answer","pendingId":3,"pick":["a"]}',
      '{"t":"chat","text":"hi"}',
      '{"t":"leave"}',
      '{"t":"ping","ts":5}',
    ];
    for (const f of frames) {
      const r = parseClientMessage(f);
      expect(r, f).toMatchObject({ ok: true });
    }
  });

  it('upper-cases room codes and cleans names', () => {
    const r = parseClientMessage('{"t":"join","code":" abcdef ","name":"  Ann\\u0007   Lee "}');
    expect(r).toEqual({ ok: true, value: { t: 'join', code: 'ABCDEF', name: 'Ann Lee' } });
  });

  it('rejects malformed frames with a reason', () => {
    const bad: [string, RegExp][] = [
      ['not json', /not valid JSON/],
      ['[]', /JSON object/],
      ['{"t":"explode"}', /unknown message type/],
      ['{"t":"join","code":"ABCIOD","name":"x"}', /code/],
      ['{"t":"join","code":"ABC","name":"x"}', /code/],
      ['{"t":"resume","code":"ABCDEF","token":"x"}', /token/],
      ['{"t":"hello","guestId":"bad id!"}', /guestId/],
      ['{"t":"settings","settings":{"seats":5}}', /seats/],
      ['{"t":"settings","settings":{"colour":"red"}}', /unknown setting/],
      ['{"t":"settings","settings":{"scenario":"moon"}}', /scenario/],
      ['{"t":"settings","settings":{"difficulty":"easy"}}', /difficulty/],
      ['{"t":"settings","settings":{"society":7}}', /society/],
      ['{"t":"settings","settings":{"seed":-1}}', /seed/],
      ['{"t":"settings","settings":{"advisors":[1]}}', /advisor/],
      ['{"t":"settings","settings":{"advisors":[null,null,null,null,null]}}', /at most 4/],
      ['{"t":"answer","pendingId":-1,"pick":[]}', /pendingId/],
      ['{"t":"answer","pendingId":1,"pick":"a"}', /pick/],
      ['{"t":"chat","text":"   "}', /chat text/],
      ['{"t":"ready","ready":"yes"}', /boolean/],
    ];
    for (const [frame, re] of bad) {
      const r = parseClientMessage(frame);
      expect(r.ok, frame).toBe(false);
      if (!r.ok) expect(r.message, frame).toMatch(re);
    }
  });
});

describe('parseSettingsPatch', () => {
  it('returns only the keys that were sent', () => {
    expect(parseSettingsPatch({ society: 6 })).toEqual({ ok: true, value: { society: 6 } });
  });
  it('accepts null advisors and short strings', () => {
    expect(parseSettingsPatch({ advisors: [null, 'ADV_SOCIAL'] })).toEqual({ ok: true, value: { advisors: [null, 'ADV_SOCIAL'] } });
  });
});

describe('text helpers', () => {
  it('normalizeCode accepts only six letters without I or O', () => {
    expect(normalizeCode('abcdef')).toBe('ABCDEF');
    expect(normalizeCode('ABCDIO')).toBeNull();
    expect(normalizeCode('ABCDE1')).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });
  it('cleanText strips control characters and clamps length', () => {
    expect(cleanText('a\tb\nc', 10)).toBe('a b c');
    expect(cleanText('x'.repeat(50), 5)).toBe('xxxxx');
  });
  it('cleanName falls back to Guest', () => {
    expect(cleanName('   ')).toBe('Guest');
    expect(cleanName('Ann')).toBe('Ann');
  });
});

describe('TokenBucket', () => {
  it('allows a burst, refuses when empty, and refills over time', () => {
    let t = 0;
    const b = new TokenBucket(3, 2, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    t += 500; // one token back at 2/s
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    t += 10_000; // refill is capped at capacity
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });
});
