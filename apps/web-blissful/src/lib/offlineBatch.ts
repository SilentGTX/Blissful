// Batch downloads: queue a set of episodes in one go.
//
// The single-episode path can lean on the detail page, which has already fetched
// that episode's streams. A batch can't — each episode needs its own release
// list — so this module does the whole job per episode: fetch streams, rank the
// candidates the same way the one-tap path does (cached first, then smallest
// file), probe audio/subtitles, and hand it to the downloader.
//
// Everything is sequential on purpose. Stream lookups hit third-party addons and
// each download is a long server-side encode, so a burst of parallel work would
// just get throttled; the downloader runs one download at a time regardless.

import { fetchFallbackReleases, type FallbackRelease } from './fallbackReleases';
import type { AddonDescriptor } from './mediaTypes';
import type { OfflineQuality } from './offlineStore';
import {
  createPlaceholder,
  fetchAudioTracks,
  fetchEmbeddedSubtitles,
  failPlaceholder,
  startDownload,
  type EmbeddedAudio,
  type EmbeddedSubtitle,
} from './offlineDownloader';

export type BatchEpisode = {
  /** Stremio video id, e.g. `kitsu:244:7`. */
  videoId: string;
  /** "S1E7 - Greetings from a Stuffed Lion" — stored with the download. */
  label: string;
};

export type BatchProgress = {
  done: number;
  total: number;
  /** The episode being prepared right now. */
  current: string | null;
  /** Episodes that produced no downloadable release. */
  failed: string[];
};

const MIN_HEIGHT: Record<OfflineQuality, number> = {
  '360p': 360,
  '540p': 540,
  '720p': 720,
  '1080p': 1080,
};

function sizeBytes(raw: string | null | undefined): number {
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const m = raw.trim().match(/([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|GiB|MiB)/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return Number.MAX_SAFE_INTEGER;
  const base = m[2].toUpperCase().endsWith('IB') ? 1024 : 1000;
  return m[2].toUpperCase().startsWith('G') ? n * base ** 3 : n * base ** 2;
}

function sourceHeight(hay: string): number {
  const s = hay.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(s)) return 2160;
  if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(s)) return 1080;
  if (/\b(720p|hd)\b/.test(s)) return 720;
  if (/\b(480p|360p|sd)\b/.test(s)) return 480;
  return 1080;
}

/** Downloadable candidates for one episode, best first. Mirrors the one-tap
 *  ranking in OfflineDownloadModal: Real-Debrid cached first (an uncached
 *  torrent makes the proxy answer 409 until RD fetches it), then a source tall
 *  enough for the chosen rung, then the smallest file. */
export function rankReleasesForDownload(
  releases: FallbackRelease[],
  quality: OfflineQuality
): string[] {
  const minHeight = MIN_HEIGHT[quality];
  const seen = new Set<string>();
  const scored: Array<{ url: string; rank: number; short: number; bytes: number }> = [];
  for (const r of releases) {
    const url = r.url ?? '';
    // Only an HTTP source can be fed to /transcode-seg: a magnet or
    // infoHash-only row has nothing for ffmpeg to read, and a loopback
    // stremio-server URL isn't reachable from the Mac.
    if (!/^https?:\/\//i.test(url)) continue;
    if (/\/stremio-server\//.test(url)) continue;
    try {
      const host = new URL(url).hostname;
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1') continue;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const hay = `${r.name} ${r.torrentName ?? ''} ${r.quality ?? ''}`;
    const cached = /\[\s*RD\s*[+⚡]/iu.test(hay) || /cached/i.test(hay);
    const uncached = /\[\s*RD\s*(?:download|↓|⬇)/iu.test(hay);
    scored.push({
      url,
      rank: uncached ? 2 : cached ? 0 : 1,
      short: sourceHeight(hay) < minHeight ? 1 : 0,
      bytes: sizeBytes(r.size),
    });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.short - b.short || a.bytes - b.bytes)
    .map((s) => s.url);
}

function autoSubtitle(subs: EmbeddedSubtitle[]): EmbeddedSubtitle | null {
  const english = subs.filter((s) => /^en/i.test(s.lang ?? '') || /english/i.test(s.title ?? ''));
  const notSigns = english.filter((s) => !/sign|song/i.test(s.title ?? ''));
  const pool = notSigns.length > 0 ? notSigns : english;
  // Text first: stored as WebVTT (switchable, crisp) rather than burned in.
  return pool.find((s) => s.textBased) ?? pool[0] ?? null;
}

function autoAudio(auds: EmbeddedAudio[], preferredLang: string | null | undefined): number {
  const jp = auds.find((a) => /^ja/i.test(a.lang ?? '') || /jap|jpn|\bjp\b/i.test(a.title ?? ''));
  if (jp) return jp.i;
  const pref = preferredLang
    ? auds.find((a) => (a.lang ?? '').toLowerCase().startsWith(preferredLang.slice(0, 2).toLowerCase()))
    : undefined;
  return pref?.i ?? 0;
}

/** Queue every episode in `episodes`. Resolves when all have been queued (not
 *  when they've finished downloading — the downloader drains its own queue).
 *  Reports progress so the caller can show which episode is being prepared. */
export async function queueEpisodes(params: {
  addons: AddonDescriptor[];
  type: string;
  metaId: string;
  poster: string | null;
  title: string;
  episodes: BatchEpisode[];
  quality: OfflineQuality;
  audioLanguage?: string | null;
  onProgress?: (p: BatchProgress) => void;
}): Promise<BatchProgress> {
  const progress: BatchProgress = {
    done: 0,
    total: params.episodes.length,
    current: null,
    failed: [],
  };
  // Every selected episode gets a visible row FIRST, before any lookup. Each
  // resolution costs 20-40s (release list + ffprobe for the duration), so
  // resolving before creating rows made a multi-episode batch look like it had
  // silently done nothing — one row downloading and no sign of the rest.
  const placeholders = new Map<string, string>();
  for (const ep of params.episodes) {
    const id = await createPlaceholder({
      metaId: params.metaId,
      type: params.type,
      videoId: ep.videoId,
      title: params.title,
      subtitle: ep.label,
      poster: params.poster,
      quality: params.quality,
    });
    placeholders.set(ep.videoId, id);
  }

  for (const ep of params.episodes) {
    progress.current = ep.label;
    params.onProgress?.({ ...progress });
    try {
      // The SAME source the detail page and the in-player picker use: every
      // installed addon plus the house /rd-fallback. Going straight to the
      // addons instead missed everything on a guest profile, where the only
      // installed addon returns infoHash-only rows and all the debrid-backed
      // releases come from the house fallback.
      const releases = await fetchFallbackReleases({
        type: params.type,
        id: ep.videoId,
        addons: params.addons,
        showTitle: params.title,
      });
      const candidates = rankReleasesForDownload(releases, params.quality);
      let queued = false;
      // Try a few candidates: a 409 means RD hasn't got that torrent yet.
      for (const url of candidates.slice(0, 3)) {
        try {
          const [subs, auds] = await Promise.all([
            fetchEmbeddedSubtitles(url),
            fetchAudioTracks(url),
          ]);
          const track = autoSubtitle(subs);
          await startDownload({
            metaId: params.metaId,
            type: params.type,
            videoId: ep.videoId,
            title: params.title,
            subtitle: ep.label,
            poster: params.poster,
            sourceUrl: url,
            quality: params.quality,
            audioTrackIdx: autoAudio(auds, params.audioLanguage),
            subtitleTrack: track,
            subtitleLabel: track
              ? `${(track.lang ?? 'und').toUpperCase()}${track.title ? ` · ${track.title}` : ''}`
              : null,
            // Overwrite this episode's placeholder rather than adding a row.
            replaceId: placeholders.get(ep.videoId),
          });
          queued = true;
          break;
        } catch {
          // next candidate
        }
      }
      if (!queued) {
        progress.failed.push(ep.label);
        await failPlaceholder(
          placeholders.get(ep.videoId),
          'No cached Real-Debrid release was available for this episode.'
        );
      }
    } catch {
      progress.failed.push(ep.label);
      await failPlaceholder(placeholders.get(ep.videoId), 'Could not look up releases.');
    }
    progress.done += 1;
    params.onProgress?.({ ...progress });
  }
  progress.current = null;
  params.onProgress?.({ ...progress });
  return progress;
}
