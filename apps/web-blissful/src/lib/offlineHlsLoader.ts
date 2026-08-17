// hls.js loader that serves a downloaded stream out of IndexedDB.
//
// This is the piece that makes offline playback work on iPhone. The obvious
// design — cache segments and let a service worker answer the media requests —
// does not work in WebKit: media loads for `<video>` don't reliably reach the
// service worker, and SW handling of media `Range` requests has a long history
// of bugs there. Replacing hls.js's loader instead keeps everything in
// JavaScript we control: hls.js asks for a URL, we hand back bytes from
// IndexedDB, and no network request is ever made.
//
// hls.js resolves segment URIs against the playlist URL, so both are real
// (unroutable) https URLs — see offlineUrls.ts.

import { LoadStats } from 'hls.js';
import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from 'hls.js';
import { getDownload, getSegment, type OfflineDownload } from './offlineStore';
import { offlineSegmentUrl, parseOfflineHlsUrl } from './offlineUrls';

/** Rebuild a VOD playlist from a stored download's segment durations. The
 *  segment URIs point back at our own loader, which reads the blobs. */
export function buildOfflinePlaylist(row: OfflineDownload): string {
  const target = Math.max(1, Math.ceil(Math.max(...row.segmentDurations, 1)));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (let i = 0; i < row.segmentCount; i += 1) {
    const duration = row.segmentDurations[i] ?? 0;
    lines.push(`#EXTINF:${duration.toFixed(3)},`);
    lines.push(offlineSegmentUrl(row.id, i));
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

/** hls.js `Loader` backed by IndexedDB. Anything that isn't an offline URL is
 *  reported as an error rather than silently fetched: a session playing a
 *  download should never touch the network, and a stray URL means a bug we want
 *  to see rather than a surprise data charge. */
export class OfflineHlsLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null;
  stats: LoaderStats = new LoadStats();

  private aborted = false;

  destroy(): void {
    this.aborted = true;
    this.context = null;
  }

  abort(): void {
    this.aborted = true;
    this.stats.aborted = true;
  }

  load(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): void {
    this.context = context;
    const stats = this.stats;
    stats.loading.start = performance.now();

    void (async () => {
      try {
        const ref = parseOfflineHlsUrl(context.url);
        if (!ref) throw new Error(`not an offline url: ${context.url}`);

        const row = await getDownload(ref.downloadId);
        if (!row) throw new Error('this download is no longer on this device');

        const payload: string | ArrayBuffer =
          ref.segment == null
            ? buildOfflinePlaylist(row)
            : await this.readSegment(ref.downloadId, ref.segment);

        if (this.aborted) {
          callbacks.onAbort?.(stats, context, null);
          return;
        }

        const size = typeof payload === 'string' ? payload.length : payload.byteLength;
        stats.loading.first = stats.loading.first || performance.now();
        stats.loading.end = performance.now();
        stats.loaded = size;
        stats.total = size;
        stats.chunkCount = 1;
        // Local reads have no meaningful bandwidth; a high estimate keeps
        // hls.js's ABR from treating instant loads as a reason to do anything
        // clever (there is only ever one level in an offline playlist anyway).
        stats.bwEstimate = 100_000_000;

        callbacks.onSuccess({ url: context.url, data: payload }, stats, context, null);
      } catch (err: unknown) {
        if (this.aborted) {
          callbacks.onAbort?.(stats, context, null);
          return;
        }
        stats.loading.end = performance.now();
        callbacks.onError(
          { code: 0, text: err instanceof Error ? err.message : 'offline load failed' },
          context,
          null,
          stats
        );
      }
    })();
  }

  private async readSegment(downloadId: string, index: number): Promise<ArrayBuffer> {
    const blob = await getSegment(downloadId, index);
    if (!blob) {
      // Either never downloaded, or iOS evicted it. Either way this fragment
      // cannot be produced; hls.js turns the error into a media error, and the
      // player's offline preflight (verifyDownload) is what turns it into a
      // useful message.
      throw new Error(`missing offline segment ${index}`);
    }
    return blob.arrayBuffer();
  }
}
