// One ranking for "which release should play", shared by the RD fast path, the
// full fallback, the detail page autoplay and the Releases picker.
//
// Lexicographic, so nothing lower can ever cross a higher rule:
//   1. cache tier         cached > unknown > uncached
//   2. remembered pack    the series' remembered infohash, cached, containing the episode
//   3. episode match      scoreEpisodeMatch
//   4. same release       the release last played for THIS episode
//   5. first-time probe   what is actually inside the file (scoreProbedRelease)
//   6. codec              non-HEVC first (tiebreak only)
//   7. quality            1080p > 720p > 2160p > 480p > other, .avi sunk
//
// The old summed weights let a 1,000-point codec bonus outrank quality and
// preference, and dropped every HEVC candidate from the fallback pick outright.

import { releaseCacheTier, extractInfohash, type CacheTier } from './rdCache';
import { scoreEpisodeMatch, type ExpectedEpisode } from './episodeMatch';
import { languageMatch } from './subtitleUtils';

export type ReleaseCandidate = {
  name?: string | null;
  title?: string | null;
  filename?: string | null;
  url?: string | null;
  /** Overrides the name-derived tier (the picker also knows live RD checks). */
  cacheTier?: CacheTier;
};

/** Tuple compared lexicographically; higher is better. */
export type ProbeScore = readonly number[];

export type RankContext = {
  expected?: ExpectedEpisode | null;
  /** Infohash remembered for this series (see seriesReleaseMemory). */
  rememberedInfohash?: string | null;
  /** Infohash of the release last played for this exact episode. */
  savedInfohash?: string | null;
  /** First-time probe results, keyed by candidate url. Absent = unprobed. */
  probeScores?: ReadonlyMap<string, ProbeScore>;
};

export type RankInfo = {
  /** 0 = cached, 1 = unknown, 2 = uncached. */
  tier: 0 | 1 | 2;
  remembered: boolean;
  episode: number;
  saved: boolean;
  probe: ProbeScore | null;
  hevc: boolean;
  quality: number;
};

const HEVC_RE = /(^|[^a-z])(x265|h\.?265|hevc)([^a-z]|$)/i;

function tierIndex(tier: CacheTier): 0 | 1 | 2 {
  return tier === 'cached' ? 0 : tier === 'unknown' ? 1 : 2;
}

function qualityPoints(hay: string, all: string): number {
  let q: number;
  if (/1080p/i.test(hay)) q = 100;
  else if (/720p/i.test(hay)) q = 85;
  else if (/2160p|4k/i.test(hay)) q = 65;
  else if (/480p/i.test(hay)) q = 50;
  else q = 40;
  // .avi (XviD / old fansub) is the flakiest thing to transcode. Sunk, not excluded:
  // some old anime episodes only exist as an .avi rip.
  if (/\.avi(\b|$)/i.test(all)) q -= 45;
  return q;
}

/** Rank keys for every candidate, index-aligned with `items`. */
export function computeRankInfos<T>(
  items: readonly T[],
  describe: (item: T) => ReleaseCandidate,
  ctx: RankContext,
): RankInfo[] {
  const cands = items.map(describe);
  const tiers = cands.map((c) => tierIndex(c.cacheTier ?? releaseCacheTier(c.name)));
  const episodes = cands.map((c) =>
    scoreEpisodeMatch(`${c.name ?? ''} ${c.title ?? ''} ${c.filename ?? ''}`, ctx.expected),
  );
  const remembered = ctx.rememberedInfohash ?? null;

  return cands.map((c, i) => {
    let isRemembered = false;
    if (remembered && tiers[i] === 0 && extractInfohash(c.url) === remembered) {
      // "Has the episode": as good as anything else cached. A pack whose file names
      // carry no markers still wins when nobody proves a better match, but one that
      // contradicts the episode loses to a cached release that matches it.
      let bestOther = 0;
      for (let j = 0; j < cands.length; j += 1) {
        if (j !== i && tiers[j] === 0 && episodes[j] > bestOther) bestOther = episodes[j];
      }
      isRemembered = episodes[i] >= bestOther;
    }
    const hay = `${c.name ?? ''} ${c.title ?? ''} ${c.filename ?? ''}`;
    return {
      tier: tiers[i],
      remembered: isRemembered,
      episode: episodes[i],
      saved: !!ctx.savedInfohash && extractInfohash(c.url) === ctx.savedInfohash,
      probe: (c.url ? ctx.probeScores?.get(c.url) : null) ?? null,
      hevc: HEVC_RE.test(hay),
      quality: qualityPoints(hay, `${hay} ${c.url ?? ''}`),
    };
  });
}

export function compareProbeScores(a: ProbeScore | null, b: ProbeScore | null): number {
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i += 1) {
    const d = (b?.[i] ?? 0) - (a?.[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Rules 1-3. Negative = `a` first. */
export function compareRankHead(a: RankInfo, b: RankInfo): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.remembered !== b.remembered) return a.remembered ? -1 : 1;
  return b.episode - a.episode;
}

/** All seven rules. Negative = `a` first. */
export function compareRankInfo(a: RankInfo, b: RankInfo): number {
  const head = compareRankHead(a, b);
  if (head !== 0) return head;
  if (a.saved !== b.saved) return a.saved ? -1 : 1;
  const probe = compareProbeScores(a.probe, b.probe);
  if (probe !== 0) return probe;
  if (a.hevc !== b.hevc) return a.hevc ? 1 : -1;
  return b.quality - a.quality;
}

/** Best first. Stable: equal candidates keep their incoming order. */
export function rankReleases<T>(
  items: readonly T[],
  describe: (item: T) => ReleaseCandidate,
  ctx: RankContext,
): T[] {
  const infos = computeRankInfos(items, describe, ctx);
  return items
    .map((item, i) => ({ item, info: infos[i], i }))
    .sort((x, y) => compareRankInfo(x.info, y.info) || x.i - y.i)
    .map((x) => x.item);
}

// ── First-time probe scoring ────────────────────────────────────────────────

export type ReleaseProbe = {
  audio: Array<{ lang: string | null; title?: string | null }>;
  subs: Array<{ lang: string | null; title?: string | null; textBased: boolean }>;
  height: number | null;
  name?: string | null;
};

export type ProbePrefs = {
  /** Preferred audio language (effectiveAudioLanguage), or null for none. */
  audioLanguage: string | null;
  /** Preferred subtitle language, or null for none. */
  subtitlesLanguage: string | null;
};

const PACK_MARKERS_RE = /\b(?:BD|Blu-?ray|BDRip|Complete|Batch)\b/i;
const MAX_PREF_SUBS = 3;

function trackIsLanguage(pref: string | null, t: { lang: string | null; title?: string | null }): boolean {
  return languageMatch(pref, t.lang) || languageMatch(pref, t.title ?? null);
}

/** Pure scoring of what is inside a file, for the pick when nothing is remembered.
 *  Higher is better, compared lexicographically:
 *  preferred-language audio, preferred-language text subs (capped at 3), more
 *  than one audio language, 1080p or better, total text subs, pack-ish name. */
export function scoreProbedRelease(probe: ReleaseProbe, prefs: ProbePrefs): ProbeScore {
  const textSubs = probe.subs.filter((s) => s.textBased);
  const prefAudio = prefs.audioLanguage
    ? probe.audio.some((a) => trackIsLanguage(prefs.audioLanguage, a))
    : false;
  const prefSubs = prefs.subtitlesLanguage
    ? textSubs.filter((s) => trackIsLanguage(prefs.subtitlesLanguage, s)).length
    : 0;
  const audioLangs = new Set(probe.audio.map((a) => (a.lang ?? '').toLowerCase()));
  return [
    prefAudio ? 1 : 0,
    Math.min(prefSubs, MAX_PREF_SUBS),
    audioLangs.size > 1 ? 1 : 0,
    (probe.height ?? 0) >= 1080 ? 1 : 0,
    textSubs.length,
    PACK_MARKERS_RE.test(probe.name ?? '') ? 1 : 0,
  ];
}
