import { describe, expect, it } from 'vitest';
import { bestProbed, isJapanese, rankReleasesForDownload, type ProbedRelease } from './offlineBatch';
import type { FallbackRelease } from './fallbackReleases';
import type { EmbeddedAudio, EmbeddedSubtitle } from './offlineDownloader';

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

  it('recognises the tag releases actually use for Japanese', () => {
    // `/^ja/` does NOT match `jpn`, which is how every release tags it — that is
    // why a downloaded anime episode came back as the English dub.
    const aud = (lang: string | null, title: string | null = null): EmbeddedAudio =>
      ({ i: 0, lang, title, channels: 2, codec: 'aac' }) as EmbeddedAudio;
    expect(isJapanese(aud('jpn'))).toBe(true);
    expect(isJapanese(aud('ja'))).toBe(true);
    expect(isJapanese(aud('ja-JP'))).toBe(true);
    expect(isJapanese(aud(null, 'Japanese 2.0'))).toBe(true);
    expect(isJapanese(aud('eng'))).toBe(false);
    expect(isJapanese(aud('eng', 'English Dub'))).toBe(false);
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

describe('bestProbed', () => {
  const aud = (i: number, lang: string | null): EmbeddedAudio =>
    ({ i, lang, title: null, channels: 2, codec: 'aac' }) as EmbeddedAudio;
  const sub = (lang: string, textBased: boolean): EmbeddedSubtitle =>
    ({ index: 2, lang, title: null, codec: textBased ? 'subrip' : 'hdmv_pgs_subtitle', textBased }) as EmbeddedSubtitle;
  const probed = (
    url: string,
    audio: EmbeddedAudio[],
    subs: EmbeddedSubtitle[],
    video: ProbedRelease['video'] = { width: 1920, height: 1080, codec: 'h264', bitDepth: 8 }
  ): ProbedRelease => ({
    url,
    audio,
    subs,
    hasJapanese: audio.some(isJapanese),
    hasTextSubs: subs.some((s) => s.textBased && /^en/i.test(s.lang ?? '')),
    video,
  });

  it('prefers a Japanese-only release over a dual-audio one', () => {
    // The real Bleach S1E7 list: jpn-only + English text subs, a DUAL release with
    // image subs, and a dub. A copied file can't switch tracks in Chrome, so
    // jpn-only is the only one that reliably sounds right.
    const best = bestProbed([
      probed('dual.mkv', [aud(0, 'jpn'), aud(1, 'eng')], [sub('eng', false)]),
      probed('jpn-only.mkv', [aud(0, 'jpn')], [sub('eng', true)]),
      probed('dub.mkv', [aud(0, 'eng')], []),
    ]);
    expect(best?.url).toBe('jpn-only.mkv');
  });

  it('takes a dual release over an English-only one', () => {
    const best = bestProbed([
      probed('dub.mkv', [aud(0, 'eng')], [sub('eng', true)]),
      probed('dual.mkv', [aud(0, 'eng'), aud(1, 'jpn')], []),
    ]);
    expect(best?.url).toBe('dual.mkv');
  });

  it('prefers 8-bit over Hi10p when everything else is equal', () => {
    // Only a tiebreak: iOS can't decode 10-bit H.264 at all, so between two
    // otherwise-identical releases the 8-bit one is the better copy to keep.
    const best = bestProbed([
      probed('hi10p.mkv', [aud(0, 'jpn')], [sub('eng', true)], {
        width: 1920, height: 1080, codec: 'h264', bitDepth: 10,
      }),
      probed('8bit.mkv', [aud(0, 'jpn')], [sub('eng', true)], {
        width: 1920, height: 1080, codec: 'h264', bitDepth: 8,
      }),
    ]);
    expect(best?.url).toBe('8bit.mkv');
  });

  it('never lets the codec outweigh audio language', () => {
    const best = bestProbed([
      probed('8bit-dub.mkv', [aud(0, 'eng')], [sub('eng', true)], {
        width: 1920, height: 1080, codec: 'h264', bitDepth: 8,
      }),
      probed('hi10p-jpn.mkv', [aud(0, 'jpn')], [sub('eng', true)], {
        width: 1920, height: 1080, codec: 'h264', bitDepth: 10,
      }),
    ]);
    expect(best?.url).toBe('hi10p-jpn.mkv');
  });

  it('falls back to subtitles when nothing is Japanese', () => {
    // Not anime: no Japanese anywhere, so the tiebreak is text subtitles, then
    // the incoming order (cached, smallest).
    const best = bestProbed([
      probed('no-subs.mkv', [aud(0, 'eng')], []),
      probed('text-subs.mkv', [aud(0, 'eng')], [sub('eng', true)]),
    ]);
    expect(best?.url).toBe('text-subs.mkv');
  });
});
