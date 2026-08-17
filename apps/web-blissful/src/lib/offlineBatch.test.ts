import { describe, expect, it } from 'vitest';
import { rankReleasesForDownload } from './offlineBatch';
import type { FallbackRelease } from './fallbackReleases';

const rel = (name: string, size: string, url: string): FallbackRelease =>
  ({ name, size, url, torrentName: name, quality: null }) as unknown as FallbackRelease;

const RD = 'https://100-4.download.real-debrid.com/d/AAA';

describe('rankReleasesForDownload', () => {
  it('picks the smallest release tall enough for the rung', () => {
    const releases = [
      rel('[RD+] Torrentio 2160p', '38 GB', `${RD}/Show.S01E01.2160p.mkv`),
      rel('[RD+] Torrentio 1080p', '3.8 GB', `${RD}/Show.S01E01.1080p.big.mkv`),
      rel('[RD+] Torrentio 1080p', '796 MB', `${RD}/Show.S01E01.1080p.small.mkv`),
      rel('[RD+] Torrentio 720p', '400 MB', `${RD}/Show.S01E01.720p.mkv`),
    ];
    expect(rankReleasesForDownload(releases, '1080p')[0]).toContain('1080p.small');
    expect(rankReleasesForDownload(releases, '720p')[0]).toContain('720p');
    // 4K asked for, 4K delivered — the whole point of the 2160p rung.
    expect(rankReleasesForDownload(releases, '2160p')[0]).toContain('2160p');
  });

  it('falls back to a shorter release when nothing reaches the rung', () => {
    const releases = [rel('[RD+] Torrentio 1080p', '2 GB', `${RD}/Only.1080p.mkv`)];
    expect(rankReleasesForDownload(releases, '2160p')[0]).toContain('Only.1080p');
  });

  it('drops torrentio failure placeholders, however small they look', () => {
    const releases = [
      rel('[RD+] Torrentio 1080p', '2 GB', `${RD}/Show.1080p.mkv`),
      rel('[RD+] Torrentio 1080p', '1 MB', 'https://torrentio.strem.fun/videos/failed_unexpected_v2.mp4'),
    ];
    const ranked = rankReleasesForDownload(releases, '1080p');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toContain('Show.1080p');
  });

  it('prefers cached releases over ones RD has to fetch first', () => {
    const releases = [
      rel('[RD download] Torrentio 1080p', '700 MB', `${RD}/Uncached.1080p.mkv`),
      rel('[RD+] Torrentio 1080p', '4 GB', `${RD}/Cached.1080p.mkv`),
    ];
    expect(rankReleasesForDownload(releases, '1080p')[0]).toContain('Cached');
  });

  it('ignores sources ffmpeg and the browser cannot reach', () => {
    const releases = [
      rel('[RD+] Torrentio 1080p', '2 GB', 'magnet:?xt=urn:btih:abc'),
      rel('[RD+] Torrentio 1080p', '2 GB', 'http://127.0.0.1:11470/stremio-server/x.mkv'),
      rel('[RD+] Torrentio 1080p', '3 GB', `${RD}/Reachable.1080p.mkv`),
    ];
    expect(rankReleasesForDownload(releases, '1080p')).toEqual([`${RD}/Reachable.1080p.mkv`]);
  });
});
