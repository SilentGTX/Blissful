import { describe, it, expect } from 'vitest';
import {
  extractInfohash,
  isCachedRelease,
  isUncachedRelease,
  releaseCacheTier,
  scoreReleaseForAutoPick,
} from './rdCache';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

describe('cache markers', () => {
  it('reads Torrentio cached / not-cached markers', () => {
    expect(isCachedRelease('[RD+] Torrentio 1080p')).toBe(true);
    expect(isUncachedRelease('[RD download] Torrentio 1080p')).toBe(true);
    expect(isUncachedRelease('[RD↓] Torrentio')).toBe(true);
    expect(isUncachedRelease('[RD ⏳] Comet unknown')).toBe(true);
  });

  it("treats Comet's claimed-cached flag as unknown, not cached", () => {
    // RD dropped /instantAvailability, so Comet's ⚡ is a stale public guess.
    expect(releaseCacheTier('[RD⚡] Comet 1080p')).toBe('unknown');
    expect(releaseCacheTier('[RD+] Torrentio 1080p')).toBe('cached');
    expect(releaseCacheTier('[RD ⏳] Comet unknown')).toBe('uncached');
  });
});

describe('scoreReleaseForAutoPick', () => {
  const score = (name: string, extra: Partial<Parameters<typeof scoreReleaseForAutoPick>[0]> = {}) =>
    scoreReleaseForAutoPick({ name, ...extra });

  it('puts ANY cached release above an uncached one, even a nicer-looking uncached', () => {
    // The bug this guards: the old ranking weighted codec (1000) above cache
    // (100), so an uncached H.264 beat a cached HEVC and the player sat waiting
    // for RD to download it.
    expect(score('[RD+] Torrentio 4k x265')).toBeGreaterThan(score('[RD download] Torrentio 1080p'));
    expect(score('[RD+] Torrentio 4k x265')).toBeGreaterThan(score('[RD ⏳] Comet unknown'));
  });

  it('prefers the release the user already has progress on — when it is cached', () => {
    const saved = HASH_A;
    const savedCached = score(`[RD+] Torrentio 720p ${HASH_A}`, { url: `https://x/${HASH_A}/f.mkv`, savedInfohash: saved });
    const otherCached = score(`[RD+] Torrentio 1080p ${HASH_B}`, { url: `https://x/${HASH_B}/f.mkv`, savedInfohash: saved });
    expect(savedCached).toBeGreaterThan(otherCached);
  });

  it('does NOT resume an uncached release just because it is the saved one', () => {
    const saved = HASH_A;
    const savedUncached = score('[RD download] Torrentio 1080p', { url: `https://x/${HASH_A}/f.mkv`, savedInfohash: saved });
    const otherCached = score('[RD+] Torrentio 720p', { url: `https://x/${HASH_B}/f.mkv`, savedInfohash: saved });
    expect(otherCached).toBeGreaterThan(savedUncached);
  });

  it('still prefers H.264 and better quality within the same cache tier', () => {
    expect(score('[RD+] Torrentio 1080p')).toBeGreaterThan(score('[RD+] Torrentio 1080p x265'));
    expect(score('[RD+] Torrentio 1080p')).toBeGreaterThan(score('[RD+] Torrentio 2160p'));
  });
});

describe('extractInfohash', () => {
  it('finds the hash in any url shape, case-insensitively', () => {
    expect(extractInfohash(`https://torrentio.strem.fun/resolve/realdebrid/KEY/${HASH_A}/null/0/f.mkv`)).toBe(HASH_A);
    expect(extractInfohash(`magnet:?xt=urn:btih:${HASH_A.toUpperCase()}&dn=x`)).toBe(HASH_A);
    expect(extractInfohash('https://x.download.real-debrid.com/d/ABC123/f.mkv')).toBeNull();
    expect(extractInfohash(null)).toBeNull();
  });
});
