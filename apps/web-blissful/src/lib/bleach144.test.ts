import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeRankInfos,
  rankReleases,
  scoreProbedRelease,
  type ProbeScore,
  type ProbePrefs,
} from './releaseRanking';
import { probeFirstTimePick, selectProbeCandidates } from './releaseProbe';
import {
  ANIMERG_480,
  ANIME_TIME,
  ANIME_TIME_HASH,
  ANIME_TIME_PROBE,
  EXPECTED_144,
  ERAI,
  JUDAS,
  JUDAS_HASH,
  JUDAS_PROBE,
  PROBE_BY_HASH,
  WRONG_EPISODE,
  describeBleach,
  type Bleach144Stream,
} from './bleach144.fixture';

const PREFS: ProbePrefs = { audioLanguage: 'eng', subtitlesLanguage: 'eng' };
const ctx = { expected: EXPECTED_144 };

const scoreOf = (s: Bleach144Stream, probe = PROBE_BY_HASH[s.infoHash]) =>
  scoreProbedRelease({ ...probe, name: `${s.name} ${s.title}` }, PREFS);

describe('Bleach 144 ranking: the probe decides, the episode text only filters', () => {
  it('scores the real Anime Time probe above the Judas pack', () => {
    expect(compareScores(scoreOf(ANIME_TIME), scoreOf(JUDAS))).toBeGreaterThan(0);
  });

  it('gives the [Judas] file a higher episode score than Anime Time, so only the probe can lift Anime Time', () => {
    const [judas, anime] = computeRankInfos([JUDAS, ANIME_TIME], describeBleach, ctx);
    expect(judas.episode).toBeGreaterThanOrEqual(anime.episode);
    expect(judas.episode).toBeGreaterThan(0);
    expect(rankReleases([ANIME_TIME, JUDAS], describeBleach, ctx)[0]).toBe(JUDAS);
  });

  it('lets the probe beat the higher episode score of [Judas] 144', () => {
    const probeScores = new Map<string, ProbeScore>([
      [ANIME_TIME.url, scoreOf(ANIME_TIME)],
      [JUDAS.url, scoreOf(JUDAS)],
    ]);
    expect(rankReleases([JUDAS, ANIME_TIME], describeBleach, { ...ctx, probeScores })[0]).toBe(ANIME_TIME);
    expect(rankReleases([ANIME_TIME, JUDAS], describeBleach, { ...ctx, probeScores })[0]).toBe(ANIME_TIME);
  });

  it('still sinks a release that names another episode, however well it probes', () => {
    const probeScores = new Map<string, ProbeScore>([
      [WRONG_EPISODE.url, [1, 3, 1, 1, 99, 1]],
      [ANIME_TIME.url, scoreOf(ANIME_TIME)],
      [JUDAS.url, scoreOf(JUDAS)],
    ]);
    const out = rankReleases([WRONG_EPISODE, JUDAS, ANIME_TIME], describeBleach, { ...ctx, probeScores });
    expect(out.map((s) => s.infoHash)).toEqual([ANIME_TIME.infoHash, JUDAS.infoHash, WRONG_EPISODE.infoHash]);
    const [info] = computeRankInfos([WRONG_EPISODE], describeBleach, ctx);
    expect(info.contradicts).toBe(true);
  });

  it('sinks an explicit 480p batch below the 1080p releases whatever it probes as', () => {
    const probeScores = new Map<string, ProbeScore>([[ANIMERG_480.url, [1, 3, 1, 0, 99, 1]]]);
    const out = rankReleases([ANIMERG_480, ERAI], describeBleach, { ...ctx, probeScores });
    expect(out[0]).toBe(ERAI);
  });

  it('keeps a hand-picked pack above the probe', () => {
    const probeScores = new Map<string, ProbeScore>([
      [ANIME_TIME.url, scoreOf(ANIME_TIME)],
      [JUDAS.url, scoreOf(JUDAS)],
    ]);
    const out = rankReleases([ANIME_TIME, JUDAS], describeBleach, {
      ...ctx,
      probeScores,
      rememberedInfohash: JUDAS_HASH,
    });
    expect(out[0]).toBe(JUDAS);
  });

  it('lifts a Comet-only [RD⚡] listing of a torrent Torrentio lists as [RD+]', () => {
    const comet = { ...ANIME_TIME, name: '[RD⚡] Comet\n1080p', url: 'https://comet.example/playback/abc' };
    const [c] = computeRankInfos([comet, ANIME_TIME], describeBleach, ctx);
    expect(c.tier).toBe(0);
  });
});

describe('selectProbeCandidates', () => {
  const cachedRow = (title: string, hash: string, q = '1080p'): Bleach144Stream => ({
    name: `[RD+] Torrentio\n${q}`,
    title,
    infoHash: hash,
    url: `https://torrentio.strem.fun/resolve/realdebrid/KEY/${hash}/null/0/f.mkv`,
  });
  const h = (n: number) => String(n).repeat(40);

  it('does not use the episode score: an episode-marked 720p is not picked over five 1080p releases', () => {
    const rows = [
      cachedRow('Show A\nfile-a.mkv', h(1)),
      cachedRow('Show B\nfile-b.mkv', h(2)),
      cachedRow('Show C\nfile-c.mkv', h(3)),
      cachedRow('Show D\nfile-d.mkv', h(4)),
      cachedRow('Show E\nfile-e.mkv', h(5)),
      cachedRow('Bleach 720p\nBleach - 144 - Ishida.mkv', h(6), '720p'),
    ];
    const { picks, skipped } = selectProbeCandidates(rows, describeBleach, ctx);
    expect(skipped).toBeNull();
    expect(picks.map((p) => p.item.infoHash)).toEqual([h(1), h(2), h(3), h(4)]);
    // The old head compare put the 720p first on its episode score.
    expect(rankReleases(rows, describeBleach, ctx)[0].infoHash).toBe(h(6));
  });

  it('always adds pack-named releases and the best 1080p+ one', () => {
    const rows = [
      cachedRow('a\na.mkv', h(1), '720p'),
      cachedRow('b\nb.mkv', h(2), '720p'),
      cachedRow('c\nc.mkv', h(3), '720p'),
      cachedRow('d\nd.mkv', h(4), '720p'),
      cachedRow('[Anime Time] Complete [Disney+ BD][HEVC]\nx.mkv', h(5), '720p'),
      cachedRow('plain 1080p\ny.mkv', h(6), '1080p'),
    ];
    const picks = selectProbeCandidates(rows, describeBleach, ctx).picks.map((p) => p.item.infoHash);
    expect(picks).toContain(h(5));
    expect(picks).toContain(h(6));
    expect(picks.length).toBeLessThanOrEqual(8);
  });

  it('leaves out contradicting and explicit low-res releases', () => {
    const picks = selectProbeCandidates([WRONG_EPISODE, ANIMERG_480, ANIME_TIME, JUDAS], describeBleach, ctx).picks;
    expect(picks.map((p) => p.item.infoHash).sort()).toEqual([ANIME_TIME.infoHash, JUDAS.infoHash].sort());
  });

  it('says why it skips', () => {
    expect(selectProbeCandidates([ANIME_TIME], describeBleach, ctx).skipped).toMatch(/^fewer-than-2-cached/);
    expect(
      selectProbeCandidates([ANIME_TIME, JUDAS], describeBleach, { ...ctx, rememberedInfohash: JUDAS_HASH }).skipped,
    ).toBe('hand-picked-pack');
    expect(
      selectProbeCandidates([ANIME_TIME, JUDAS], describeBleach, { ...ctx, savedInfohash: ANIME_TIME_HASH }).skipped,
    ).toBe('saved-for-episode');
  });
});

describe('probeFirstTimePick with the Bleach 144 list', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubProxy() {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      calls.push(input);
      const u = decodeURIComponent(input);
      const hash = Object.keys(PROBE_BY_HASH).find((k) => u.includes(k));
      const probe = hash ? PROBE_BY_HASH[hash] : null;
      if (input.startsWith('/probe-streams')) {
        if (!probe) return { ok: false, status: 404 };
        return {
          ok: true,
          json: async () => ({
            subtitles: probe.subs.map((s, index) => ({ index, language: s.lang, title: s.title, textBased: s.textBased })),
            video: { height: probe.height },
          }),
        };
      }
      if (input.startsWith('/transcode-audio')) {
        return { ok: true, json: async () => ({ tracks: (probe?.audio ?? []).map((a) => ({ lang: a.lang, title: a.title })) }) };
      }
      return { ok: false, status: 404 };
    });
    return calls;
  }

  it('probes both packs and makes Anime Time the top pick', async () => {
    stubProxy();
    const items = [JUDAS, ANIME_TIME, ERAI, ANIMERG_480];
    const first = await probeFirstTimePick(items, describeBleach, ctx, PREFS);
    expect(first.skipped).toBeNull();
    const names = first.probed.map((p) => p.name);
    expect(names.some((n) => n.includes('Bleach Complete Pack'))).toBe(true);
    expect(names.some((n) => n.includes('[Anime Time]'))).toBe(true);
    expect(first.scores.get(ANIME_TIME.url)).toEqual(scoreProbedRelease({ ...ANIME_TIME_PROBE, name: `${ANIME_TIME.name} ${ANIME_TIME.title}` }, PREFS));
    expect(first.scores.get(JUDAS.url)).toEqual(scoreProbedRelease({ ...JUDAS_PROBE, name: `${JUDAS.name} ${JUDAS.title}` }, PREFS));
    const ordered = rankReleases(items, describeBleach, { ...ctx, probeScores: first.scores });
    expect(ordered[0]).toBe(ANIME_TIME);
  });

  it('returns a reason instead of probing when a hand-picked pack decides', async () => {
    const calls = stubProxy();
    const first = await probeFirstTimePick([ANIME_TIME, JUDAS], describeBleach, { ...ctx, rememberedInfohash: JUDAS_HASH }, PREFS);
    expect(first.skipped).toBe('hand-picked-pack');
    expect(first.probed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('confirms an [RD⚡] listing against Real-Debrid and then probes it', async () => {
    const calls: string[] = [];
    const comet = { ...ANIME_TIME, name: '[RD⚡] Comet\n1080p' };
    vi.stubGlobal('fetch', async (input: string) => {
      calls.push(input);
      if (input.startsWith('/rd-by-hash')) return { ok: input.includes(ANIME_TIME_HASH) };
      if (input.startsWith('/probe-streams')) return { ok: true, json: async () => ({ subtitles: [], video: { height: 1080 } }) };
      return { ok: true, json: async () => ({ tracks: [] }) };
    });
    const first = await probeFirstTimePick([JUDAS, comet], describeBleach, ctx, PREFS);
    expect(first.cachedInfohashes.has(ANIME_TIME_HASH)).toBe(true);
    expect(first.skipped).toBeNull();
    expect(calls.some((c) => c.startsWith('/rd-by-hash'))).toBe(true);
  });
});

function compareScores(a: ProbeScore, b: ProbeScore): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
