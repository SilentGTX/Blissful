import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  MAX_REMEMBERED_SERIES,
  getRememberedPack,
  packRememberLine,
  rememberManualPick,
  rememberPack,
  rememberedInfohashFrom,
  resolvePlayingRelease,
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
    expect(one['series:tt1']).toEqual({ infohash: HASH_A, name: 'A', updatedAt: 10, source: 'manual' });
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
    expect(rememberPack(key, { infohash: HASH_A, name: 'Pack', source: 'manual' }, undefined, 1000)).toBe(true);
    expect(getRememberedPack(key)).toEqual({ infohash: HASH_A, name: 'Pack', updatedAt: 1000, source: 'manual' });
  });

  it('a manual pick of another release overwrites the pack', () => {
    const key = seriesKeyFor('series', 'tt1');
    rememberPack(key, { infohash: HASH_A, name: 'A', source: 'manual' }, undefined, 1000);
    rememberPack(key, { infohash: HASH_B, name: 'B', source: 'manual' }, undefined, 2000);
    expect(getRememberedPack(key)?.infohash).toBe(HASH_B);
  });

  it('skips the write for an unchanged, recent pack and refreshes an old one', () => {
    const key = seriesKeyFor('series', 'tt1');
    const persist = vi.fn((next: PlayerSettings) => writeStoredPlayerSettings(next));
    rememberPack(key, { infohash: HASH_A, name: 'A', source: 'manual' }, persist, 1000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rememberPack(key, { infohash: HASH_A, name: 'A', source: 'manual' }, persist, 1000 + DAY)).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rememberPack(key, { infohash: HASH_A, name: 'A', source: 'manual' }, persist, 1000 + 31 * DAY)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('hands the full next settings to persist (so it syncs) without touching other fields', () => {
    const key = seriesKeyFor('series', 'tt1');
    const persist = vi.fn();
    rememberPack(key, { infohash: HASH_A, name: 'A', source: 'manual' }, persist, 1000);
    const next = persist.mock.calls[0][0];
    expect(next.seriesReleasePacks[key].infohash).toBe(HASH_A);
    expect(next.subtitlesLanguage).toBeDefined();
  });
});

describe('manual-only memory', () => {
  beforeEach(() => { stubLocalStorage(); });

  it('an auto-pick never writes and never overwrites a hand pick', () => {
    const key = seriesKeyFor('series', 'kitsu:244');
    const persist = vi.fn();
    expect(rememberPack(key, { infohash: HASH_A, name: 'A', source: 'auto' }, persist, 1000)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(getRememberedPack(key)).toBeNull();

    rememberPack(key, { infohash: HASH_A, name: 'Judas', source: 'manual' }, undefined, 1000);
    expect(rememberPack(key, { infohash: HASH_B, name: 'Anime Time', source: 'auto' }, undefined, 2000)).toBe(false);
    expect(getRememberedPack(key)?.infohash).toBe(HASH_A);
  });

  it('ignores stored entries that are not marked as a hand pick', () => {
    const key = seriesKeyFor('series', 'kitsu:244');
    const legacy = { infohash: HASH_A, name: 'old auto write', updatedAt: 5 };
    writeStoredPlayerSettings({
      ...({} as PlayerSettings),
      seriesReleasePacks: { [key]: legacy },
    } as PlayerSettings);
    expect(getRememberedPack(key)).toBeNull();
    expect(rememberedInfohashFrom({ [key]: legacy }, key)).toBeNull();
    expect(rememberedInfohashFrom({ [key]: { ...legacy, source: 'manual' } }, key)).toBe(HASH_A);
    expect(rememberedInfohashFrom(undefined, key)).toBeNull();
  });
});

describe('resolvePlayingRelease', () => {
  const RAW = `https://torrentio.strem.fun/resolve/realdebrid/KEY/${HASH_A}/null/0/f.mkv`;
  const WRAPPED = `/transcode.m3u8?url=${encodeURIComponent(RAW)}&alang=eng`;
  const releases = [
    { url: RAW, torrentName: 'Anime Time pack' },
    { url: `https://torrentio.strem.fun/resolve/realdebrid/KEY/${HASH_B}/null/0/f.mkv`, torrentName: 'Other' },
  ];

  it('resolves the release from the raw selectedReleaseUrl', () => {
    const r = resolvePlayingRelease(releases, RAW);
    expect(r.release).toBe(releases[0]);
    expect(r.infohash).toBe(HASH_A);
    expect(r.name).toBe('Anime Time pack');
  });

  it('still gets the infohash out of the wrapped transcode url, though it matches no row by url', () => {
    const r = resolvePlayingRelease(releases, WRAPPED);
    expect(r.infohash).toBe(HASH_A);
    expect(r.release).toBe(releases[0]);
  });

  it('falls back to the row infoHash for url shapes without a hash (house /rd-fallback)', () => {
    const house = { url: 'https://real-debrid.com/d/ABCDEF', infoHash: HASH_B, name: 'House' };
    const r = resolvePlayingRelease([house], house.url);
    expect(r.release).toBe(house);
    expect(r.infohash).toBe(HASH_B);
    expect(r.name).toBe('House');
  });

  it('returns nothing without a url', () => {
    expect(resolvePlayingRelease(releases, null)).toEqual({ release: null, infohash: null, name: '' });
  });
});

describe('rememberManualPick', () => {
  beforeEach(() => { stubLocalStorage(); });
  const RAW = `https://torrentio.strem.fun/resolve/realdebrid/KEY/${HASH_A}/null/0/f.mkv`;
  const releases = [{ url: RAW, torrentName: 'Judas pack' }];

  it('writes a hand pick on a series and logs it', () => {
    const log = vi.fn();
    expect(rememberManualPick({ type: 'series', id: 'kitsu:244', releaseUrl: RAW, releases }, undefined, log)).toBe('written');
    expect(getRememberedPack('series:kitsu:244')).toMatchObject({ infohash: HASH_A, name: 'Judas pack', source: 'manual' });
    expect(log).toHaveBeenCalledWith(`[player] pack remember key=series:kitsu:244 hash=…${HASH_A.slice(-8)} source=manual result=written`);
  });

  it('skips movies and urls without a hash, and says so', () => {
    const log = vi.fn();
    expect(rememberManualPick({ type: 'movie', id: 'tt1', releaseUrl: RAW, releases }, undefined, log)).toBe('skipped:not-series');
    expect(rememberManualPick({ type: 'series', id: 'tt1', releaseUrl: 'https://x/y.mkv', releases: [] }, undefined, log)).toBe('skipped:no-infohash');
    expect(log).toHaveBeenLastCalledWith(packRememberLine('series:tt1', null, 'manual', 'skipped:no-infohash'));
    expect(getRememberedPack('series:tt1')).toBeNull();
  });
});
