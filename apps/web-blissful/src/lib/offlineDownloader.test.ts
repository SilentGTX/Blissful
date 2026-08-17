import { describe, expect, it } from 'vitest';
import { parseTranscodePlaylist } from './offlineDownloader';

// The playlist is the contract between the proxy and the download: a mis-paired
// #EXTINF and URI shifts every segment's duration, which shows up as audio
// desync near the end of an offline movie rather than as a load failure.
describe('parseTranscodePlaylist', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXTINF:6.000,',
    '/transcode-seg?url=https%3A%2F%2Fx%2Fa.mkv&n=0&q=720p',
    '#EXTINF:6.000,',
    '/transcode-seg?url=https%3A%2F%2Fx%2Fa.mkv&n=1&q=720p',
    '#EXTINF:2.480,',
    '/transcode-seg?url=https%3A%2F%2Fx%2Fa.mkv&n=2&q=720p',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  it('extracts segments, durations and total duration', () => {
    const parsed = parseTranscodePlaylist(playlist);
    expect(parsed.segmentUrls).toHaveLength(3);
    expect(parsed.segmentDurations).toEqual([6, 6, 2.48]);
    expect(parsed.durationSeconds).toBeCloseTo(14.48, 5);
    expect(parsed.segmentUrls[2]).toContain('n=2');
  });

  it('tolerates CRLF line endings', () => {
    const parsed = parseTranscodePlaylist(playlist.replace(/\n/g, '\r\n'));
    expect(parsed.segmentUrls).toHaveLength(3);
    expect(parsed.segmentUrls[0]).not.toMatch(/\r/);
  });

  // An added tag between #EXTINF and the URI must not consume the duration.
  it('keeps the duration paired with its uri across unknown tags', () => {
    const withTag = playlist.replace(
      '#EXTINF:6.000,\n/transcode-seg?url=https%3A%2F%2Fx%2Fa.mkv&n=1',
      '#EXTINF:6.000,\n#EXT-X-SOMETHING-NEW:1\n/transcode-seg?url=https%3A%2F%2Fx%2Fa.mkv&n=1'
    );
    const parsed = parseTranscodePlaylist(withTag);
    expect(parsed.segmentDurations).toEqual([6, 6, 2.48]);
    expect(parsed.segmentUrls[1]).toContain('n=1');
  });

  it('returns nothing for an empty or tag-only playlist', () => {
    expect(parseTranscodePlaylist('').segmentUrls).toEqual([]);
    expect(parseTranscodePlaylist('#EXTM3U\n#EXT-X-ENDLIST\n').segmentUrls).toEqual([]);
  });
});
