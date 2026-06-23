import { fetchBlissfulLibrary, type LibraryItem } from '@blissful/core';

export type CwItem = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  progress: number; // 0..100
  resumeSeconds: number; // saved playback position
  episodeLabel?: string; // "S2E4" for series
  videoId?: string; // current episode id (imdb:S:E) for series playback
  /** The exact stream the progress was made on — lets Resume play it instantly
   *  instead of re-resolving a (possibly different) torrent. */
  streamUrl?: string;
  streamTitle?: string;
};

function resumeSecondsOf(item: LibraryItem): number {
  let offset = item.state?.timeOffset ?? 0;
  const duration = item.state?.duration ?? 0;
  if (offset >= 10000 || duration >= 10000) offset /= 1000; // ms -> s
  return Math.max(0, offset);
}

function episodeLabelOf(item: LibraryItem): { label?: string; videoId?: string } {
  const vid = item.state?.videoId ?? (item.state as unknown as { video_id?: string })?.video_id;
  if (typeof vid !== 'string') return {};
  const parts = vid.split(':');
  if (parts.length >= 3) {
    const s = Number(parts[parts.length - 2]);
    const e = Number(parts[parts.length - 1]);
    if (Number.isFinite(s) && Number.isFinite(e)) return { label: `S${s}E${e}`, videoId: vid };
  }
  return { videoId: vid };
}

/** Season + episode to FOCUS on the Detail page from a CW item's episode videoId.
 *  Season is reliable ONLY for the imdb `tt…:S:E` form — kitsu/MAL ids are
 *  `scheme:showId:ep` (the second-to-last part is the SHOW id, NOT a season), so
 *  there we return only the episode and let Detail default the season. */
export function cwSeasonEpisode(videoId?: string): { season?: number; episode?: number } {
  if (!videoId) return {};
  const parts = videoId.split(':');
  if (parts.length < 2) return {};
  const ep = Number(parts[parts.length - 1]);
  const episode = Number.isFinite(ep) && ep > 0 ? ep : undefined;
  const isImdbEp = /^tt\d+$/.test(parts[0]) && parts.length === 3;
  const s = isImdbEp ? Number(parts[1]) : NaN;
  const season = Number.isFinite(s) && s > 0 ? s : undefined;
  return { season, episode };
}

function mtimeMs(item: LibraryItem): number {
  const t = item._mtime;
  if (typeof t === 'string') {
    const p = Date.parse(t);
    return Number.isFinite(p) ? p : 0;
  }
  return typeof t === 'number' ? t : 0;
}

// libraryProgressPercent (features/home/utils.ts) + the ms-vs-seconds heuristic.
export function progressPercent(item: LibraryItem): number | null {
  let offset = item.state?.timeOffset;
  let duration = item.state?.duration;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return null;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    if (duration >= 10000 || offset >= 10000) {
      offset /= 1000;
      duration /= 1000;
    }
    return Math.min(100, Math.max(0, (offset / duration) * 100));
  }
  return 2; // duration unknown -> 2% sentinel
}

// useContinueWatching pipeline: in-progress items, newest first.
export async function fetchContinueWatching(token: string): Promise<CwItem[]> {
  const items = await fetchBlissfulLibrary<LibraryItem>(token);
  // NOTE: match useContinueWatching exactly — it does NOT filter `removed`
  // (soft-removed items keep their progress and still appear in CW).
  return items
    .filter((it) => typeof it.state?.timeOffset === 'number')
    .filter((it) => {
      const o = it.state!.timeOffset as number;
      const d = it.state?.duration;
      return o > 0 || (o === 0 && d === 1); // progress, or the external-player marker
    })
    .sort((a, b) => mtimeMs(b) - mtimeMs(a))
    .slice(0, 14)
    .map((it) => {
      const { label, videoId } = episodeLabelOf(it);
      const stream = it as unknown as { _blissStreamUrl?: string; _blissStreamTitle?: string };
      return {
        id: it._id,
        type: it.type,
        name: it.name,
        poster: it.poster ?? undefined,
        progress: progressPercent(it) ?? 0,
        resumeSeconds: resumeSecondsOf(it),
        episodeLabel: label,
        videoId,
        streamUrl: stream._blissStreamUrl ?? undefined,
        streamTitle: stream._blissStreamTitle ?? undefined,
      };
    });
}
