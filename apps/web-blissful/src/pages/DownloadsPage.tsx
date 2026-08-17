// Offline downloads: progress, storage budget, and offline playback.
//
// This page is also where eviction is surfaced honestly. iOS clears
// script-writable storage under pressure and can take the segment blobs while
// leaving the (tiny) metadata row behind, so every visit re-verifies each
// download against what is ACTUALLY stored (verifyDownload) rather than
// trusting the recorded state. A download whose parts were reclaimed shows up
// as resumable, not as a "ready" item that stalls when you press play.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import { proxiedImage } from '../lib/imageProxy';
import {
  detectOfflineCapabilities,
  offlineBootWarning,
  offlineDurabilityWarning,
} from '../lib/offlineCapabilities';
import {
  estimateStorage,
  formatBytes,
  listDownloads,
  verifyDownload,
  type OfflineDownload,
} from '../lib/offlineStore';
import {
  markInterruptedDownloads,
  pauseDownload,
  removeDownload,
  resumeDownload,
  subscribeDownloads,
} from '../lib/offlineDownloader';
import { offlineAppUrl } from '../lib/offlineUrls';
import { notifyError } from '../lib/toastQueues';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

function statusLabel(row: OfflineDownload): string {
  const done = row.storedSegments.length;
  const total = Math.max(1, row.segmentCount);
  const pct = Math.min(100, Math.round((done / total) * 100));
  switch (row.status) {
    case 'resolving':
      return 'Finding a release…';
    case 'ready':
      return 'Ready to watch offline';
    case 'downloading':
      return `Downloading — ${pct}%`;
    case 'queued':
      return 'Waiting to start';
    case 'paused':
      return `Paused — ${pct}%`;
    case 'failed':
      return row.error ?? 'Download failed';
    default:
      return '';
  }
}

function progressPercent(row: OfflineDownload): number {
  const total = Math.max(1, row.segmentCount);
  return Math.min(100, (row.storedSegments.length / total) * 100);
}

// One object URL per download id, for the whole session.
//
// Deliberately NOT derived from the rows: the list re-reads from IndexedDB on
// every progress tick (several times a second while downloading) and each read
// returns a NEW Blob object, so anything keyed on the blob recreated and revoked
// every URL constantly — the artwork visibly blinked out the moment a download
// started. A download's poster never changes, so the id is the right key, and
// the handful of URLs are released when the tab goes away.
const posterUrlCache = new Map<string, string>();

function posterUrlFor(row: OfflineDownload): string | null {
  const hit = posterUrlCache.get(row.id);
  if (hit) return hit;
  if (!row.posterBlob) return null;
  const url = URL.createObjectURL(row.posterBlob);
  posterUrlCache.set(row.id, url);
  return url;
}

function forgetPosterUrl(id: string): void {
  const hit = posterUrlCache.get(id);
  if (!hit) return;
  URL.revokeObjectURL(hit);
  posterUrlCache.delete(id);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  // Never render "0m" for a short clip — round up to a minute instead.
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

export default function DownloadsPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const caps = useMemo(() => detectOfflineCapabilities(), []);
  const [rows, setRows] = useState<OfflineDownload[]>([]);
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null }>({
    usage: null,
    quota: null,
  });
  const [loading, setLoading] = useState(true);

  const refreshStorage = useCallback(async () => {
    setStorage(await estimateStorage());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Anything left mid-flight by a previous session (closed tab, iOS
      // suspending a backgrounded app) becomes an explicit paused item rather
      // than resuming behind the user's back and eating their data.
      await markInterruptedDownloads();
      const initial = await listDownloads();
      // Re-verify against the segment store: catches system eviction.
      const verified = await Promise.all(initial.map((row) => verifyDownload(row.id)));
      if (cancelled) return;
      setRows(verified.filter((r): r is OfflineDownload => r != null));
      setLoading(false);
      void refreshStorage();
    })();
    const unsubscribe = subscribeDownloads((next) => {
      if (!cancelled) setRows(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshStorage]);

  const playOffline = useCallback(
    async (row: OfflineDownload) => {
      // Verify immediately before playing: a stale "ready" would otherwise fail
      // inside the player with a bare media error.
      const fresh = await verifyDownload(row.id);
      if (!fresh || fresh.storedSegments.length < fresh.segmentCount) {
        notifyError(
          'This download is incomplete',
          'Some parts are missing — resume it to finish, then play.'
        );
        if (fresh) setRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
        return;
      }
      const qs = new URLSearchParams({
        url: offlineAppUrl(row.id),
        title: row.subtitle ? `${row.title} - ${row.subtitle}` : row.title,
        type: row.type,
        id: row.metaId,
      });
      if (row.poster) qs.set('poster', row.poster);
      qs.set('metaTitle', row.title);
      if (row.videoId) qs.set('videoId', row.videoId);
      navigate(`/player?${qs.toString()}`);
    },
    [navigate]
  );

  const handleRemove = useCallback(
    async (row: OfflineDownload) => {
      await removeDownload(row.id);
      forgetPosterUrl(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      void refreshStorage();
    },
    [refreshStorage]
  );

  /** Stored blob first — it's the only source that works offline. The remote URL
   *  is a fallback for rows downloaded before poster caching existed. */
  const posterSrc = useCallback(
    (row: OfflineDownload): string | null =>
      posterUrlFor(row) ?? (online && row.poster ? proxiedImage(row.poster) ?? null : null),
    [online]
  );

  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  const durability = offlineDurabilityWarning(caps);
  const bootWarning = offlineBootWarning(caps);

  return (
    <div className="mt-4 space-y-6 overflow-x-hidden">
      <div className="solid-surface rounded-[28px] bg-white/6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-[Fraunces] text-2xl font-semibold">Downloads</div>
            <div className="text-sm text-foreground/60">
              Watch without a connection. {rows.length > 0 ? `${formatBytes(totalBytes)} stored` : null}
            </div>
          </div>
          {storage.quota != null && storage.usage != null ? (
            <div className="text-right">
              <div className="text-sm font-semibold">
                {formatBytes(storage.quota - storage.usage)} free
              </div>
              <div className="text-xs text-foreground/50">
                of {formatBytes(storage.quota)} available to Blissful
              </div>
            </div>
          ) : null}
        </div>

        {/* Offline mode is a deliberate, explained state — not a broken app.
            The rest of Blissful needs the network, so it's out of reach until
            the connection is back. */}
        {!online ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[var(--bliss-accent)]/10 px-4 py-3 ring-1 ring-[var(--bliss-accent)]/25">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--bliss-accent)]" />
            <div className="text-[13px] leading-relaxed text-[var(--bliss-accent)]">
              <span className="font-semibold">You’re offline.</span> Only downloads are
              available — the rest of Blissful needs a connection and comes back on its own.
            </div>
          </div>
        ) : null}

        {caps.blockedReason ? (
          <div className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] leading-relaxed text-red-200 ring-1 ring-red-400/20">
            {caps.blockedReason}
          </div>
        ) : null}
        {bootWarning ? (
          <div className="mt-4 rounded-2xl bg-red-500/12 px-4 py-3 text-[13px] leading-relaxed text-red-200 ring-1 ring-red-400/30">
            <div className="mb-1 font-semibold">These downloads won’t open offline in this browser</div>
            {bootWarning}
          </div>
        ) : null}

        {durability ? (
          <div className="mt-3 rounded-2xl bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-100/90 ring-1 ring-amber-300/20">
            {durability}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="text-sm text-foreground/60">Loading downloads…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-foreground/60">
              Nothing downloaded yet. Open a movie or episode and use Download.
            </div>
          ) : (
            rows.map((row) => {
              const pct = progressPercent(row);
              const isActive =
                row.status === 'downloading' || row.status === 'queued' || row.status === 'resolving';
              return (
                <div
                  key={row.id}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:gap-4 sm:p-4"
                >
                  {posterSrc(row) ? (
                    <img
                      src={posterSrc(row) ?? undefined}
                      alt=""
                      className="h-[86px] w-[58px] shrink-0 rounded-xl object-cover sm:h-[110px] sm:w-[74px]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-[86px] w-[58px] shrink-0 rounded-xl bg-white/10 sm:h-[110px] sm:w-[74px]" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{row.title}</div>
                    {row.subtitle ? (
                      <div className="truncate text-xs text-foreground/60">{row.subtitle}</div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/50">
                      <span className="rounded-full bg-white/10 px-2 py-0.5">{row.quality}</span>
                      <span>{formatBytes(row.bytes)}</span>
                      {row.durationSeconds > 0 ? <span>{formatDuration(row.durationSeconds)}</span> : null}
                      {/* Burned into the picture, so it can't be turned off later
                          — worth stating on the row. */}
                      {row.subtitleLabel ? (
                        <span className="rounded-full bg-white/10 px-2 py-0.5">
                          Subs: {row.subtitleLabel}
                        </span>
                      ) : null}
                    </div>

                    <div
                      className={`mt-2 text-[12px] ${
                        row.status === 'failed' ? 'text-red-300' : 'text-foreground/70'
                      }`}
                    >
                      {statusLabel(row)}
                    </div>

                    {row.status !== 'ready' && row.status !== 'resolving' ? (
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[var(--bliss-accent)] transition-[width] duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.status === 'ready' ? (
                        <Button
                          size="sm"
                          className="rounded-full bg-white text-black"
                          isDisabled={!caps.canPlay}
                          onPress={() => void playOffline(row)}
                        >
                          Play
                        </Button>
                      ) : null}
                      {isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10"
                          onPress={() => void pauseDownload(row.id)}
                        >
                          Pause
                        </Button>
                      ) : null}
                      {row.status === 'paused' || row.status === 'failed' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10"
                          onPress={() => void resumeDownload(row.id)}
                        >
                          Resume
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-white/10"
                        onPress={() => void handleRemove(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
