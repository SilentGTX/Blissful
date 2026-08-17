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
import { isPlaceholderUrl } from './releaseUrls';
import { languageMatch } from './subtitleUtils';
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
  '2160p': 2160,
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
  const scored: Array<{
    url: string;
    rank: number;
    durable: number;
    short: number;
    bytes: number;
  }> = [];
  for (const r of releases) {
    const url = r.url ?? '';
    // Only an HTTP source can be fed to /transcode-seg: a magnet or
    // infoHash-only row has nothing for ffmpeg to read, and a loopback
    // stremio-server URL isn't reachable from the Mac.
    if (!/^https?:\/\//i.test(url)) continue;
    if (/\/stremio-server\//.test(url)) continue;
    if (isPlaceholderUrl(url)) continue;
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
    // A torrentio `/resolve/` URL is re-mintable: the proxy follows it to a fresh
    // Real-Debrid link on every request, and re-resolves when one dies. A DIRECT
    // `download.real-debrid.com` URL is a fixed link that expires — measured on a
    // long download, every segment after the expiry failed with ffmpeg's "End of
    // file" and nothing server-side could refresh it. Prefer the re-mintable
    // shape for downloads, which run for many minutes.
    const durable = /\/resolve\//i.test(url) ? 0 : 1;
    scored.push({
      url,
      rank: uncached ? 2 : cached ? 0 : 1,
      durable,
      short: sourceHeight(hay) < minHeight ? 1 : 0,
      bytes: sizeBytes(r.size),
    });
  }
  return scored
    .sort(
      (a, b) => a.rank - b.rank || a.durable - b.durable || a.short - b.short || a.bytes - b.bytes
    )
    .map((s) => s.url);
}

export type ProbedVideo = {
  width: number | null;
  height: number | null;
  codec: string | null;
  bitDepth: number | null;
};

export type ProbedRelease = {
  url: string;
  audio: EmbeddedAudio[];
  subs: EmbeddedSubtitle[];
  hasJapanese: boolean;
  /** A track a browser can render as text — bitmap (PGS) subs can't be, and a
   *  file download can't burn them in, since the video bytes are copied. */
  hasTextSubs: boolean;
  /** What the video ACTUALLY is, not what the release name claims. Measured: a
   *  release listed as "1080p" turned out to be 768x576 10-bit. */
  video: ProbedVideo | null;
};

/** The rung a file really belongs to, from its true height. Release names are
 *  unreliable, and a library row that claims 1080p for a 576p file is a lie the
 *  user can see. */
export function qualityForHeight(height: number | null | undefined): OfflineQuality {
  const h = height ?? 0;
  if (h >= 1800) return '2160p';
  if (h >= 900) return '1080p';
  if (h >= 650) return '720p';
  if (h >= 480) return '540p';
  return '360p';
}

/** Codecs a browser will refuse. 10-bit H.264 ("Hi10p", ubiquitous in fansubbed
 *  anime) is the notable one: Safari and iOS cannot decode it at all, so a file
 *  that plays perfectly on a desktop is a black screen on the phone. HEVC is
 *  fine on Apple hardware but not in Chrome. Used as the LAST tiebreak, never to
 *  reject a release — an unplayable file still works in VLC. */
export function browserFriendly(video: ProbedVideo | null): boolean {
  if (!video) return true;
  const codec = (video.codec ?? '').toLowerCase();
  if ((video.bitDepth ?? 8) > 8) return false;
  return codec === 'h264' || codec === 'avc1' || codec === 'vp9' || codec === 'av1';
}

/** THE bug behind "it downloaded the English dub".
 *
 *  A hand-rolled `/^ja/i` test does not match `jpn` — which is exactly how every
 *  release tags Japanese (measured on Bleach S1E7: three releases, tags `jpn`,
 *  `jpn`+`eng`, `eng`, no track titles at all). So Japanese was never detected
 *  and track 0 (the dub, in a dual-audio release) won by default. `languageMatch`
 *  knows the ISO 639-1/2 aliases — 'ja', 'jpn', 'ja-JP' all match. */
export function isJapanese(a: EmbeddedAudio): boolean {
  return languageMatch('Japanese', a.lang) || /jap|jpn|\bjp\b/i.test(a.title ?? '');
}

function hasEnglishText(subs: EmbeddedSubtitle[]): boolean {
  return subs.some(
    (s) => s.textBased && (/^en/i.test(s.lang ?? '') || /english/i.test(s.title ?? ''))
  );
}

/** Subtitles AND video info from ONE `/probe-streams` call — the same ffprobe the
 *  transcode path uses. Kept together because two calls would ffprobe the same
 *  remote file twice. */
async function fetchProbe(
  url: string
): Promise<{ subs: EmbeddedSubtitle[]; video: ProbedVideo | null }> {
  const res = await fetch(`/probe-streams?url=${encodeURIComponent(url)}`);
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

/** Look INSIDE the candidates and pick one that actually contains what's wanted.
 *
 *  Ranking on the release NAME alone is what produced an anime download with
 *  English audio and no subtitles: names lie, or say nothing, and the smallest
 *  file is often a dub-only encode. So the top few candidates are probed
 *  (`/probe-streams` — the same ffprobe the transcode path uses) and scored on
 *  their real streams:
 *
 *    1. A Japanese audio track, when ANY candidate has one. Its presence is the
 *       signal that the original language is Japanese — it doesn't depend on the
 *       id namespace, which matters because the same show is reachable as both
 *       `kitsu:244` and `tt0434665`.
 *    2. English TEXT subtitles, which can be extracted to WebVTT and shown by
 *       the player. Bitmap subs score lower: for a copied file there is nothing
 *       that can render them.
 *
 *  Candidates keep their incoming order (cached, then smallest) as the tiebreak,
 *  so this only ever moves a release up for a concrete reason. */
export async function probeReleases(
  urls: string[],
  limit: number
): Promise<ProbedRelease[]> {
  const out: ProbedRelease[] = [];
  for (const url of urls.slice(0, limit)) {
    try {
      const [probe, audio] = await Promise.all([
        fetchProbe(url),
        fetchAudioTracks(url),
      ]);
      const subs = probe.subs;
      // No streams at all means the probe failed (dead link, uncached torrent) —
      // not a release with no audio. Skip it rather than score it as "no
      // Japanese".
      if (audio.length === 0) continue;
      out.push({
        url,
        audio,
        subs,
        hasJapanese: audio.some(isJapanese),
        hasTextSubs: hasEnglishText(subs),
        video: probe.video,
      });
      // Everything asked for, first try — stop paying for probes.
      if (out[out.length - 1].hasJapanese && out[out.length - 1].hasTextSubs) break;
    } catch {
      // next candidate
    }
  }
  return out;
}

/** Best of a probed set. See probeReleases for the reasoning.
 *
 *  A file download copies the bytes, so it cannot pick an audio track the way the
 *  transcode could — whatever the player defaults to is what you hear, and only
 *  Safari exposes `audioTracks` to switch. So a Japanese-ONLY release beats a
 *  dual-audio one: it sounds right in every player, including Chrome, which
 *  reports no audio track list at all. */
export function bestProbed(probed: ProbedRelease[]): ProbedRelease | null {
  if (probed.length === 0) return null;
  const anyJapanese = probed.some((p) => p.hasJapanese);
  const jpTier = (p: ProbedRelease): number => {
    if (!anyJapanese) return 0;
    if (!p.hasJapanese) return 2;
    return p.audio.every(isJapanese) ? 0 : 1;
  };
  return (
    [...probed]
      .map((p, i) => ({
        p,
        i,
        jp: jpTier(p),
        sub: p.hasTextSubs ? 0 : p.subs.length > 0 ? 1 : 2,
        // Last tiebreak only: 10-bit H.264 is unplayable on iPhone, so an
        // otherwise-equal 8-bit release is the better copy to keep.
        playable: browserFriendly(p.video) ? 0 : 1,
      }))
      .sort((a, b) => a.jp - b.jp || a.sub - b.sub || a.playable - b.playable || a.i - b.i)[0]?.p
    ?? null
  );
}

function autoSubtitle(subs: EmbeddedSubtitle[]): EmbeddedSubtitle | null {
  const english = subs.filter((s) => /^en/i.test(s.lang ?? '') || /english/i.test(s.title ?? ''));
  const notSigns = english.filter((s) => !/sign|song/i.test(s.title ?? ''));
  const pool = notSigns.length > 0 ? notSigns : english;
  // Text first: stored as WebVTT (switchable, crisp) rather than burned in.
  return pool.find((s) => s.textBased) ?? pool[0] ?? null;
}

function autoAudio(auds: EmbeddedAudio[], preferredLang: string | null | undefined): number {
  const jp = auds.find(isJapanese);
  if (jp) return jp.i;
  const pref = preferredLang
    ? auds.find((a) => (a.lang ?? '').toLowerCase().startsWith(preferredLang.slice(0, 2).toLowerCase()))
    : undefined;
  return pref?.i ?? 0;
}

/** Best original-file URL per episode, for the fast path (browser download /
 *  VLC). No transcode involved, so nothing is queued and nothing is stored — the
 *  caller just needs the links. Episodes with no downloadable release are
 *  omitted, and reported through `onProgress` as failures. */
export async function resolveOriginalUrls(params: {
  addons: AddonDescriptor[];
  type: string;
  title: string;
  episodes: BatchEpisode[];
  quality: OfflineQuality;
  onProgress?: (p: BatchProgress) => void;
}): Promise<Array<{ label: string; url: string }>> {
  const progress: BatchProgress = {
    done: 0,
    total: params.episodes.length,
    current: null,
    failed: [],
  };
  const out: Array<{ label: string; url: string }> = [];
  for (const ep of params.episodes) {
    progress.current = ep.label;
    params.onProgress?.({ ...progress });
    try {
      const releases = await fetchFallbackReleases({
        type: params.type,
        id: ep.videoId,
        addons: params.addons,
        showTitle: params.title,
      });
      const url = rankReleasesForDownload(releases, params.quality)[0];
      if (url) out.push({ label: ep.label, url });
      else progress.failed.push(ep.label);
    } catch {
      progress.failed.push(ep.label);
    }
    progress.done += 1;
    params.onProgress?.({ ...progress });
  }
  progress.current = null;
  params.onProgress?.({ ...progress });
  return out;
}

/** Queue a selection as FILE downloads into the offline library: the release
 *  bytes as they are, no transcode (~21 MB/s vs ~0.8). Every episode gets a
 *  visible row immediately, then its release is probed and picked so anime lands
 *  with Japanese audio and text subtitles rather than whatever the smallest file
 *  happened to contain. */
export async function queueFileEpisodes(params: {
  addons: AddonDescriptor[];
  type: string;
  metaId: string;
  poster: string | null;
  title: string;
  episodes: BatchEpisode[];
  quality: OfflineQuality;
  onProgress?: (p: BatchProgress) => void;
}): Promise<BatchProgress> {
  const progress: BatchProgress = {
    done: 0,
    total: params.episodes.length,
    current: null,
    failed: [],
  };
  const { startFileDownload } = await import('./fileDownloader');
  const { fetchPosterBlob, prepareSubtitle } = await import('./offlineDownloader');
  const posterBlob = await fetchPosterBlob(params.poster);

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
      const releases = await fetchFallbackReleases({
        type: params.type,
        id: ep.videoId,
        addons: params.addons,
        showTitle: params.title,
      });
      const candidates = rankReleasesForDownload(releases, params.quality);
      // Two probes per episode, not four: a probe is an ffprobe over the network
      // (~2-5s) and a ten-episode batch would otherwise spend minutes before the
      // first byte of video.
      const best = bestProbed(await probeReleases(candidates, 2));
      const url = best?.url ?? candidates[0];
      if (!url) {
        progress.failed.push(ep.label);
        await failPlaceholder(placeholders.get(ep.videoId), 'No downloadable release was found.');
      } else {
        const track = best ? autoSubtitle(best.subs) : null;
        const { vtt } = track ? await prepareSubtitle(url, track) : { vtt: null };
        await startFileDownload({
          metaId: params.metaId,
          type: params.type,
          videoId: ep.videoId,
          title: params.title,
          subtitle: ep.label,
          poster: params.poster,
          posterBlob,
          sourceUrl: url,
          // The rung the FILE is, not the one that was asked for.
          quality: best?.video ? qualityForHeight(best.video.height) : params.quality,
          fileVideo: best?.video ?? null,
          subtitleVtt: vtt,
          // Only claim subtitles when text actually landed — a label with no
          // track behind it is how "Subs: ENG" came to mean nothing.
          subtitleLabel: vtt && track ? `${(track.lang ?? 'und').toUpperCase()}${track.title ? ` · ${track.title}` : ''}` : null,
          replaceId: placeholders.get(ep.videoId),
        });
      }
    } catch (err: unknown) {
      progress.failed.push(ep.label);
      await failPlaceholder(
        placeholders.get(ep.videoId),
        err instanceof Error ? err.message : 'Could not start this episode.'
      );
    }
    progress.done += 1;
    params.onProgress?.({ ...progress });
  }
  progress.current = null;
  params.onProgress?.({ ...progress });
  return progress;
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
            addonUrls: params.addons.map((a) => a.transportUrl),
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
