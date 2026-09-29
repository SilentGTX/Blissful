// Looking inside release files (ffprobe on the Mac, through the addon proxy).
// The fetching half of the first-time pick; the scoring half is pure and lives
// in releaseRanking (scoreProbedRelease).

import { fetchAudioTracks, type EmbeddedSubtitle } from './offlineDownloader';
import type { ProbedVideo } from './offlineBatch';
import { extractInfohash } from './rdCache';
import {
  computeRankInfos,
  isPackName,
  scoreProbedRelease,
  type ProbePrefs,
  type ProbeScore,
  type RankContext,
  type ReleaseCandidate,
  type ReleaseProbe,
} from './releaseRanking';

/** Subtitles AND video info from ONE `/probe-streams` call — the same ffprobe the
 *  transcode path uses. Kept together because two calls would ffprobe the same
 *  remote file twice. */
export async function fetchProbe(
  url: string,
  signal?: AbortSignal,
): Promise<{ subs: EmbeddedSubtitle[]; video: ProbedVideo | null }> {
  const res = await fetch(`/probe-streams?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) throw new Error(`probe failed: ${res.status}`);
  const json = (await res.json()) as {
    subtitles?: Array<{
      index: number;
      codec?: string | null;
      language?: string | null;
      title?: string | null;
      textBased?: boolean;
    }>;
    video?: { width?: number; height?: number; codec?: string; bitDepth?: number } | null;
  };
  return {
    subs: (json.subtitles ?? []).map((s) => ({
      index: s.index,
      lang: s.language ?? null,
      title: s.title ?? null,
      codec: s.codec ?? null,
      textBased: s.textBased === true,
    })),
    video: json.video
      ? {
        width: json.video.width ?? null,
        height: json.video.height ?? null,
        codec: json.video.codec ?? null,
        bitDepth: json.video.bitDepth ?? null,
      }
      : null,
  };
}

/** Probe releases in parallel under ONE shared time budget. Releases still
 *  pending when it runs out are simply missing from the result (the caller ranks
 *  them as unprobed). Never throws. */
export async function probeReleasesBatch(
  urls: string[],
  budgetMs: number,
): Promise<Map<string, ReleaseProbe>> {
  const out = new Map<string, ReleaseProbe>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    await Promise.all(
      urls.map(async (url) => {
        try {
          const [probe, audio] = await Promise.all([
            fetchProbe(url, controller.signal),
            fetchAudioTracks(url, controller.signal),
          ]);
          if (controller.signal.aborted) return;
          out.set(url, {
            audio: audio.map((a) => ({ lang: a.lang, title: a.title })),
            subs: probe.subs.map((s) => ({ lang: s.lang, title: s.title, textBased: s.textBased })),
            height: probe.video?.height ?? null,
          });
        } catch {
          // unprobed
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }
  return out;
}

export const FIRST_PICK_PROBE_COUNT = 4;
/** Pack-named and best-HD releases join the top four; this bounds the parallel ffprobes. */
export const FIRST_PICK_PROBE_MAX = 8;
// HEVC 10-bit on RD is slow to ffprobe; 4 s left the 1080p BD unprobed while a
// 480p was scored, and an unprobed candidate scores as all zeros.
export const FIRST_PICK_BUDGET_MS = 8000;
const CACHE_CHECK_BUDGET_MS = 3000;
const CACHE_CHECK_MAX = 4;

export type FirstPickResult = {
  scores: Map<string, ProbeScore>;
  probed: Array<{ name: string; score: ProbeScore | null }>;
  /** Infohashes a live Real-Debrid check confirmed cached; pass on in RankContext. */
  cachedInfohashes: Set<string>;
  /** Why no probe ran, or null when it did. */
  skipped: string | null;
};

/** Live-check unknown-tier releases (Comet's "[RD⚡]" is only a claim) against
 *  Real-Debrid. Resolves to the hashes RD confirms cached; never throws. */
async function confirmCachedHashes(hashes: string[], budgetMs: number): Promise<Set<string>> {
  const out = new Set<string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    await Promise.all(
      hashes.map(async (ih) => {
        try {
          const res = await fetch(`/rd-by-hash?infoHash=${encodeURIComponent(ih)}`, { signal: controller.signal });
          if (res.ok) out.add(ih);
        } catch {
          // unconfirmed
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/**
 * Which cached releases are worth a probe. The episode score plays no part: the
 * candidates are the cached, non-contradicting, non-low-res releases by quality
 * (then non-HEVC, then list order), the top FIRST_PICK_PROBE_COUNT, plus every
 * pack-named release and the best 1080p+ one, up to FIRST_PICK_PROBE_MAX.
 */
export function selectProbeCandidates<T>(
  items: readonly T[],
  describe: (item: T) => ReleaseCandidate,
  ctx: RankContext,
): { picks: Array<{ item: T; cand: ReleaseCandidate }>; skipped: string | null } {
  const infos = computeRankInfos(items, describe, ctx);
  const cached = items
    .map((item, i) => ({ item, info: infos[i], i, cand: describe(item) }))
    .filter((x) => x.info.tier === 0 && !!x.cand.url && !x.info.contradicts && !x.info.lowRes);
  if (cached.length < 2) return { picks: [], skipped: `fewer-than-2-cached(${cached.length})` };
  if (cached.some((x) => x.info.remembered)) return { picks: [], skipped: 'hand-picked-pack' };
  if (cached.some((x) => x.info.saved)) return { picks: [], skipped: 'saved-for-episode' };
  const sorted = cached.sort((a, b) =>
    b.info.quality - a.info.quality
    || (a.info.hevc !== b.info.hevc ? (a.info.hevc ? 1 : -1) : 0)
    || a.i - b.i,
  );
  const top = sorted.slice(0, FIRST_PICK_PROBE_COUNT);
  const rest = sorted.slice(FIRST_PICK_PROBE_COUNT);
  const extras = rest.filter((x) => isPackName(`${x.cand.name ?? ''} ${x.cand.title ?? ''}`));
  const hd = top.some((x) => x.info.hd) ? null : rest.find((x) => x.info.hd);
  if (hd && !extras.includes(hd)) extras.push(hd);
  const picks = [...top, ...extras].slice(0, FIRST_PICK_PROBE_MAX);
  return { picks: picks.map((x) => ({ item: x.item, cand: x.cand })), skipped: null };
}

function releaseLabel(c: ReleaseCandidate): string {
  return (c.title ?? '').split('\n')[0].trim() || c.name || '';
}

/**
 * First-time pick: when no pack was picked by hand for the series (and this exact
 * episode has no saved release), look inside the candidate cached releases and
 * score what they contain. Returns probe scores by url for RankContext.probeScores;
 * `skipped` says why nothing was probed.
 */
export async function probeFirstTimePick<T>(
  items: readonly T[],
  describe: (item: T) => ReleaseCandidate,
  ctx: RankContext,
  prefs: ProbePrefs,
): Promise<FirstPickResult> {
  let rankCtx = ctx;
  let cachedInfohashes = new Set<string>();
  // Unknown-tier releases (Comet [RD⚡]) with a known infohash: ask Real-Debrid, so a
  // pack listed only by such an addon can still be probed and win on content.
  const infos = computeRankInfos(items, describe, ctx);
  const unknownHashes: string[] = [];
  items.forEach((item, i) => {
    if (infos[i].tier !== 1 || unknownHashes.length >= CACHE_CHECK_MAX) return;
    const c = describe(item);
    const h = (c.infohash ?? '').trim().toLowerCase() || extractInfohash(c.url);
    if (h && /^[a-f0-9]{40}$/.test(h) && !unknownHashes.includes(h)) unknownHashes.push(h);
  });
  if (unknownHashes.length) {
    cachedInfohashes = await confirmCachedHashes(unknownHashes, CACHE_CHECK_BUDGET_MS);
    rankCtx = { ...ctx, cachedInfohashes };
  }
  const { picks, skipped } = selectProbeCandidates(items, describe, rankCtx);
  if (skipped) return { scores: new Map(), probed: [], cachedInfohashes, skipped };
  const results = await probeReleasesBatch(picks.map((x) => x.cand.url as string), FIRST_PICK_BUDGET_MS);
  const scores = new Map<string, ProbeScore>();
  const probed = picks.map((x) => {
    const probe = results.get(x.cand.url as string);
    if (!probe) return { name: releaseLabel(x.cand), score: null };
    const score = scoreProbedRelease({ ...probe, name: `${x.cand.name ?? ''} ${x.cand.title ?? ''}` }, prefs);
    scores.set(x.cand.url as string, score);
    return { name: releaseLabel(x.cand), score };
  });
  return { scores, probed, cachedInfohashes, skipped: null };
}
