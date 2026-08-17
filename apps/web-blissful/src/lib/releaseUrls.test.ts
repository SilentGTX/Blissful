import { describe, expect, it } from 'vitest';
import { isPlaceholderUrl } from './releaseUrls';

describe('isPlaceholderUrl', () => {
  it('rejects torrentio failure clips', () => {
    // The one seen live, plus the other shapes torrentio serves.
    expect(isPlaceholderUrl('https://torrentio.strem.fun/videos/failed_unexpected_v2.mp4')).toBe(true);
    expect(isPlaceholderUrl('https://torrentio.strem.fun/videos/failed_access_v2.mp4')).toBe(true);
    expect(isPlaceholderUrl('https://torrentio.strem.fun/videos/failed_download_v2.mp4')).toBe(true);
    expect(isPlaceholderUrl('https://torrentio.strem.fun/videos/download_failed.mp4')).toBe(true);
  });

  it('accepts real release links', () => {
    expect(
      isPlaceholderUrl('https://133-4.download.real-debrid.com/d/ADS2CCATAQMS4/Game.of.Thrones.S01E01.1080p.mkv')
    ).toBe(false);
    expect(
      isPlaceholderUrl('https://torrentio.strem.fun/realdebrid/KEY/resolve/hash/null/1/Show.S01E01.mkv')
    ).toBe(false);
    // A release whose own filename happens to contain the word — the guard is
    // scoped to torrentio's /videos/ path, so this must survive.
    expect(isPlaceholderUrl('https://cdn.example.com/d/AAA/Failed.To.Launch.2006.1080p.mkv')).toBe(false);
  });
});
