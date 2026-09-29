import { describe, it, expect } from 'vitest';
import {
  extractInfohash,
  isCachedRelease,
  isUncachedRelease,
  releaseCacheTier,
} from './rdCache';

const HASH_A = 'a'.repeat(40);

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

describe('extractInfohash', () => {
  it('finds the hash in any url shape, case-insensitively', () => {
    expect(extractInfohash(`https://torrentio.strem.fun/resolve/realdebrid/KEY/${HASH_A}/null/0/f.mkv`)).toBe(HASH_A);
    expect(extractInfohash(`magnet:?xt=urn:btih:${HASH_A.toUpperCase()}&dn=x`)).toBe(HASH_A);
    expect(extractInfohash('https://x.download.real-debrid.com/d/ABC123/f.mkv')).toBeNull();
    expect(extractInfohash(null)).toBeNull();
  });
});
