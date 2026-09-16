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
import { requestPersistentStorage, type OfflineQuality } from '../lib/offlineStore';
import type { EmbeddedSubtitle } from '../lib/offlineDownloader';
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
  /** Fired once something is downloading into the library — the caller routes to
   *  /downloads so progress is visible. */
  onSavedToLibrary?: () => void;
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
  onSavedToLibrary,
}: OfflineDownloadModalProps) {
  const isBatch = (batchEpisodes?.length ?? 0) > 0;
  const isMobile = useIsMobile();
  const [quality, setQuality] = useState<OfflineQuality>('1080p');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  /** An explicit choice from the release list, which overrides the ranking.
   *  Null — the normal case — means "whatever the ranking picked". */
  const [chosen, setChosen] = useState<BananaOption | null>(null);
  const [listOpen, setListOpen] = useState(false);

  /** The modal stays mounted between openings (it renders null when closed), so
   *  without this a release pinned for one episode would still be pinned when
   *  the next one opens — pointing at a completely different file. */
  useEffect(() => {
    setChosen(null);
    setListOpen(false);
  }, [isOpen, metaId, videoId]);

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

  /** Real-Debrid cache state, read from the release name — the addons write it
   *  there as `[RD+]`/`[RD⚡]` (ready now) or `[RD download]` (RD has to fetch
   *  the torrent first, so the link 404s until it has). Shared by the ranking
   *  and the list's badge so the two can't disagree. */
  const cacheStateOf = (rel: BananaOption): 'cached' | 'uncached' | 'unknown' => {
    const hay = `${rel.name} ${rel.torrentName ?? ''}`;
    if (/\[\s*RD\s*(?:download|↓|⬇)/iu.test(hay)) return 'uncached';
    if (/\[\s*RD\s*[+⚡]/iu.test(hay) || /cached/i.test(hay)) return 'cached';
    return 'unknown';
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
        const state = cacheStateOf(r);
        return {
          r,
          rank: state === 'uncached' ? 2 : state === 'cached' ? 0 : 1,
          short: sourceHeightOf(r) < minHeight ? 1 : 0,
          bytes: sizeBytesOf(r.size) ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.short - b.short || a.bytes - b.bytes)
      .map((s) => s.r);
  };

  const ranked = isBatch ? [] : rankedFor(quality);
  const picked = isBatch ? null : chosen ?? ranked[0] ?? null;
  /** Nothing to pick from when the rung has a single candidate. */
  const canChoose = ranked.length > 1;

  /** English full-dialogue track, text preferred (it becomes a real WebVTT track
   *  during playback; a bitmap one can't be shown at all for a copied file). */
  const autoSubtitleOf = (subs: EmbeddedSubtitle[]): EmbeddedSubtitle | null => {
    const english = subs.filter((s) => /^en/i.test(s.lang ?? '') || /english/i.test(s.title ?? ''));
    const notSigns = english.filter((s) => !/sign|song/i.test(s.title ?? ''));
    const pool = notSigns.length > 0 ? notSigns : english;
    return pool.find((s) => s.textBased) ?? pool[0] ?? null;
  };

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

  // ── Into the offline library ───────────────────────────────────────────────
  // Same bytes as the browser download, but stored in the app so /downloads can
  // list and play them. The proxy hop that makes it possible (Real-Debrid sends
  // no CORS headers) costs ~4%: 21.5 MB/s measured against 22.4 direct.

  const handleSaveToLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isBatch && batchEpisodes) {
        setStatus('Preparing episodes…');
        const { queueFileEpisodes } = await import('../lib/offlineBatch');
        const result = await queueFileEpisodes({
          addons: (addonUrls ?? []).map((u) => ({ transportUrl: u, manifest: {} }) as never),
          type,
          metaId,
          poster: poster ?? null,
          title,
          episodes: batchEpisodes,
          quality,
          onProgress: (p) =>
            setStatus(`Preparing… ${p.done}/${p.total}${p.current ? ` · ${p.current}` : ''}`),
        });
        if (result.failed.length > 0) {
          notifyError(
            `${result.failed.length} episode${result.failed.length === 1 ? '' : 's'} couldn’t start`,
            `No usable release for: ${result.failed.slice(0, 3).join(', ')}${result.failed.length > 3 ? '…' : ''}`
          );
        }
        onSavedToLibrary?.();
        onClose();
        return;
      }

      // Single: probe a few candidates so the file actually contains Japanese
      // audio and text subtitles when they exist anywhere.
      setStatus('Checking releases…');
      const { probeReleases, bestProbed, rankReleasesForDownload, qualityForHeight } =
        await import('../lib/offlineBatch');
      // An explicit choice is the whole list: the probe below still runs on it
      // (it reads the real audio/subtitle tracks and video properties) but has
      // nothing to switch to, so what was chosen is what gets downloaded.
      let candidates = chosen ? [chosen.url] : ranked.map((r) => r.url);
      if (candidates.length === 0) {
        const { fetchFallbackReleases } = await import('../lib/fallbackReleases');
        const found = await fetchFallbackReleases({
          type,
          id: videoId ?? metaId,
          addons: (addonUrls ?? []).map((u) => ({ transportUrl: u, manifest: {} }) as never),
          showTitle: title,
        });
        candidates = rankReleasesForDownload(found, quality);
      }
      const best = bestProbed(await probeReleases(candidates, 4));
      const url = best?.url ?? candidates[0];
      if (!url) {
        notifyError('No release available', 'Nothing downloadable was found for this.');
        setBusy(false);
        setStatus(null);
        return;
      }
      setStatus('Starting…');
      const { fetchPosterBlob, prepareSubtitle } = await import('../lib/offlineDownloader');
      const track = best ? autoSubtitleOf(best.subs) : null;
      const [posterBlob, prepared] = await Promise.all([
        fetchPosterBlob(poster ?? null),
        track ? prepareSubtitle(url, track) : Promise.resolve({ vtt: null }),
      ]);
      const { startFileDownload } = await import('../lib/fileDownloader');
      await requestPersistentStorage();
      await startFileDownload({
        metaId,
        type,
        videoId,
        title,
        subtitle: subtitle ?? null,
        poster: poster ?? null,
        posterBlob,
        sourceUrl: url,
        // What the file IS, measured — not the rung that was asked for.
        quality: best?.video ? qualityForHeight(best.video.height) : quality,
        fileVideo: best?.video ?? null,
        subtitleVtt: prepared.vtt,
        subtitleLabel:
          prepared.vtt && track
            ? `${(track.lang ?? 'und').toUpperCase()}${track.title ? ` · ${track.title}` : ''}`
            : null,
      });
      notifySuccess('Saving to your library', `${safeName(subtitle)} — watch it in Downloads.`);
      onSavedToLibrary?.();
      onClose();
    } catch (err: unknown) {
      notifyError(
        'Could not start the download',
        err instanceof Error ? err.message : 'Release lookup failed.'
      );
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
                  onClick={() => {
                    setQuality(q);
                    setChosen(null);
                  }}
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

        {/* What was picked, so the size isn't a surprise — and a way out of it.
            The ranking is right most of the time, but "most" is not "always": a
            release can be mislabelled, carry the wrong audio, or just be the one
            that stalled. Tapping the card opens the same ranked list the pick
            came from, and choosing a row pins it. Contents are phrasing-only
            (`span`, not `div`) because the header is a `button`. */}
        {picked ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => setListOpen((open) => !open)}
              disabled={!canChoose}
              aria-expanded={listOpen}
              className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${
                canChoose ? 'cursor-pointer hover:bg-white/[0.07]' : 'cursor-default'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  {chosen ? 'Your pick' : 'Picked automatically'}
                </span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-white/75">
                  {picked.name}
                </span>
                {picked.size ? (
                  <span className="mt-0.5 block text-[11px] text-white/45">{picked.size}</span>
                ) : null}
              </span>
              {canChoose ? (
                <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[11px] font-semibold text-[var(--bliss-accent)]">
                  {listOpen ? 'Close' : `${ranked.length} options`}
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 transition-transform ${listOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              ) : null}
            </button>

            {listOpen ? (
              <div className="max-h-64 overflow-y-auto border-t border-white/10">
                {ranked.map((rel) => {
                  const state = cacheStateOf(rel);
                  const active = rel.url === picked.url;
                  return (
                    <button
                      key={rel.url}
                      type="button"
                      onClick={() => {
                        setChosen(rel);
                        setListOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition ${
                        active ? 'bg-[var(--bliss-accent)]/15' : 'hover:bg-white/[0.07]'
                      }`}
                    >
                      <span
                        className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                          active ? 'bg-[var(--bliss-accent)]' : 'bg-white/25'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[12px] leading-snug text-white/80">
                          {rel.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45">
                          {rel.size ? <span>{rel.size}</span> : null}
                          {rel.seeders ? <span>{rel.seeders} seeders</span> : null}
                          {state === 'cached' ? (
                            <span className="text-[var(--bliss-accent)]">Ready now</span>
                          ) : null}
                          {state === 'uncached' ? (
                            <span className="text-amber-300/80">RD must fetch it first</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Into the app first: it's what the Downloads page can show and play.
            Never disabled for want of a release list — with none, the handlers do
            their own lookup (the house fallback usually has one). */}
        <button
          type="button"
          onClick={() => void handleSaveToLibrary()}
          disabled={busy}
          className="mt-4 w-full cursor-pointer rounded-xl bg-[var(--bliss-accent)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-default disabled:opacity-50"
        >
          {busy
            ? status ?? 'Working…'
            : isBatch
              ? `Save ${batchEpisodes?.length ?? 0} episodes to library`
              : 'Save to library'}
        </button>
        <div className="mt-2 text-[11px] leading-relaxed text-white/45">
          Stored in Blissful, so it shows up in Downloads and plays there with no
          connection. Nothing is re-encoded, so it runs at full speed.
          {isBatch ? ' Episodes download one after another — keep Blissful open.' : ''}
        </div>

        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
            Or straight to your computer
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={isBatch ? () => void handleBatch('download') : () => void handleDownloadFile()}
              disabled={busy}
              className="min-w-0 flex-1 cursor-pointer rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-default disabled:opacity-50"
            >
              {isBatch ? `Download ${batchEpisodes?.length ?? 0} files` : 'Download file'}
            </button>
            <button
              type="button"
              onClick={isBatch ? () => void handleBatch('vlc') : () => void handleOpenInVlc()}
              disabled={busy}
              className="shrink-0 cursor-pointer rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-default disabled:opacity-50"
            >
              {isBatch ? 'VLC playlist' : 'Open in VLC'}
            </button>
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-white/40">
            Saved by your browser instead of the app — it won’t appear in Downloads.
            VLC / IINA handle MKV, HEVC and AC3 natively.
          </div>
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
