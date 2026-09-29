import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  MAX_REMEMBERED_SERIES,
  getRememberedPack,
  rememberPack,
  seriesKeyFor,
  withRememberedPack,
} from './seriesReleaseMemory';
import { writeStoredPlayerSettings, type PlayerSettings } from './playerSettings';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);
const DAY = 24 * 60 * 60 * 1000;

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
}

describe('withRememberedPack', () => {
  it('stores and overwrites per series', () => {
    const one = withRememberedPack(undefined, 'series:tt1', { infohash: HASH_A, name: 'A' }, 10);
    expect(one['series:tt1']).toEqual({ infohash: HASH_A, name: 'A', updatedAt: 10 });
    const two = withRememberedPack(one, 'series:tt1', { infohash: HASH_B, name: 'B' }, 20);
    expect(two['series:tt1'].infohash).toBe(HASH_B);
    expect(one['series:tt1'].infohash).toBe(HASH_A);
  });

  it('drops the oldest entries past the cap', () => {
    let packs = {};
    for (let i = 0; i < MAX_REMEMBERED_SERIES + 5; i += 1) {
      packs = withRememberedPack(packs, `series:s${i}`, { infohash: HASH_A, name: 'x' }, i + 1);
    }
    const keys = Object.keys(packs);
    expect(keys).toHaveLength(MAX_REMEMBERED_SERIES);
    expect(keys).not.toContain('series:s0');
    expect(keys).toContain(`series:s${MAX_REMEMBERED_SERIES + 4}`);
  });
});

describe('rememberPack / getRememberedPack', () => {
  beforeEach(() => { stubLocalStorage(); });

  it('round-trips through the stored player settings', () => {
    const key = seriesKeyFor('series', 'tt1');
    expect(getRememberedPack(key)).toBeNull();
    expect(rememberPack(key, { infohash: HASH_A, name: 'Pack' }, undefined, 1000)).toBe(true);
    expect(getRememberedPack(key)).toEqual({ infohash: HASH_A, name: 'Pack', updatedAt: 1000 });
  });

  it('a manual pick of another release overwrites the pack', () => {
    const key = seriesKeyFor('series', 'tt1');
    rememberPack(key, { infohash: HASH_A, name: 'A' }, undefined, 1000);
    rememberPack(key, { infohash: HASH_B, name: 'B' }, undefined, 2000);
    expect(getRememberedPack(key)?.infohash).toBe(HASH_B);
  });

  it('skips the write for an unchanged, recent pack and refreshes an old one', () => {
    const key = seriesKeyFor('series', 'tt1');
    const persist = vi.fn((next: PlayerSettings) => writeStoredPlayerSettings(next));
    rememberPack(key, { infohash: HASH_A, name: 'A' }, persist, 1000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rememberPack(key, { infohash: HASH_A, name: 'A' }, persist, 1000 + DAY)).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rememberPack(key, { infohash: HASH_A, name: 'A' }, persist, 1000 + 31 * DAY)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('hands the full next settings to persist (so it syncs) without touching other fields', () => {
    const key = seriesKeyFor('series', 'tt1');
    const persist = vi.fn();
    rememberPack(key, { infohash: HASH_A, name: 'A' }, persist, 1000);
    const next = persist.mock.calls[0][0];
    expect(next.seriesReleasePacks[key].infohash).toBe(HASH_A);
    expect(next.subtitlesLanguage).toBeDefined();
  });
});
