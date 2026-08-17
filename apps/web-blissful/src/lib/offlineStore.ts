// IndexedDB-backed store for offline downloads (web only).
//
// WHY IndexedDB and not the Cache API / service worker: on iOS the `<video>`
// element's media loads do not reliably go through the service worker, and
// WebKit's SW handling of media `Range` requests has never been dependable. The
// offline player therefore never issues a network request at all — hls.js reads
// segments through a custom loader that calls straight into this store (see
// offlineHlsLoader.ts). No SW involvement, same code path on every platform.
//
// Layout — two object stores so listing downloads never touches video bytes:
//   `downloads`  keyPath 'id'                      one row per download (metadata + progress)
//   `segments`   keyPath ['downloadId', 'index']   one Blob per HLS segment
//
// Segments are stored as Blobs (not ArrayBuffers): WebKit keeps Blob bodies on
// disk rather than in the page's heap, so a 1 GB download doesn't have to fit
// in memory. We only ever read one 6-second segment into memory at a time.

const DB_NAME = 'blissful-offline';
const DB_VERSION = 1;
const STORE_DOWNLOADS = 'downloads';
const STORE_SEGMENTS = 'segments';

export type OfflineQuality = '360p' | '540p' | '720p' | '1080p';

export const OFFLINE_QUALITIES: OfflineQuality[] = ['360p', '540p', '720p', '1080p'];

/** Approximate total bitrate (video + audio) per rung, bits/second. Mirrors
 *  TRANSCODE_QUALITIES in apps/shared/addon-proxy/server.js — used only to
 *  estimate download size before it starts. */
const QUALITY_BITRATE: Record<OfflineQuality, number> = {
  '360p': 600_000 + 96_000,
  '540p': 1_100_000 + 128_000,
  '720p': 2_000_000 + 128_000,
  '1080p': 4_000_000 + 160_000,
};

/** Bytes a download of `durationSeconds` at `quality` should occupy. */
export function estimateDownloadBytes(durationSeconds: number, quality: OfflineQuality): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.round((QUALITY_BITRATE[quality] * durationSeconds) / 8);
}

export type OfflineStatus =
  /** Queued, nothing fetched yet. */
  | 'queued'
  /** Actively fetching segments. */
  | 'downloading'
  /** User paused, or the app was closed mid-download (resumable). */
  | 'paused'
  /** Every segment stored — playable offline. */
  | 'ready'
  /** Gave up after repeated failures; `error` says why. Resumable. */
  | 'failed';

export type OfflineDownload = {
  id: string;
  /** Stremio meta id, e.g. 'tt0133093'. */
  metaId: string;
  /** 'movie' | 'series'. */
  type: string;
  /** Episode id for series (e.g. 'tt0903747:1:2'), null for movies. */
  videoId: string | null;
  title: string;
  /** "S1E2 - Episode name" or null — shown under the title. */
  subtitle: string | null;
  /** Remote poster URL. Useless offline — see `posterBlob`, which is what the
   *  Downloads list actually renders. Kept for the player deep link. */
  poster: string | null;
  /** The poster IMAGE, stored at download time. Without this the offline
   *  library is a list of grey rectangles: the remote URL (and the /img proxy
   *  in front of it) needs the network the user doesn't have. */
  posterBlob?: Blob | null;
  quality: OfflineQuality;
  /** The source URL the segments were transcoded from (RD/torrentio). Kept so a
   *  resumed download can re-request segments; RD links expire, so the resume
   *  path re-resolves through /transcode-seg exactly as the first pass did. */
  sourceUrl: string;
  /** Audio track index muxed into the segments (&a=N). */
  audioTrackIdx: number;
  /** Absolute ffmpeg stream index of a subtitle track BURNED INTO the picture
   *  (&sub=N), or null for none. Burn-in is how bitmap (PGS) subtitles — most
   *  anime and every Blu-ray remux — reach a browser at all, and being part of
   *  the video means they work offline with no extra storage. */
  subtitleStreamIdx: number | null;
  /** Human label of the stored/burned track, for the Downloads list. */
  subtitleLabel: string | null;
  /** WebVTT text for a TEXT subtitle track (subrip/ass/mov_text), extracted at
   *  download time and rendered as a real subtitle track during offline
   *  playback.
   *
   *  Text subs are NOT burned in: ffmpeg's `overlay` filter only composites
   *  IMAGE subtitles, and given a text stream it silently produces an identical
   *  picture (measured byte-identical) — a download that claims subtitles and
   *  has none. Keeping text as VTT is better anyway: crisp at any size,
   *  switchable, and styled by the user's subtitle settings. */
  subtitleVtt?: string | null;
  durationSeconds: number;
  segmentDurations: number[];
  segmentCount: number;
  /** Indices already stored. A resume fetches only what's missing. */
  storedSegments: number[];
  bytes: number;
  status: OfflineStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type OfflineDownloadInit = Omit<
  OfflineDownload,
  'storedSegments' | 'bytes' | 'status' | 'error' | 'createdAt' | 'updatedAt'
>;

let dbPromise: Promise<IDBDatabase> | null = null;

/** True when this browser exposes IndexedDB at all (it's absent in some
 *  private-mode / embedded webviews, and the whole feature must degrade
 *  quietly rather than throw at import time). */
export function offlineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!offlineStorageAvailable()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
        db.createObjectStore(STORE_DOWNLOADS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SEGMENTS)) {
        db.createObjectStore(STORE_SEGMENTS, { keyPath: ['downloadId', 'index'] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // iOS can close the connection out from under us (storage pressure, tab
      // eviction). Drop the cached promise so the next call reopens instead of
      // failing forever on a dead handle.
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });
}

/** Every download, newest first. */
export async function listDownloads(): Promise<OfflineDownload[]> {
  if (!offlineStorageAvailable()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_DOWNLOADS, 'readonly');
    const rows = await reqDone<OfflineDownload[]>(
      tx.objectStore(STORE_DOWNLOADS).getAll() as IDBRequest<OfflineDownload[]>
    );
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function getDownload(id: string): Promise<OfflineDownload | null> {
  if (!offlineStorageAvailable()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_DOWNLOADS, 'readonly');
    const row = await reqDone<OfflineDownload | undefined>(
      tx.objectStore(STORE_DOWNLOADS).get(id) as IDBRequest<OfflineDownload | undefined>
    );
    return row ?? null;
  } catch {
    return null;
  }
}

/** Find an existing download of the same episode/movie at any quality. Used to
 *  show "Downloaded" state on the detail page and to block duplicates. */
export async function findDownloadFor(
  metaId: string,
  videoId: string | null
): Promise<OfflineDownload | null> {
  const all = await listDownloads();
  return all.find((d) => d.metaId === metaId && (d.videoId ?? null) === (videoId ?? null)) ?? null;
}

export async function putDownload(row: OfflineDownload): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_DOWNLOADS, 'readwrite');
  tx.objectStore(STORE_DOWNLOADS).put({ ...row, updatedAt: Date.now() });
  await txDone(tx);
}

export async function createDownload(init: OfflineDownloadInit): Promise<OfflineDownload> {
  const now = Date.now();
  const row: OfflineDownload = {
    ...init,
    storedSegments: [],
    bytes: 0,
    status: 'queued',
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await putDownload(row);
  return row;
}

/** Merge a partial update into a stored download. Returns the new row, or null
 *  if it vanished (deleted from another tab, or evicted). */
export async function updateDownload(
  id: string,
  patch: Partial<OfflineDownload>
): Promise<OfflineDownload | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_DOWNLOADS, 'readwrite');
  const store = tx.objectStore(STORE_DOWNLOADS);
  const current = await reqDone<OfflineDownload | undefined>(
    store.get(id) as IDBRequest<OfflineDownload | undefined>
  );
  if (!current) {
    await txDone(tx);
    return null;
  }
  const next: OfflineDownload = { ...current, ...patch, id, updatedAt: Date.now() };
  store.put(next);
  await txDone(tx);
  return next;
}

/** Store one segment and record it as present, in a SINGLE transaction. The
 *  blob write and the storedSegments bookkeeping must not be able to disagree:
 *  a segment counted but absent breaks playback with a missing-fragment error. */
export async function putSegment(
  downloadId: string,
  index: number,
  data: Blob
): Promise<OfflineDownload | null> {
  const db = await openDb();
  const tx = db.transaction([STORE_SEGMENTS, STORE_DOWNLOADS], 'readwrite');
  tx.objectStore(STORE_SEGMENTS).put({ downloadId, index, data, size: data.size });
  const store = tx.objectStore(STORE_DOWNLOADS);
  const current = await reqDone<OfflineDownload | undefined>(
    store.get(downloadId) as IDBRequest<OfflineDownload | undefined>
  );
  if (!current) {
    // Row deleted mid-download (user hit delete). Abort so the orphan segment
    // isn't written either.
    tx.abort();
    return null;
  }
  const already = current.storedSegments.includes(index);
  const next: OfflineDownload = {
    ...current,
    storedSegments: already ? current.storedSegments : [...current.storedSegments, index],
    bytes: already ? current.bytes : current.bytes + data.size,
    updatedAt: Date.now(),
  };
  store.put(next);
  await txDone(tx);
  return next;
}

/** One segment's bytes, or null when it isn't stored (evicted, or never
 *  fetched). The offline loader turns null into a fragment-load error, which
 *  hls.js surfaces as a normal media error. */
export async function getSegment(downloadId: string, index: number): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_SEGMENTS, 'readonly');
  const row = await reqDone<{ data: Blob } | undefined>(
    tx.objectStore(STORE_SEGMENTS).get([downloadId, index]) as IDBRequest<{ data: Blob } | undefined>
  );
  return row?.data ?? null;
}

/** Delete a download and every segment it owns. */
export async function deleteDownload(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_SEGMENTS, STORE_DOWNLOADS], 'readwrite');
  tx.objectStore(STORE_DOWNLOADS).delete(id);
  // Range-delete over the compound key [downloadId, index]: everything from
  // [id, -Infinity] to [id, Infinity]. Avoids reading 1200 keys to delete them.
  const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
  tx.objectStore(STORE_SEGMENTS).delete(range);
  await txDone(tx);
}

/** Recompute a download's stored-segment set from what is ACTUALLY in the
 *  segment store, and repair the row if they disagree.
 *
 *  iOS evicts script-writable storage under pressure, and it can take the
 *  segment blobs while leaving the (much smaller) metadata row behind — which
 *  would present a "ready" download that stalls on playback. Called before
 *  playing and when the Downloads page mounts, so eviction shows up as an
 *  honest "needs re-download" instead of a broken player. */
export async function verifyDownload(id: string): Promise<OfflineDownload | null> {
  const db = await openDb();
  const tx = db.transaction([STORE_SEGMENTS, STORE_DOWNLOADS], 'readwrite');
  const store = tx.objectStore(STORE_DOWNLOADS);
  const current = await reqDone<OfflineDownload | undefined>(
    store.get(id) as IDBRequest<OfflineDownload | undefined>
  );
  if (!current) {
    await txDone(tx);
    return null;
  }
  const keys = await reqDone<IDBValidKey[]>(
    tx.objectStore(STORE_SEGMENTS).getAllKeys(
      IDBKeyRange.bound([id, -Infinity], [id, Infinity])
    ) as IDBRequest<IDBValidKey[]>
  );
  const present = keys
    .map((k) => (Array.isArray(k) ? Number(k[1]) : NaN))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const recorded = [...current.storedSegments].sort((a, b) => a - b);
  const unchanged =
    present.length === recorded.length && present.every((n, i) => n === recorded[i]);
  if (unchanged) {
    await txDone(tx);
    return current;
  }
  const evicted = present.length < current.storedSegments.length;
  const next: OfflineDownload = {
    ...current,
    storedSegments: present,
    // The row's byte count is no longer trustworthy either; recomputing it
    // would mean reading every blob, so scale it by what survived.
    bytes:
      current.storedSegments.length > 0
        ? Math.round((current.bytes * present.length) / current.storedSegments.length)
        : 0,
    status: present.length >= current.segmentCount ? 'ready' : evicted ? 'paused' : current.status,
    error: evicted ? 'Some parts were removed by the system to free up space.' : current.error,
    updatedAt: Date.now(),
  };
  store.put(next);
  await txDone(tx);
  return next;
}

export type StorageEstimate = { usage: number | null; quota: number | null };

/** Device storage budget. `null`s mean the browser wouldn't say. */
export async function estimateStorage(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? null, quota: est.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/** Ask the browser to exempt this origin from routine eviction. Chrome grants
 *  it silently for installed/engaged sites; WebKit does not implement it, so a
 *  false here is expected on iOS and is NOT an error — installing to the Home
 *  Screen is the durability lever there. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`;
}
