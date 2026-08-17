import { describe, expect, it } from 'vitest';
import {
  isOfflineUrl,
  offlineAppUrl,
  offlineIdFromUrl,
  offlinePlaylistUrl,
  offlineSegmentUrl,
  parseOfflineHlsUrl,
} from './offlineUrls';

describe('offline app URLs', () => {
  it('round-trips a download id', () => {
    const url = offlineAppUrl('abc-123');
    expect(url).toBe('offline:abc-123');
    expect(isOfflineUrl(url)).toBe(true);
    expect(offlineIdFromUrl(url)).toBe('abc-123');
  });

  it('rejects non-offline urls', () => {
    expect(isOfflineUrl('/transcode.m3u8?url=https%3A%2F%2Fx')).toBe(false);
    expect(isOfflineUrl(null)).toBe(false);
    expect(isOfflineUrl(undefined)).toBe(false);
    expect(offlineIdFromUrl('https://example.com/a.m3u8')).toBeNull();
  });

  it('treats an empty id as not a download', () => {
    expect(offlineIdFromUrl('offline:')).toBeNull();
    expect(offlineIdFromUrl('offline:   ')).toBeNull();
  });
});

describe('offline hls URLs', () => {
  it('parses the playlist url', () => {
    expect(parseOfflineHlsUrl(offlinePlaylistUrl('abc'))).toEqual({
      downloadId: 'abc',
      segment: null,
    });
  });

  it('parses segment urls', () => {
    expect(parseOfflineHlsUrl(offlineSegmentUrl('abc', 0))).toEqual({
      downloadId: 'abc',
      segment: 0,
    });
    expect(parseOfflineHlsUrl(offlineSegmentUrl('abc', 1207))).toEqual({
      downloadId: 'abc',
      segment: 1207,
    });
  });

  // The whole reason the internal URLs are real https URLs: hls.js resolves
  // each playlist entry against the playlist's own URL. If this breaks,
  // offline playback dies with a URL-parse error instead of loading segments.
  it('resolves a relative segment uri against the playlist url the way hls.js does', () => {
    const resolved = new URL('42.ts', offlinePlaylistUrl('abc')).toString();
    expect(parseOfflineHlsUrl(resolved)).toEqual({ downloadId: 'abc', segment: 42 });
  });

  it('survives ids that need percent-encoding', () => {
    const id = 'tt123 s1e2/720p';
    expect(parseOfflineHlsUrl(offlineSegmentUrl(id, 3))).toEqual({ downloadId: id, segment: 3 });
  });

  it('returns null for foreign urls so the loader falls back to the network', () => {
    expect(parseOfflineHlsUrl('https://example.com/abc/1.ts')).toBeNull();
    expect(parseOfflineHlsUrl('/transcode-seg?url=x&n=1')).toBeNull();
    expect(parseOfflineHlsUrl('https://offline.blissful.invalid/abc/1.mp4')).toBeNull();
    expect(parseOfflineHlsUrl('https://offline.blissful.invalid/abc')).toBeNull();
    expect(parseOfflineHlsUrl('not a url at all')).toBeNull();
  });
});
