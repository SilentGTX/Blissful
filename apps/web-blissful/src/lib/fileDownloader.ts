// Pull the release FILE into the offline library, in byte ranges.
//
// Why this exists next to offlineDownloader.ts: that one asks the Mac to transcode
// the release into HLS segments, which runs at ~0.8 MB/s because every frame is
// decoded and re-encoded in real time. This one copies the bytes as they are.
// Measured on a 500 Mbit line: 21.5 MB/s through our proxy against 22.4 MB/s
// straight from Real-Debrid — the hop costs ~4%, and an 800 MB episode is ~40s.
//
// The proxy hop is not optional. Real-Debrid supports Range (verified: `206`,
// `Content-Range: bytes 0-1/834834452`) but sends NO `Access-Control-Allow-Origin`,
// so a browser can never read its bytes with `fetch`. `/addon-proxy?url=` forwards
// Range, follows torrentio's redirect to the CDN, and answers with `ACAO: *`.
//
// Storage layout reuses the `segments` store: one Blob per range, keyed
// [downloadId, index]. So resume, eviction repair (verifyDownload) and delete all
// work exactly as they do for HLS downloads, and playback is one Blob assembled
// from the parts (see getFileBlob).

import {
  createDownload,
  getDownload,
  putSegment,
  updateDownload,
  type OfflineDownload,
  type OfflineQuality,
} from './offlineStore';

/** 8 MB. Big enough that per-request overhead disappears (a 1 GB file is ~128
 *  requests), small enough that an interrupted download loses almost nothing and
 *  that four in flight don't hold 100 MB of heap. */
const CHUNK_BYTES = 8 * 1024 * 1024;

/** Four ranges at a time. Measured: one stream already saturates ~21 MB/s
 *  through the proxy, so this is about riding out a slow chunk rather than
 *  raising the ceiling. More would just queue on the Mac. */
const CHUNK_CONCURRENCY = 4;

const MAX_ATTEMPTS = 4;

function proxied(url: string): string {
  return `/addon-proxy?url=${encodeURIComponent(url)}`;
}

function fileNameOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    return last || 'video.mkv';
  } catch {
    return 'video.mkv';
  }
}

export type FileProbe = { totalBytes: number; mime: string | null };

/** Total size and type, from a 2-byte range request.
 *
 *  A HEAD would be cheaper but Real-Debrid's CDN doesn't answer it consistently,
 *  and `Content-Range: bytes 0-1/<total>` gives the same answer from a request
 *  that is certainly supported. A source that answers 200 (no Range support) is
 *  rejected here rather than downloaded wrongly: without Range there is no
 *  resume, and a dropped connection would mean starting over. */
export async function probeFile(url: string): Promise<FileProbe> {
  const res = await fetch(proxied(url), { headers: { Range: 'bytes=0-1' } });
  if (res.status !== 206) {
    throw new Error(
      res.status === 200
        ? 'This source does not support resumable downloads.'
        : `The source answered ${res.status}.`
    );
  }
  const range = res.headers.get('content-range') ?? '';
  const total = Number.parseInt(range.split('/')[1] ?? '', 10);
  // Drain the 2 bytes so the connection is reusable.
  await res.arrayBuffer().catch(() => undefined);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('The source did not report a file size.');
  }
  return { totalBytes: total, mime: res.headers.get('content-type') };
}

async function fetchChunk(url: string, index: number, total: number): Promise<Blob> {
  const start = index * CHUNK_BYTES;
  const end = Math.min(start + CHUNK_BYTES, total) - 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(proxied(url), { headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size !== end - start + 1) {
        throw new Error(`short chunk: ${blob.size} of ${end - start + 1}`);
      }
      return blob;
    } catch (err: unknown) {
      lastError = err;
      // Back off a little: a burst of failures is usually the CDN host
      // rate-limiting, not the range being unavailable.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('chunk failed');
}

export type StartFileDownloadParams = {
  metaId: string;
  type: string;
  videoId: string | null;
  title: string;
  subtitle: string | null;
  poster: string | null;
  posterBlob?: Blob | null;
  sourceUrl: string;
  /** The rung this file really is (from ffprobe, not the release name). */
  quality: OfflineQuality;
  /** Real video properties, for the library badge and the iPhone warning. */
  fileVideo?: {
    width: number | null;
    height: number | null;
    codec: string | null;
    bitDepth: number | null;
  } | null;
  /** WebVTT for an embedded TEXT subtitle track, extracted before the download
   *  (the video bytes are copied verbatim, so subs can't be burned in). */
  subtitleVtt?: string | null;
  subtitleLabel?: string | null;
  /** Overwrite this row instead of adding one (batch placeholders). */
  replaceId?: string;
};

/** One download at a time, like the HLS downloader: the bottleneck is the link,
 *  and two files at once just halves both. */
let activeChain: Promise<void> = Promise.resolve();
const cancelled = new Set<string>();
/** Queued or running IN THIS TAB. The Downloads page consults this before marking
 *  a `downloading` row as interrupted — otherwise arriving on the page mid-flight
 *  relabels a live download "Paused" while it keeps storing chunks. */
const live = new Set<string>();

export function activeFileDownloadIds(): ReadonlySet<string> {
  return live;
}

/** Register the download and start it. Resolves as soon as the row exists (with
 *  its true size), so the caller can route to /downloads and watch progress. */
export async function startFileDownload(
  params: StartFileDownloadParams
): Promise<OfflineDownload> {
  const probe = await probeFile(params.sourceUrl);
  const chunks = Math.ceil(probe.totalBytes / CHUNK_BYTES);
  const init = {
    id:
      params.replaceId
      ?? `file_${params.metaId}_${params.videoId ?? 'movie'}_${params.quality}_${Date.now().toString(36)}`,
    metaId: params.metaId,
    kind: 'file' as const,
    type: params.type,
    videoId: params.videoId,
    title: params.title,
    subtitle: params.subtitle,
    poster: params.poster,
    posterBlob: params.posterBlob ?? null,
    quality: params.quality,
    sourceUrl: params.sourceUrl,
    fileName: fileNameOf(params.sourceUrl),
    fileMime: probe.mime,
    totalBytes: probe.totalBytes,
    fileVideo: params.fileVideo ?? null,
    audioTrackIdx: 0,
    subtitleStreamIdx: null,
    subtitleLabel: params.subtitleLabel ?? null,
    subtitleVtt: params.subtitleVtt ?? null,
    // A file has no per-segment timeline; the <video> element reports the real
    // duration once it opens the container.
    durationSeconds: 0,
    segmentDurations: [],
    segmentCount: chunks,
  };
  let row: OfflineDownload;
  if (params.replaceId) {
    const updated = await updateDownload(params.replaceId, {
      ...init,
      status: 'queued',
      error: null,
      storedSegments: [],
      bytes: 0,
    });
    row = updated ?? (await createDownload(init));
  } else {
    row = await createDownload(init);
  }
  const id = row.id;
  cancelled.delete(id);
  live.add(id);
  activeChain = activeChain
    .then(() => runDownload(id))
    .catch(() => undefined)
    .finally(() => { live.delete(id); });
  return row;
}

/** Stop a download. It stays in the library as `paused` with everything already
 *  stored intact, so resuming re-fetches only what's missing. */
export function cancelFileDownload(id: string): void {
  cancelled.add(id);
}

/** Resume a paused/failed file download. */
export async function resumeFileDownload(id: string): Promise<void> {
  cancelled.delete(id);
  live.add(id);
  activeChain = activeChain
    .then(() => runDownload(id))
    .catch(() => undefined)
    .finally(() => { live.delete(id); });
}

async function runDownload(id: string): Promise<void> {
  let row = await getDownload(id);
  if (!row || row.kind !== 'file') return;
  if (cancelled.has(id)) return;
  const total = row.totalBytes ?? 0;
  if (total <= 0) {
    await updateDownload(id, { status: 'failed', error: 'Unknown file size.' });
    return;
  }
  await updateDownload(id, { status: 'downloading', error: null });

  const missing = () => {
    const have = new Set(row?.storedSegments ?? []);
    const out: number[] = [];
    for (let i = 0; i < (row?.segmentCount ?? 0); i += 1) if (!have.has(i)) out.push(i);
    return out;
  };

  let queue: number[] = [];
  let failed = 0;
  // Workers pull from a shared queue rather than being handed a slice: chunk
  // times vary (the CDN throttles sporadically) and a static split leaves
  // workers idle at the end.
  const worker = async () => {
    for (;;) {
      if (cancelled.has(id)) return;
      const index = queue.shift();
      if (index == null) return;
      try {
        const blob = await fetchChunk(row!.sourceUrl, index, total);
        const next = await putSegment(id, index, blob);
        if (!next) {
          // Row deleted mid-download — stop the whole thing.
          cancelled.add(id);
          return;
        }
        row = next;
      } catch {
        failed += 1;
      }
    }
  };
  // Several passes over whatever is still missing, like the HLS downloader: a
  // chunk usually fails because the CDN throttled that instant, and one bad range
  // shouldn't cost a whole file. Stops early when a pass adds nothing, so a truly
  // dead link doesn't spin.
  for (let pass = 0; pass < 3; pass += 1) {
    queue = missing();
    if (queue.length === 0 || cancelled.has(id)) break;
    const before = row?.storedSegments.length ?? 0;
    failed = 0;
    await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, () => worker()));
    if ((row?.storedSegments.length ?? 0) === before) break;
  }

  const fresh = await getDownload(id);
  if (!fresh) return;
  if (cancelled.has(id)) {
    await updateDownload(id, { status: 'paused' });
    return;
  }
  if (fresh.storedSegments.length >= fresh.segmentCount) {
    await updateDownload(id, { status: 'ready', error: null });
    return;
  }
  await updateDownload(id, {
    status: 'paused',
    error:
      failed > 0
        ? `${failed} part${failed === 1 ? '' : 's'} failed — the link may have expired. Resume to retry.`
        : 'Stopped before finishing. Resume to continue.',
  });
}
