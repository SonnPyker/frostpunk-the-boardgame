// Environment parsing: CORS_ORIGIN entries are validated and normalised, and SHUTDOWN_GRACE_MS has a sane range.
import { describe, expect, it } from 'vitest';
import { loadConfig, parseCorsOrigins } from '../src/config';

describe('CORS_ORIGIN', () => {
  it('unset or empty allows every origin', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['*']);
    expect(parseCorsOrigins('  ,  ')).toEqual(['*']);
    expect(loadConfig({}).corsOrigins).toEqual(['*']);
  });

  it('accepts origins with or without a trailing slash and normalises them to the browser form', () => {
    expect(parseCorsOrigins('https://frostpunk-web.vercel.app/')).toEqual(['https://frostpunk-web.vercel.app']);
    expect(parseCorsOrigins('https://App.Example:443, http://localhost:5173')).toEqual(['https://app.example', 'http://localhost:5173']);
    expect(parseCorsOrigins('https://a.example,https://a.example/')).toEqual(['https://a.example']);
  });

  it('refuses entries that are not a bare origin, so a typo fails at boot instead of refusing every browser', () => {
    expect(() => parseCorsOrigins('frostpunk-web.vercel.app')).toThrow(/invalid CORS_ORIGIN entry/);
    expect(() => parseCorsOrigins('https://a.example/play')).toThrow(/no path, query or user info/);
    expect(() => parseCorsOrigins('https://a.example?x=1')).toThrow(/no path, query or user info/);
    expect(() => parseCorsOrigins('https://user:pw@a.example')).toThrow(/no path, query or user info/);
    expect(() => parseCorsOrigins('ftp://a.example')).toThrow(/no path, query or user info/);
    expect(() => loadConfig({ CORS_ORIGIN: 'https://ok.example,nope' })).toThrow(/invalid CORS_ORIGIN entry/);
  });

  it('keeps an explicit wildcard', () => {
    expect(parseCorsOrigins('*')).toEqual(['*']);
  });
});

describe('SHUTDOWN_GRACE_MS', () => {
  it('defaults to 20 seconds and accepts values in 1..120 seconds', () => {
    expect(loadConfig({}).shutdownGraceMs).toBe(20_000);
    expect(loadConfig({ SHUTDOWN_GRACE_MS: '45000' }).shutdownGraceMs).toBe(45_000);
  });

  it('rejects values outside the range', () => {
    expect(() => loadConfig({ SHUTDOWN_GRACE_MS: '999' })).toThrow(/invalid integer config value/);
    expect(() => loadConfig({ SHUTDOWN_GRACE_MS: '120001' })).toThrow(/invalid integer config value/);
    expect(() => loadConfig({ SHUTDOWN_GRACE_MS: 'soon' })).toThrow(/invalid integer config value/);
  });
});
