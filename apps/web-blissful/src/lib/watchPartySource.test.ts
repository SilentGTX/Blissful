// Tests for the Watch Party v2 source-identity parsers. These decide what a
// host announces and how a guest lands on the SAME file — a regression here
// silently desyncs the room (different cut/offset) or breaks resolution. Keep
// coverage tight around the URL shapes each platform actually plays.

import { describe, expect, it } from 'vitest';
import {
  debridResolveLinkToTorrent,
  desktopPlayingUrlToSource,
  looksLikeRdLink,
  parseVideoIdSeasonEpisode,
  resolveSourceForDesktop,
  resolveSourceForWeb,
  splitRelayUrl,
  torrentToStreamingServerUrl,
  unwrapTranscodeUrl,
  webPlayingToSource,
} from './watchPartySource';

const HASH = 'c9e4f6a1b2c3d4e5f60718293a4b5c6d7e8f9012';

describe('desktopPlayingUrlToSource', () => {
  it('parses a stremio-service torrent URL with trackers', () => {
    const url = `http://127.0.0.1:11470/${HASH}/3?tr=udp%3A%2F%2Fa%3A1%2Fannounce&tr=udp%3A%2F%2Fb%3A2%2Fannounce`;
    expect(desktopPlayingUrlToSource(url)).toEqual({
      kind: 'torrent',
      infoHash: HASH,
      fileIdx: 3,
      trackers: ['udp://a:1/announce', 'udp://b:2/announce'],
    });
  });

  it('parses a torrent URL with no trackers (fileIdx 0)', () => {
    expect(desktopPlayingUrlToSource(`http://127.0.0.1:11470/${HASH}/0`)).toEqual({
      kind: 'torrent',
      infoHash: HASH,
      fileIdx: 0,
      trackers: undefined,
    });
  });

  it('lowercases the infoHash', () => {
    const src = desktopPlayingUrlToSource(`http://127.0.0.1:11470/${HASH.toUpperCase()}/1`);
    expect(src && src.kind === 'torrent' && src.infoHash).toBe(HASH);
  });

  it('parses a magnet link (hash + trackers + fileIdx)', () => {
    const magnet = `magnet:?xt=urn:btih:${HASH.toUpperCase()}&tr=udp%3A%2F%2Fa%3A1%2Fannounce&fileIdx=4`;
    expect(desktopPlayingUrlToSource(magnet)).toEqual({
      kind: 'torrent',
      infoHash: HASH,
      fileIdx: 4,
      trackers: ['udp://a:1/announce'],
    });
  });

  it('parses a magnet link with no fileIdx → null index', () => {
    const src = desktopPlayingUrlToSource(`magnet:?xt=urn:btih:${HASH}`);
    expect(src).toEqual({ kind: 'torrent', infoHash: HASH, fileIdx: null, trackers: undefined });
  });

  it('parses a raw Real-Debrid link as rd', () => {
    const rd = 'https://42-7.download.real-debrid.com/d/ABC/Movie.mkv';
    expect(desktopPlayingUrlToSource(rd)).toEqual({ kind: 'rd', rdUrl: rd });
  });

  // 2026-11-19: a desktop host on a torrentio-RD release announced
  // {kind:'rd', rdUrl:<torrentio link>}; the storage server rejects a non-RD
  // host there, so the room had no source and the guest played the theatrical
  // cut while the host watched the extended one. The link also embeds the
  // host's debrid key, so it must never be announced at all.
  it('turns a debrid resolve link into the torrent inside it, never the link', () => {
    const link = `https://torrentio.strem.fun/resolve/realdebrid/HOSTAPIKEY/${HASH.toUpperCase()}/null/0/Some%20Movie%20EXTENDED%202160p.mkv`;
    const src = desktopPlayingUrlToSource(link);
    expect(src).toEqual({ kind: 'torrent', infoHash: HASH, fileIdx: 0 });
    expect(JSON.stringify(src)).not.toContain('HOSTAPIKEY');
  });

  it('reads the file index from a debrid resolve link (null when unknown)', () => {
    const base = `https://torrentio.strem.fun/resolve/alldebrid/KEY/${HASH}`;
    expect(debridResolveLinkToTorrent(`${base}/null/7/Show.S01E08.mkv`)).toEqual({ kind: 'torrent', infoHash: HASH, fileIdx: 7 });
    expect(debridResolveLinkToTorrent(`${base}/null/undefined/Movie.mkv`)).toEqual({ kind: 'torrent', infoHash: HASH, fileIdx: null });
    expect(debridResolveLinkToTorrent(`${base}/null/2`)).toEqual({ kind: 'torrent', infoHash: HASH, fileIdx: 2 });
    expect(debridResolveLinkToTorrent('https://torrentio.strem.fun/resolve/realdebrid/KEY/nothash/null/0/x.mkv')).toBeNull();
    expect(debridResolveLinkToTorrent('https://42-7.download.real-debrid.com/d/ABC/Movie.mkv')).toBeNull();
    expect(debridResolveLinkToTorrent('not a url')).toBeNull();
  });

  it('returns null for a Vidking placeholder / unknown URL', () => {
    expect(desktopPlayingUrlToSource('vidking:placeholder')).toBeNull();
    expect(desktopPlayingUrlToSource('https://example.com/x.mp4')).toBeNull();
    expect(desktopPlayingUrlToSource('')).toBeNull();
    expect(desktopPlayingUrlToSource(null)).toBeNull();
  });
});

describe('looksLikeRdLink', () => {
  it('matches real-debrid hosts', () => {
    expect(looksLikeRdLink('https://9-3.download.real-debrid.com/d/X/f.mkv')).toBe(true);
    expect(looksLikeRdLink('https://real-debrid.com/d/X')).toBe(true);
    expect(looksLikeRdLink('https://not-real-debrid.com.evil.test/x')).toBe(false);
    expect(looksLikeRdLink('https://example.com/x')).toBe(false);
    expect(looksLikeRdLink('not a url')).toBe(false);
  });

  it('matches torrentio RD resolve links (the release-picker shape)', () => {
    // A host playing a torrentio-RD release must announce `rd`, not `vidking`
    // — misclassifying made pinned guests un-pin back to their own resolve
    // ("guest waits for its own fallback even though the party hosts RD").
    expect(
      looksLikeRdLink('https://torrentio.strem.fun/resolve/realdebrid/KEY/hash/null/0/Show.S01E01.mkv'),
    ).toBe(true);
    // Not an RD resolve path → still not RD.
    expect(looksLikeRdLink('https://torrentio.strem.fun/lite/manifest.json')).toBe(false);
  });
});

describe('unwrapTranscodeUrl', () => {
  it('unwraps the inner url from a transcode wrapper', () => {
    const rd = 'https://9-3.download.real-debrid.com/d/X/f.mkv';
    expect(unwrapTranscodeUrl(`/transcode.m3u8?url=${encodeURIComponent(rd)}`)).toBe(rd);
    expect(unwrapTranscodeUrl(`/transcode?url=${encodeURIComponent(rd)}&start=10`)).toBe(rd);
  });

  it('returns null for non-wrappers', () => {
    expect(unwrapTranscodeUrl('https://example.com/x')).toBeNull();
    expect(unwrapTranscodeUrl('vidking:placeholder')).toBeNull();
  });
});

describe('parseVideoIdSeasonEpisode', () => {
  it('extracts season + episode from a series videoId', () => {
    expect(parseVideoIdSeasonEpisode('tt1234567:2:5')).toEqual({ season: 2, episode: 5 });
  });
  it('is empty for movies / malformed ids', () => {
    expect(parseVideoIdSeasonEpisode('tt1234567')).toEqual({});
    expect(parseVideoIdSeasonEpisode(null)).toEqual({});
  });
});

describe('webPlayingToSource', () => {
  it('reports rd from a transcode wrapper', () => {
    const rd = 'https://9-3.download.real-debrid.com/d/X/f.mkv';
    expect(
      webPlayingToSource({ url: `/transcode.m3u8?url=${encodeURIComponent(rd)}`, tmdbId: 42, type: 'movie', videoId: 'tt1' }),
    ).toEqual({ kind: 'rd', rdUrl: rd });
  });

  it('reports vidking (movie) when on the placeholder with a tmdbId', () => {
    expect(webPlayingToSource({ url: 'vidking:placeholder', tmdbId: 603, type: 'movie', videoId: 'tt0133093' })).toEqual({
      kind: 'vidking',
      tmdbId: 603,
      mediaType: 'movie',
    });
  });

  it('reports vidking (tv) with season/episode', () => {
    expect(webPlayingToSource({ url: 'vidking:placeholder', tmdbId: 1396, type: 'series', videoId: 'tt0903747:2:5' })).toEqual({
      kind: 'vidking',
      tmdbId: 1396,
      mediaType: 'tv',
      season: 2,
      episode: 5,
    });
  });

  it('returns null when on Vidking but the tmdbId is unknown', () => {
    expect(webPlayingToSource({ url: 'vidking:placeholder', tmdbId: null, type: 'movie', videoId: 'tt1' })).toBeNull();
  });
});

describe('torrentToStreamingServerUrl', () => {
  it('builds a 11470 URL with the provided trackers', () => {
    const url = torrentToStreamingServerUrl({ kind: 'torrent', infoHash: HASH, fileIdx: 2, trackers: ['udp://a:1/announce'] });
    expect(url).toBe(`http://127.0.0.1:11470/${HASH}/2?tr=udp%3A%2F%2Fa%3A1%2Fannounce`);
  });

  it('falls back to default trackers when none provided', () => {
    const url = torrentToStreamingServerUrl({ kind: 'torrent', infoHash: HASH, fileIdx: 0 });
    expect(url).toContain(`http://127.0.0.1:11470/${HASH}/0?tr=`);
    expect(url).toContain('opentrackr.org');
  });

  it('returns null without a file index', () => {
    expect(torrentToStreamingServerUrl({ kind: 'torrent', infoHash: HASH, fileIdx: null })).toBeNull();
  });
});

describe('resolveSourceForWeb (non-fetch cases)', () => {
  it('plays a Layer B relay HLS URL directly (pinned)', async () => {
    const url = 'https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?k=xyz';
    expect(await resolveSourceForWeb({ kind: 'relay', url })).toEqual({ url, rdsel: true });
  });

  it('reuses a shared rd link (pinned)', async () => {
    const rdUrl = 'https://x.download.real-debrid.com/d/ABC/file.mkv';
    expect(await resolveSourceForWeb({ kind: 'rd', rdUrl })).toEqual({ url: rdUrl, rdsel: true });
  });

  it('keeps own source for vidking and null (timeline-only)', async () => {
    expect(await resolveSourceForWeb({ kind: 'vidking', tmdbId: 1, mediaType: 'tv' })).toBeNull();
    expect(await resolveSourceForWeb(null)).toBeNull();
  });
});

describe('relay sources (host streams to the room)', () => {
  const relayUrl = 'https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?k=x';

  it('web guest plays the relay itself, never its own copy', async () => {
    const origin = { kind: 'torrent' as const, infoHash: HASH, fileIdx: 0 };
    expect(await resolveSourceForWeb({ kind: 'relay', url: relayUrl, origin })).toEqual({ url: relayUrl, rdsel: true });
  });

  it('desktop guest plays the relay origin natively in mpv', async () => {
    const origin = { kind: 'torrent' as const, infoHash: HASH, fileIdx: 2 };
    const url = await resolveSourceForDesktop({ kind: 'relay', url: relayUrl, origin });
    expect(url?.startsWith(`http://127.0.0.1:11470/${HASH}/2?`)).toBe(true);
  });

  it('desktop guest keeps its own pick for a relay without origin', async () => {
    expect(await resolveSourceForDesktop({ kind: 'relay', url: relayUrl })).toBeNull();
  });
});

describe('splitRelayUrl (the room never receives the host media URL)', () => {
  const media = 'https://torrentio.strem.fun/resolve/realdebrid/HOSTAPIKEY/abc/null/0/Some%20Movie.mkv';
  const hostQuery = new URLSearchParams({ mediaURL: media, maxWidth: '3840' }).toString();
  const relayUrl = `https://blissful.budinoff.com/party-relay/abc-def/hlsv2/blissful-party/master.m3u8?${hostQuery}&k=relaykey`;

  it('keeps only the relay key in the public URL', () => {
    const parts = splitRelayUrl(relayUrl);
    expect(parts?.publicUrl).toBe('https://blissful.budinoff.com/party-relay/abc-def/hlsv2/blissful-party/master.m3u8?k=relaykey');
    expect(parts?.publicUrl).not.toContain('HOSTAPIKEY');
    expect(parts?.publicUrl).not.toContain('mediaURL');
  });

  it('hands the rest to the relay server, byte-for-byte what the shell was given', () => {
    const parts = splitRelayUrl(relayUrl);
    expect(parts?.hostQuery).toBe(hostQuery);
    expect(parts?.configUrl).toBe('https://blissful.budinoff.com/party-relay/abc-def/__config?k=relaykey');
  });

  it('works against a local dev relay', () => {
    const parts = splitRelayUrl(`http://localhost:13000/party-relay/r1/hlsv2/x/master.m3u8?${hostQuery}&k=K`);
    expect(parts?.publicUrl).toBe('http://localhost:13000/party-relay/r1/hlsv2/x/master.m3u8?k=K');
    expect(parts?.configUrl).toBe('http://localhost:13000/party-relay/r1/__config?k=K');
  });

  it('returns null when there is nothing to hide or it is not a relay URL', () => {
    expect(splitRelayUrl('https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?k=K')).toBeNull();
    expect(splitRelayUrl(`https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?${hostQuery}`)).toBeNull();
    expect(splitRelayUrl(`https://example.com/other/master.m3u8?${hostQuery}&k=K`)).toBeNull();
    expect(splitRelayUrl('nope')).toBeNull();
  });
});
