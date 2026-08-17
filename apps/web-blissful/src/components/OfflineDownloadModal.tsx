// "Download" — hand the release file straight to the browser, or to VLC.
//
// This used to offer a second path: re-encode the release into HLS segments and
// store them in IndexedDB so they'd play inside Blissful offline. That path is
// gone. It was measured at ~0.8 MB/s (the Mac transcodes in real time and every
// segment is decoded and re-encoded), against ~58 MB/s for the same file pulled
// directly on a 500 Mbit line — 70x slower, for a file VLC can already play as
// it is. Three episodes before a flight is minutes one way and hours the other.
//
// So there is one decision left: which quality of release to fetch. Everything
// else is automatic — Real-Debrid-cached first (an uncached torrent isn't
// downloadable until RD has fetched it), then the smallest file that is at least
// as tall as the chosen rung.
//
// The download itself is a plain navigation. Real-Debrid serves the file as an
// attachment and a torrentio `/resolve/` URL 302s to it, so the browser's own
// downloader takes over at line speed. It lands in the OS downloads folder, not
// in Blissful — the app can't read a file the browser saved, so it can't appear
// in the library. VLC/IINA play MKV, HEVC and AC3 natively, which is exactly
// what a browser won't.

import { useEffect, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { BlissModal } from './base';
import { CloseIcon } from '../icons/CloseIcon';
import { proxiedImage } from '../lib/imageProxy';
import type { BananaOption } from './BananasPicker';
import type { OfflineQuality } from '../lib/offlineStore';
import { isPlaceholderUrl } from '../lib/releaseUrls';
import { notifyError, notifySuccess } from '../lib/toastQueues';

export type OfflineDownloadModalProps = {
  isOpen: boolean;
  metaId: string;
  type: string;
  videoId: string | null;
  title: string;
  /** "S1E2 - Episode name", shown under the title. */
  subtitle?: string | null;
  poster?: string | null;
  /** Downloadable releases (RD-resolvable only). */
  releases: BananaOption[];
  /** Addon transport URLs — batch mode looks up each episode's own releases. */
  addonUrls?: string[];
  /** True while the release list is still being fetched — opening the modal from
   *  an episode card is what triggers that episode's stream fetch, so an empty
   *  list means "still loading", not "nothing to download". */
  releasesLoading?: boolean;
  onClose: () => void;
  /** BATCH mode: several episodes at once. `releases` is irrelevant here (each
   *  episode has its own list, looked up when the download is started). */
  batchEpisodes?: Array<{ videoId: string; label: string }>;
};

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    // No initial setState here: the lazy initializer above already read the
    // width, so syncing again on mount would only cost a cascading render.
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

/** The rungs worth offering for a FILE download — real release resolutions, not
 *  the old transcode ladder (nobody publishes a 540p release; that rung only
 *  existed because the encoder could produce it). Each one means "the smallest
 *  cached release at least this tall". */
const FILE_QUALITIES: Array<{ q: OfflineQuality; label: string; note: string }> = [
  { q: '540p', label: 'SD', note: 'smallest' },
  { q: '720p', label: '720p', note: 'light' },
  { q: '1080p', label: '1080p', note: 'default' },
  { q: '2160p', label: '4K', note: 'largest' },
];

export function OfflineDownloadModal({
  isOpen,
  metaId,
  videoId,
  title,
  subtitle,
  poster,
  releases,
  addonUrls,
  type,
  releasesLoading = false,
  onClose,
  batchEpisodes,
}: OfflineDownloadModalProps) {
  const isBatch = (batchEpisodes?.length ?? 0) > 0;
  const isMobile = useIsMobile();
  const [quality, setQuality] = useState<OfflineQuality>('1080p');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const sizeBytesOf = (raw: string | null): number | null => {
    if (!raw) return null;
    const m = raw.trim().match(/([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|GiB|MiB)/i);
    if (!m) return null;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    const base = m[2].toUpperCase().endsWith('IB') ? 1024 : 1000;
    return m[2].toUpperCase().startsWith('G') ? n * base ** 3 : n * base ** 2;
  };

  /** Source quality bucket of a release, from its name. */
  const sourceHeightOf = (rel: BananaOption | undefined): number => {
    const hay = `${rel?.name ?? ''} ${rel?.torrentName ?? ''} ${rel?.quality ?? ''}`.toLowerCase();
    if (/\b(2160p|4k|uhd)\b/.test(hay)) return 2160;
    if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(hay)) return 1080;
    if (/\b(720p|hd)\b/.test(hay)) return 720;
    if (/\b(480p|360p|sd)\b/.test(hay)) return 480;
    return 1080; // unlabelled: assume 1080p, the common case
  };

  /** Candidates for the chosen rung, best first: Real-Debrid CACHED first (an
   *  uncached torrent 404s/409s until RD fetches it), then tall enough for the
   *  rung, then the smallest file. Rows that are too short stay in the list —
   *  just last — so a title with only an SD release can still be downloaded. */
  const rankedFor = (q: OfflineQuality): BananaOption[] => {
    const minHeight = { '360p': 360, '540p': 480, '720p': 720, '1080p': 1080, '2160p': 2160 }[q];
    return releases
      .filter((r) => !isPlaceholderUrl(r.url))
      .map((r) => {
        const hay = `${r.name} ${r.torrentName ?? ''}`;
        const cached = /\[\s*RD\s*[+⚡]/iu.test(hay) || /cached/i.test(hay);
        const uncached = /\[\s*RD\s*(?:download|↓|⬇)/iu.test(hay);
        return {
          r,
          rank: uncached ? 2 : cached ? 0 : 1,
          short: sourceHeightOf(r) < minHeight ? 1 : 0,
          bytes: sizeBytesOf(r.size) ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.short - b.short || a.bytes - b.bytes)
      .map((s) => s.r);
  };

  const picked = isBatch ? null : rankedFor(quality)[0] ?? null;

  const safeName = (label?: string | null): string =>
    `${title}${label ? ` - ${label}` : ''}`.replace(/[\\/:*?"<>|]+/g, '-').trim();

  /** One playlist entry per file. VLC opens a multi-entry .m3u as a queue, which
   *  is what you want for a run of episodes; it's also the fallback when the
   *  `vlc://` scheme isn't registered. */
  const savePlaylist = (entries: Array<{ label: string; url: string }>, name: string) => {
    const body = `#EXTM3U\n${entries.map((e) => `#EXTINF:-1,${e.label}\n${e.url}`).join('\n')}\n`;
    const href = URL.createObjectURL(new Blob([body], { type: 'audio/x-mpegurl' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `${name || 'stream'}.m3u`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  /** A plain navigation — the `download` attribute is ignored cross-origin, so
   *  don't pretend otherwise; let the browser's downloader do its thing. */
  const startFileDownload = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ── Single episode ─────────────────────────────────────────────────────────

  /** The URL to hand over. The detail page's list is used when it has something
   *  usable, and otherwise the same lookup the batch path uses runs here — the
   *  house /rd-fallback often has debrid-backed releases when the installed
   *  addons return infoHash-only rows (measured: 0 usable rows from the addons,
   *  4 from the fallback for the same episode). Without this the button was dead
   *  on exactly the profiles that need it most. */
  const resolveSingleUrl = async (): Promise<string | null> => {
    if (picked) return picked.url;
    setStatus('Finding a release…');
    const { resolveOriginalUrls } = await import('../lib/offlineBatch');
    const found = await resolveOriginalUrls({
      addons: (addonUrls ?? []).map((u) => ({ transportUrl: u, manifest: {} }) as never),
      type,
      title,
      // A movie has no videoId — its meta id IS the stream id.
      episodes: [{ videoId: videoId ?? metaId, label: subtitle ?? title }],
      quality,
    });
    return found[0]?.url ?? null;
  };

  const handleDownloadFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await resolveSingleUrl();
      if (!url) {
        notifyError('No release available', 'Nothing downloadable was found for this.');
        setBusy(false);
        setStatus(null);
        return;
      }
      startFileDownload(url);
      notifySuccess('Downloading', `${safeName(subtitle)} — your browser is handling it.`);
      onClose();
    } catch (err: unknown) {
      notifyError('Download failed', err instanceof Error ? err.message : 'Release lookup failed.');
      setBusy(false);
      setStatus(null);
    }
  };

  const handleOpenInVlc = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await resolveSingleUrl();
      if (!url) {
        notifyError('No release available', 'Nothing downloadable was found for this.');
        setBusy(false);
        setStatus(null);
        return;
      }
      // VLC registers the `vlc://` scheme on macOS and Windows. If it isn't
      // installed nothing happens, hence the playlist as well.
      try {
        window.location.href = `vlc://${url}`;
      } catch {
        // ignore — the playlist is the fallback
      }
      savePlaylist([{ label: safeName(subtitle), url }], safeName(subtitle));
      onClose();
    } catch (err: unknown) {
      notifyError('Could not open VLC', err instanceof Error ? err.message : 'Release lookup failed.');
      setBusy(false);
      setStatus(null);
    }
  };

  // ── A selection of episodes ────────────────────────────────────────────────

  /** Each episode is a different file, so each needs its own release lookup.
   *  Sequential on purpose: the lookups hit third-party addons and Real-Debrid,
   *  which throttle a burst. */
  const handleBatch = async (mode: 'download' | 'vlc') => {
    if (busy || !batchEpisodes || batchEpisodes.length === 0) return;
    setBusy(true);
    setStatus('Finding releases…');
    try {
      const { resolveOriginalUrls } = await import('../lib/offlineBatch');
      const found = await resolveOriginalUrls({
        addons: (addonUrls ?? []).map((u) => ({ transportUrl: u, manifest: {} }) as never),
        type,
        title,
        episodes: batchEpisodes,
        quality,
        onProgress: (p) =>
          setStatus(`Finding releases… ${p.done}/${p.total}${p.current ? ` · ${p.current}` : ''}`),
      });
      if (found.length === 0) {
        notifyError('Nothing to download', 'No cached release was found for those episodes.');
        setBusy(false);
        setStatus(null);
        return;
      }
      const missing = batchEpisodes.length - found.length;
      if (mode === 'vlc') {
        savePlaylist(found, `${safeName()} - ${found.length} episodes`);
        notifySuccess(
          `Playlist for ${found.length} episode${found.length === 1 ? '' : 's'}`,
          'Open it with VLC to play them in order.'
        );
      } else {
        // Spaced-out navigations: the browser asks once to allow multiple
        // downloads, then runs them itself at full speed.
        for (const [i, f] of found.entries()) {
          startFileDownload(f.url);
          if (i < found.length - 1) await new Promise((r) => setTimeout(r, 900));
        }
        notifySuccess(
          `Downloading ${found.length} file${found.length === 1 ? '' : 's'}`,
          'Allow multiple downloads if your browser asks.'
        );
      }
      if (missing > 0) {
        notifyError(
          `${missing} episode${missing === 1 ? '' : 's'} had no release`,
          'Nothing cached was found for those — try a different quality.'
        );
      }
      onClose();
    } catch (err: unknown) {
      notifyError(
        'Could not prepare the files',
        err instanceof Error ? err.message : 'Release lookup failed.'
      );
      setBusy(false);
      setStatus(null);
    }
  };

  const noReleases = !isBatch && releases.length === 0;

  const body = (
    <>
      {poster ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${proxiedImage(poster)})` }}
          />
          {/* Darker than the other modals' hero wash: this panel is short and
              dense (labels, chips, buttons) sitting straight over the artwork,
              and the lighter gradient left the chips washed out. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/85 to-[#101116]" />
        </>
      ) : null}

      <button
        type="button"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur hover:bg-black/65"
        aria-label="Close"
        onClick={onClose}
      >
        <CloseIcon className="block" size={14} />
      </button>

      <div className="relative h-24" />

      <div className="relative px-5 pb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--bliss-accent)]/90">
          Download
        </div>
        <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {subtitle ? <div className="mt-1 text-sm font-medium text-white/75">{subtitle}</div> : null}

        {/* The one decision: which release. Everything else is automatic. */}
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
            Quality
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
            {FILE_QUALITIES.map(({ q, label, note }) => {
              const best = isBatch ? null : rankedFor(q)[0];
              const size = best?.size ?? null;
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`min-w-0 cursor-pointer rounded-xl px-3 py-2 text-left transition ${
                    quality === q
                      ? 'bg-[var(--bliss-accent)] text-black'
                      : 'bg-white/10 text-white/80 ring-1 ring-white/10 hover:bg-white/15'
                  }`}
                >
                  <div className="truncate text-sm font-semibold">{label}</div>
                  <div
                    className={`truncate text-[10px] ${quality === q ? 'text-black/65' : 'text-white/50'}`}
                  >
                    {size ?? note}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* What was picked, so the size isn't a surprise. */}
        {picked ? (
          <div className="mt-3 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Picked automatically
            </div>
            <div className="mt-0.5 break-words text-[12px] leading-snug text-white/75">
              {picked.name}
            </div>
            {picked.size ? (
              <div className="mt-0.5 text-[11px] text-white/45">{picked.size}</div>
            ) : null}
          </div>
        ) : null}

        {/* Never disabled for want of a release list: with none, the handlers do
            their own lookup (the fallback usually has one). Only `busy` blocks. */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={isBatch ? () => void handleBatch('download') : () => void handleDownloadFile()}
            disabled={busy}
            className="min-w-0 flex-1 cursor-pointer rounded-xl bg-white px-3 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-50"
          >
            {busy
              ? status ?? 'Working…'
              : isBatch
                ? `Download ${batchEpisodes?.length ?? 0} files`
                : 'Download file'}
          </button>
          <button
            type="button"
            onClick={isBatch ? () => void handleBatch('vlc') : () => void handleOpenInVlc()}
            disabled={busy}
            className="shrink-0 cursor-pointer rounded-xl bg-white/10 px-3 py-3 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-default disabled:opacity-50"
          >
            {isBatch ? 'VLC playlist' : 'Open in VLC'}
          </button>
        </div>

        <div className="mt-3 text-[11px] leading-relaxed text-white/45">
          {isBatch
            ? 'Each episode gets its own cached release. Downloads go to your browser’s downloads folder at full speed; the playlist opens all of them in VLC in order.'
            : 'The release as-is, at full speed — nothing is re-encoded. Saved by your browser, and playable in VLC / IINA, which handle MKV, HEVC and AC3 natively.'}
        </div>

        {!isBatch && noReleases && releasesLoading ? (
          <div className="mt-3 text-[11px] text-white/40">Still checking this episode’s releases…</div>
        ) : null}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur"
        onClick={onClose}
      >
        <motion.div
          drag="y"
          dragDirectionLock
          dragConstraints={{ top: 0, bottom: 260 }}
          dragElastic={0}
          dragMomentum={false}
          onDragEnd={(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.y > 95 || info.velocity.y > 700) onClose();
          }}
          initial={{ y: 180, opacity: 0.94 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.85 }}
          className="solid-surface pointer-events-auto relative max-h-[92vh] w-full max-w-[560px] overflow-x-hidden overflow-y-auto rounded-t-[28px] bg-[#101116] text-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15" />
          {body}
        </motion.div>
      </div>
    );
  }

  return (
    <BlissModal>
      <BlissModal.Backdrop
        isOpen={isOpen}
        className="bg-black/55"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <BlissModal.Container size="lg">
          {/* HeroUI's `lg` dialog caps at 512px; the dialog is one column now, so
              a 560px frame is all it needs — and nothing can overflow sideways. */}
          <BlissModal.Dialog className="w-full max-w-[560px]">
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Download</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
              <div className="solid-surface relative mx-auto max-h-[86vh] w-full max-w-[560px] overflow-x-hidden overflow-y-auto rounded-[24px] bg-[#101116]">
                {body}
              </div>
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}

export default OfflineDownloadModal;
