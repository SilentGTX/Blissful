// Looking inside release files (ffprobe on the Mac, through the addon proxy).
// The fetching half of the first-time pick; the scoring half is pure and lives
// in releaseRanking (scoreProbedRelease).

import { fetchAudioTracks, type EmbeddedSubtitle } from './offlineDownloader';
import type { ProbedVideo } from './offlineBatch';
import {
  compareRankHead,
  computeRankInfos,
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
// HEVC 10-bit on RD is slow to ffprobe; 4 s left the 1080p BD unprobed while a
// 480p was scored, and an unprobed candidate scores as all zeros.
export const FIRST_PICK_BUDGET_MS = 8000;

/**
 * First-time pick: when nothing is remembered for the series (and this exact
 * episode has no saved release), look inside the top cached candidates and score
 * what they contain. Returns probe scores by url for RankContext.probeScores;
 * empty when the pick is already decided by a remembered/saved release or there
 * is nothing to choose between.
 */
export async function probeFirstTimePick<T>(
  items: readonly T[],
  describe: (item: T) => ReleaseCandidate,
  ctx: RankContext,
  prefs: ProbePrefs,
): Promise<{ scores: Map<string, ProbeScore>; probed: Array<{ name: string; score: ProbeScore | null }> }> {
  const empty = { scores: new Map<string, ProbeScore>(), probed: [] };
  const infos = computeRankInfos(items, describe, ctx);
  const cached = items
    .map((item, i) => ({ item, info: infos[i], i, cand: describe(item) }))
    .filter((x) => x.info.tier === 0 && !!x.cand.url);
  if (cached.length < 2 || cached.some((x) => x.info.remembered || x.info.saved)) return empty;
  // Rules 1, 2b, 3, 6 and 7 decide who is worth a probe; 2, 4 and 5 do not apply here.
  const sorted = cached.sort((a, b) =>
    compareRankHead(a.info, b.info)
    || (a.info.hevc !== b.info.hevc ? (a.info.hevc ? 1 : -1) : 0)
    || b.info.quality - a.info.quality
    || a.i - b.i,
  );
  const top = sorted.slice(0, FIRST_PICK_PROBE_COUNT);
  // The best 1080p+ release is always looked at, even when four others outrank it.
  if (!top.some((x) => x.info.hd)) {
    const hd = sorted.slice(FIRST_PICK_PROBE_COUNT).find((x) => x.info.hd);
    if (hd) top.push(hd);
  }
  const results = await probeReleasesBatch(top.map((x) => x.cand.url as string), FIRST_PICK_BUDGET_MS);
  const scores = new Map<string, ProbeScore>();
  const probed = top.map((x) => {
    const probe = results.get(x.cand.url as string);
    if (!probe) return { name: x.cand.name ?? '', score: null };
    const score = scoreProbedRelease({ ...probe, name: `${x.cand.name ?? ''} ${x.cand.title ?? ''}` }, prefs);
    scores.set(x.cand.url as string, score);
    return { name: x.cand.name ?? '', score };
  });
  return { scores, probed };
}
