// The download engine: turns a stream source into stored HLS segments.
//
// Shape of a download
// -------------------
// 1. Ask the proxy for `/transcode.m3u8?url=<src>&a=<track>&q=<rung>`. That
//    playlist is authoritative for duration + segment count, and its `q` rung
//    is what makes the stored copy phone-sized (see TRANSCODE_QUALITIES in
//    apps/shared/addon-proxy/server.js).
// 2. Fetch each `/transcode-seg?...` entry and store the bytes in IndexedDB.
// 3. Playback rebuilds a playlist from the stored segment durations and reads
//    the blobs back through hls.js's loader (offlineHlsLoader.ts).
//
// Constraints this is built around
// --------------------------------
// - NO background downloads on iOS. WebKit has no Background Fetch, and a
//   backgrounded tab is suspended. So: every segment is committed
//   individually, a partial download is a first-class resumable state, and we
//   take a Screen Wake Lock while running.
// - RD links expire (~25 min). Each segment is a fresh request to
//   /transcode-seg, which re-resolves the source server-side, so a long
//   download outliving its original link is fine.
// - Each segment costs a server-side ffmpeg encode, so ONE download runs at a
//   time with a small fetch concurrency. A whole movie is a whole encode.

import {
  createDownload,
  deleteDownload,
  getDownload,
  listDownloads,
  putSegment,
  updateDownload,
  type OfflineDownload,
  type OfflineQuality,
} from './offlineStore';
import { proxiedImage } from './imageProxy';

/** Parallel segment fetches.
 *
 *  Each one is an ffmpeg encode on the Mac, but the wall-clock cost is dominated
 *  by I/O, not the encode: every segment opens a fresh HTTPS connection to
 *  Real-Debrid and seeks (the transcoder's own comments put that at ~40% of a
 *  segment's budget), and the encode itself runs on the dedicated media engine.
 *  So the queue is mostly waiting, and a few more in flight is close to free —
 *  the host transcoder coalesces duplicate work and caps its own prefetch. */
const SEGMENT_CONCURRENCY = 6;
/** Attempts within one pass before that segment is left for the next pass. */
const SEGMENT_RETRIES = 3;
/** Whole-list passes over the still-missing segments. Stragglers are common on a
 *  hundreds-of-segments download; a later pass usually sweeps them up. */
const SEGMENT_PASSES = 4;
/** Pause before pass N (multiplied by the pass number) — lets a saturated
 *  transcoder or a throttling debrid host recover before we hammer it again. */
const PASS_BACKOFF_MS = 5_000;
/** A 6s segment normally encodes in ~1-3s; well past that means a dead RD
 *  connection rather than a slow one. */
const SEGMENT_TIMEOUT_MS = 90_000;

export type DownloadRequest = {
  metaId: string;
  type: string;
  videoId: string | null;
  title: string;
  subtitle: string | null;
  poster: string | null;
  /** The stream's direct/resolve URL — what /transcode.m3u8 wraps. */
  sourceUrl: string;
  audioTrackIdx?: number;
  quality: OfflineQuality;
  /** The chosen embedded subtitle track, or null for none. How it's applied
   *  depends on its kind — see prepareSubtitle. */
  subtitleTrack?: EmbeddedSubtitle | null;
  subtitleLabel?: string | null;
  /** Overwrite this row instead of creating a new one — used by batches, where a
   *  placeholder row is shown while the release is being looked up. */
  replaceId?: string;
};

/** Audio track as reported by /transcode-audio. */
export type EmbeddedAudio = {
  i: number;
  lang: string | null;
  title: string | null;
  codec: string | null;
  channels: number | null;
};

/** Audio tracks in a source, so a download can pick a language instead of
 *  blindly taking track 0 — which on a dual-audio anime release is usually the
 *  English dub. */
export async function fetchAudioTracks(sourceUrl: string): Promise<EmbeddedAudio[]> {
  try {
    const res = await fetch(`/transcode-audio?url=${encodeURIComponent(sourceUrl)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tracks?: EmbeddedAudio[] };
    return Array.isArray(data.tracks) ? data.tracks : [];
  } catch {
    return [];
  }
}

/** Embedded subtitle track as reported by /probe-streams. */
export type EmbeddedSubtitle = {
  index: number;
  lang: string | null;
  title: string | null;
  codec: string | null;
  textBased: boolean;
};

/** Embedded subtitle tracks in a source, for the download picker.
 *
 *  Bitmap tracks (`hdmv_pgs_subtitle`, `dvd_subtitle`) are INCLUDED here even
 *  though the player can't show them as text: burning them in is exactly how
 *  they become usable. Returns [] on any failure — subtitles are optional. */
export async function fetchEmbeddedSubtitles(sourceUrl: string): Promise<EmbeddedSubtitle[]> {
  try {
    const res = await fetch(`/probe-streams?url=${encodeURIComponent(sourceUrl)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      subtitles?: Array<{
        index?: number;
        lang?: string | null;
        language?: string | null;
        title?: string | null;
        codec?: string | null;
        textBased?: boolean;
      }>;
    };
    return (data.subtitles ?? [])
      .filter((s): s is { index: number } & typeof s => Number.isInteger(s.index))
      .map((s) => ({
        index: s.index,
        lang: s.lang ?? s.language ?? null,
        title: s.title ?? null,
        codec: s.codec ?? null,
        textBased: s.textBased === true,
      }));
  } catch {
    return [];
  }
}

type Listener = (downloads: OfflineDownload[]) => void;

const listeners = new Set<Listener>();
/** Ids the user has asked to stop. Checked between segments. */
const cancelled = new Set<string>();
/** The single in-flight download, if any. */
let activeId: string | null = null;
let runnerChain: Promise<void> = Promise.resolve();
/** Queue of ids waiting for the runner. */
const queue: string[] = [];

export function subscribeDownloads(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function emit(): Promise<void> {
  if (listeners.size === 0) return;
  const rows = await listDownloads();
  for (const fn of listeners) {
    try {
      fn(rows);
    } catch {
      // A listener throwing must not break the download loop.
    }
  }
}

export function activeDownloadId(): string | null {
  return activeId;
}

// ── Wake lock ────────────────────────────────────────────────────────────────
// Held for as long as a download is running. Without it the display sleeps, the
// page is suspended, and the download stops. Safari 16.4+ and Chrome support
// this; where it's missing we just proceed (and the Downloads page tells the
// user to keep the screen on).

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };
let wakeLock: WakeLockSentinelLike | null = null;

async function acquireWakeLock(): Promise<void> {
  if (wakeLock && !wakeLock.released) return;
  const nav = navigator as unknown as {
    wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
  };
  if (!nav.wakeLock) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    // Rejected when the document isn't visible — expected, not an error.
    wakeLock = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  const lock = wakeLock;
  wakeLock = null;
  if (!lock || lock.released) return;
  try {
    await lock.release();
  } catch {
    // Nothing to do — the page is going away anyway.
  }
}

// The lock is dropped whenever the page is hidden; re-take it on return so a
// download that survived a brief background regains its screen hold.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeId) void acquireWakeLock();
  });
}

// ── Playlist ─────────────────────────────────────────────────────────────────

export type ParsedPlaylist = {
  durationSeconds: number;
  segmentDurations: number[];
  segmentUrls: string[];
};

/** Pull the segment list out of a /transcode.m3u8 VOD playlist. The proxy emits
 *  strictly alternating `#EXTINF:<dur>,` / `<uri>` pairs, but we pair them
 *  defensively so an added tag can't shift the mapping. */
export function parseTranscodePlaylist(text: string): ParsedPlaylist {
  const lines = text.split(/\r?\n/);
  const segmentDurations: number[] = [];
  const segmentUrls: string[] = [];
  let pendingDuration: number | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const value = Number.parseFloat(line.slice('#EXTINF:'.length));
      pendingDuration = Number.isFinite(value) ? value : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pendingDuration == null) continue;
    segmentDurations.push(pendingDuration);
    segmentUrls.push(line);
    pendingDuration = null;
  }
  return {
    durationSeconds: segmentDurations.reduce((a, b) => a + b, 0),
    segmentDurations,
    segmentUrls,
  };
}

async function fetchPlaylist(
  sourceUrl: string,
  audioTrackIdx: number,
  quality: OfflineQuality,
  subtitleStreamIdx: number | null
): Promise<ParsedPlaylist> {
  const params = new URLSearchParams({ url: sourceUrl, q: quality });
  if (audioTrackIdx > 0) params.set('a', String(audioTrackIdx));
  // Burned into the picture, so the stored segments carry their own subtitles.
  if (subtitleStreamIdx != null) params.set('sub', String(subtitleStreamIdx));
  const res = await fetch(`/transcode.m3u8?${params.toString()}`);
  if (res.status === 409) {
    throw new Error('This release is not cached on Real-Debrid yet. Pick another one.');
  }
  if (!res.ok) throw new Error(`Could not prepare the download (${res.status}).`);
  const parsed = parseTranscodePlaylist(await res.text());
  if (parsed.segmentUrls.length === 0) throw new Error('The server returned an empty playlist.');
  return parsed;
}

// ── Queue + runner ───────────────────────────────────────────────────────────

/** Queue a new download. Resolves with the stored row as soon as its playlist
 *  is known (so the UI can show the real size/segment count immediately); the
 *  segment fetching continues in the background. */
/** Decide how a chosen subtitle track travels with the download.
 *
 *  IMAGE subtitles (PGS/dvdsub — most anime, every Blu-ray remux) can only be
 *  burned into the picture: nothing in a browser can decode them as text.
 *
 *  TEXT subtitles (subrip/ass/mov_text) must NOT be burned. ffmpeg's `overlay`
 *  filter composites images only; handed a text stream it silently emits a
 *  byte-identical picture, which is how a download came back claiming "ENG"
 *  subtitles and showing none. They're extracted to WebVTT once and stored
 *  instead — crisper at any size, switchable, and styled by the user's subtitle
 *  settings. */
async function prepareSubtitle(
  sourceUrl: string,
  track: EmbeddedSubtitle | null | undefined
): Promise<{ burnIdx: number | null; vtt: string | null }> {
  if (!track) return { burnIdx: null, vtt: null };
  if (!track.textBased) return { burnIdx: track.index, vtt: null };
  try {
    const res = await fetch(
      `/extract-subtitle.vtt?url=${encodeURIComponent(sourceUrl)}&track=${track.index}`
    );
    if (!res.ok) return { burnIdx: null, vtt: null };
    const text = await res.text();
    // A WebVTT file must start with the WEBVTT magic; anything else is an error
    // page and would render as garbage.
    return { burnIdx: null, vtt: /^\s*WEBVTT/.test(text) ? text : null };
  } catch {
    return { burnIdx: null, vtt: null };
  }
}

/** Grab the poster bytes so the offline library has artwork. Best-effort: a
 *  missing poster is a cosmetic loss, never a reason to fail a download. */
async function fetchPosterBlob(poster: string | null): Promise<Blob | null> {
  if (!poster) return null;
  try {
    const res = await fetch(proxiedImage(poster));
    if (!res.ok) return null;
    const blob = await res.blob();
    // Guard against an error page being stored as "artwork".
    return blob.size > 0 && blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}

export async function startDownload(req: DownloadRequest): Promise<OfflineDownload> {
  const audioTrackIdx = req.audioTrackIdx ?? 0;
  const { burnIdx: subtitleStreamIdx, vtt: subtitleVtt } = await prepareSubtitle(
    req.sourceUrl,
    req.subtitleTrack
  );
  const playlist = await fetchPlaylist(req.sourceUrl, audioTrackIdx, req.quality, subtitleStreamIdx);
  const posterBlob = await fetchPosterBlob(req.poster ?? null);
  const row = await createDownload({
    id:
      req.replaceId
      ?? `dl_${req.metaId}_${req.videoId ?? 'movie'}_${req.quality}_${Date.now().toString(36)}`,
    metaId: req.metaId,
    type: req.type,
    videoId: req.videoId,
    title: req.title,
    subtitle: req.subtitle,
    poster: req.poster,
    posterBlob,
    quality: req.quality,
    sourceUrl: req.sourceUrl,
    audioTrackIdx,
    subtitleStreamIdx,
    subtitleLabel: req.subtitleLabel ?? null,
    subtitleVtt,
    durationSeconds: playlist.durationSeconds,
    segmentDurations: playlist.segmentDurations,
    segmentCount: playlist.segmentUrls.length,
  });
  void emit();
  enqueue(row.id);
  return row;
}

/** A visible row for an episode whose release hasn't been looked up yet.
 *
 *  Batches create one of these per selected episode up front, so the user sees
 *  everything they picked immediately; each resolution then overwrites its own
 *  row via `replaceId`. Status 'resolving' with segmentCount 0 keeps it out of
 *  the download queue until it's real. Returns the row id. */
export async function createPlaceholder(init: {
  metaId: string;
  type: string;
  videoId: string | null;
  title: string;
  subtitle: string | null;
  poster: string | null;
  quality: OfflineQuality;
}): Promise<string> {
  const id = `dl_${init.metaId}_${init.videoId ?? 'movie'}_${init.quality}_${Date.now().toString(36)}_${Math.trunc(performance.now())}`;
  const row = await createDownload({
    id,
    metaId: init.metaId,
    type: init.type,
    videoId: init.videoId,
    title: init.title,
    subtitle: init.subtitle,
    poster: init.poster,
    posterBlob: null,
    quality: init.quality,
    sourceUrl: '',
    audioTrackIdx: 0,
    subtitleStreamIdx: null,
    subtitleLabel: null,
    subtitleVtt: null,
    durationSeconds: 0,
    segmentDurations: [],
    segmentCount: 0,
  });
  await updateDownload(row.id, { status: 'resolving' });
  void emit();
  return id;
}

/** Mark a placeholder as failed (no release found, lookup error). */
export async function failPlaceholder(id: string | undefined, reason: string): Promise<void> {
  if (!id) return;
  const row = await getDownload(id);
  // Only touch it if it never became a real download.
  if (!row || row.segmentCount > 0) return;
  await updateDownload(id, { status: 'failed', error: reason });
  void emit();
}

/** Resume a paused/failed download. Re-fetches the playlist (the old segment
 *  URLs are stale once RD re-mints the link) and continues from what's stored. */
export async function resumeDownload(id: string): Promise<void> {
  const row = await getDownload(id);
  if (!row || row.status === 'ready' || row.status === 'downloading') return;
  cancelled.delete(id);
  await updateDownload(id, { status: 'queued', error: null });
  void emit();
  enqueue(id);
}

export async function pauseDownload(id: string): Promise<void> {
  cancelled.add(id);
  const idx = queue.indexOf(id);
  if (idx >= 0) queue.splice(idx, 1);
  const row = await getDownload(id);
  if (row && row.status !== 'ready') {
    await updateDownload(id, { status: 'paused' });
  }
  void emit();
}

/** Stop and forget a download, deleting stored segments. */
export async function removeDownload(id: string): Promise<void> {
  cancelled.add(id);
  const idx = queue.indexOf(id);
  if (idx >= 0) queue.splice(idx, 1);
  await deleteDownload(id);
  cancelled.delete(id);
  void emit();
}

function enqueue(id: string): void {
  if (!queue.includes(id) && activeId !== id) queue.push(id);
  // Serialise: each run waits for the previous one. One download at a time —
  // every segment is an ffmpeg encode on the Mac.
  runnerChain = runnerChain.then(() => drainQueue()).catch(() => undefined);
}

async function drainQueue(): Promise<void> {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    try {
      await runDownload(next);
    } catch {
      // runDownload records its own failure state; keep draining.
    }
  }
}

async function runDownload(id: string): Promise<void> {
  const row = await getDownload(id);
  if (!row || row.status === 'ready') return;
  if (cancelled.has(id)) {
    cancelled.delete(id);
    return;
  }

  activeId = id;
  await acquireWakeLock();
  await updateDownload(id, { status: 'downloading', error: null });
  void emit();

  try {
    // Always re-fetch the playlist: a resumed download's segment URLs point at
    // an expired RD link, and the proxy re-resolves on each request anyway.
    const playlist = await fetchPlaylist(
      row.sourceUrl,
      row.audioTrackIdx,
      row.quality,
      row.subtitleStreamIdx ?? null
    );
    // A different segment count means the source changed under us (different
    // file for the same release). Stored segments no longer line up, so start
    // the byte accounting over rather than mixing two encodes.
    const countChanged = playlist.segmentUrls.length !== row.segmentCount;
    const current = await updateDownload(id, {
      durationSeconds: playlist.durationSeconds,
      segmentDurations: playlist.segmentDurations,
      segmentCount: playlist.segmentUrls.length,
      ...(countChanged ? { storedSegments: [], bytes: 0 } : {}),
    });
    if (!current) return; // deleted while we were fetching the playlist

    const stored = new Set(current.storedSegments);
    const missing: number[] = [];
    for (let i = 0; i < playlist.segmentUrls.length; i += 1) {
      if (!stored.has(i)) missing.push(i);
    }

    // Segment fetching runs in PASSES, and one bad segment does not abandon the
    // run. A real download is hundreds of segments over a path that can hiccup
    // (a CDN cutting a slow connection, the transcoder briefly saturated, RD
    // throttling) — measured: a 231-segment episode died at 95 because the first
    // exhausted segment stopped every worker. Now the pass records the failure,
    // keeps fetching everything else, and later passes re-attempt only what's
    // still missing with a longer pause in between. Only if a whole pass adds
    // nothing do we give up and park the download as resumable.
    const state = { failure: null as string | null, cursor: 0, todo: missing };
    const worker = async (): Promise<void> => {
      for (;;) {
        if (cancelled.has(id)) return;
        const slot = state.cursor;
        state.cursor += 1;
        if (slot >= state.todo.length) return;
        const index = state.todo[slot];
        try {
          const blob = await fetchSegment(playlist.segmentUrls[index]);
          if (cancelled.has(id)) return;
          const updated = await putSegment(id, index, blob);
          if (!updated) return; // row deleted mid-flight
          void emit();
        } catch (err: unknown) {
          // Remember the reason, then move on to the next segment.
          state.failure = err instanceof Error ? err.message : 'Download failed.';
        }
      }
    };

    for (let pass = 0; pass < SEGMENT_PASSES; pass += 1) {
      if (cancelled.has(id)) break;
      if (state.todo.length === 0) break;
      if (pass > 0) {
        await new Promise((r) => setTimeout(r, PASS_BACKOFF_MS * pass));
        if (cancelled.has(id)) break;
      }
      state.cursor = 0;
      state.failure = null;
      const before = (await getDownload(id))?.storedSegments.length ?? 0;
      await Promise.all(
        Array.from({ length: Math.min(SEGMENT_CONCURRENCY, Math.max(1, state.todo.length)) }, worker)
      );
      const after = await getDownload(id);
      if (!after) return; // deleted mid-flight
      const stored2 = new Set(after.storedSegments);
      state.todo = state.todo.filter((i) => !stored2.has(i));
      // A pass that stored nothing new means retrying again won't help either.
      if (state.todo.length > 0 && after.storedSegments.length === before) break;
    }

    if (cancelled.has(id)) {
      cancelled.delete(id);
      const row2 = await getDownload(id);
      if (row2 && row2.status !== 'ready') await updateDownload(id, { status: 'paused' });
      void emit();
      return;
    }
    const final = await getDownload(id);
    if (!final) return;
    if (final.storedSegments.length < final.segmentCount && state.failure) {
      await updateDownload(id, { status: 'failed', error: state.failure });
    } else if (final.storedSegments.length >= final.segmentCount) {
      await updateDownload(id, { status: 'ready', error: null });
    } else {
      // Everything we tried succeeded but segments are still missing — treat as
      // resumable rather than silently claiming success.
      await updateDownload(id, { status: 'paused' });
    }
    void emit();
  } catch (err: unknown) {
    await updateDownload(id, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Download failed.',
    });
    void emit();
  } finally {
    activeId = null;
    if (queue.length === 0) await releaseWakeLock();
  }
}

async function fetchSegment(url: string): Promise<Blob> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < SEGMENT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEGMENT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`segment ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('empty segment');
      return blob;
    } catch (err: unknown) {
      lastError = err;
      // Back off a little before retrying — a 429 from RD wants breathing room.
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `Could not download part of this video (${lastError.message}).`
      : 'Could not download part of this video.'
  );
}

/** Re-queue anything left mid-download by a previous session (a closed tab, a
 *  backgrounded iOS app). Called once from the Downloads page: resuming
 *  automatically on app start would fight for bandwidth unannounced, so we only
 *  mark them resumable and let the page offer the button. */
export async function markInterruptedDownloads(): Promise<void> {
  const rows = await listDownloads();
  for (const row of rows) {
    if (row.status === 'downloading' || row.status === 'queued') {
      if (activeId === row.id || queue.includes(row.id)) continue;
      await updateDownload(row.id, { status: 'paused' });
    }
  }
  void emit();
}
