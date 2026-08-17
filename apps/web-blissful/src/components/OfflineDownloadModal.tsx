// "Download for offline" — pick a quality rung, pick a release, queue it.
//
// Quality comes first because it's the decision that matters: the segments are
// stored verbatim on the device, so the rung IS the download size, and phone
// storage is the binding constraint (iOS also evicts it under pressure). The
// release picker is the same BananasPicker used by the detail page and the
// in-player Releases drawer, so ranking/dedup/RD-cache markers behave
// identically here.
//
// Only Real-Debrid-backed releases can be downloaded: every segment is produced
// by the proxy's /transcode-seg from a direct HTTP source. A raw torrent (no
// debrid) has no such URL, so those rows are filtered out upstream by the
// caller passing only rd-resolvable releases.

import { useEffect, useMemo, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { BlissModal } from './base';
import { CloseIcon } from '../icons/CloseIcon';
import { proxiedImage } from '../lib/imageProxy';
import { BananasPicker, type BananaOption } from './BananasPicker';
import {
  detectOfflineCapabilities,
  offlineBootWarning,
  offlineDurabilityWarning,
} from '../lib/offlineCapabilities';
import {
  estimateDownloadBytes,
  estimateStorage,
  findDownloadFor,
  formatBytes,
  OFFLINE_QUALITIES,
  requestPersistentStorage,
  type OfflineDownload,
  type OfflineQuality,
} from '../lib/offlineStore';
import {
  fetchAudioTracks,
  fetchEmbeddedSubtitles,
  startDownload,
  type EmbeddedAudio,
  type EmbeddedSubtitle,
} from '../lib/offlineDownloader';
import { pickPreferredAudioTrack } from '../lib/audioTracks';
import { useStorage } from '../context/StorageProvider';
import { notifyError, notifySuccess } from '../lib/toastQueues';

export type OfflineDownloadModalProps = {
  isOpen: boolean;
  metaId: string;
  type: string;
  videoId: string | null;
  title: string;
  /** "S1E2 - Episode name", shown under the title and stored with the download. */
  subtitle?: string | null;
  poster?: string | null;
  /** Downloadable releases (RD-resolvable only). */
  releases: BananaOption[];
  /** True while the release list is still being fetched — opening the modal from
   *  an episode card is what triggers that episode's stream fetch, so an empty
   *  list means "still loading", not "nothing to download". */
  releasesLoading?: boolean;
  onClose: () => void;
  /** Fired once a download has been queued — the caller usually routes to
   *  /downloads so progress is visible. */
  onQueued?: (download: OfflineDownload) => void;
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

/** Default rung by device: a phone gets 540p (a 2-hour film lands near 1.1 GB),
 *  anything bigger gets 720p. Deliberately conservative — the user can raise it,
 *  and an over-large download that gets evicted is worse than a smaller one that
 *  survives. */
function defaultQuality(): OfflineQuality {
  if (typeof window === 'undefined') return '720p';
  return window.innerWidth < 820 ? '540p' : '720p';
}

export function OfflineDownloadModal({
  isOpen,
  metaId,
  type,
  videoId,
  title,
  subtitle,
  poster,
  releases,
  releasesLoading = false,
  onClose,
  onQueued,
}: OfflineDownloadModalProps) {
  const isMobile = useIsMobile();
  const caps = useMemo(() => detectOfflineCapabilities(), []);
  const [quality, setQuality] = useState<OfflineQuality>(defaultQuality);
  const [starting, setStarting] = useState(false);
  const [existing, setExisting] = useState<OfflineDownload | null>(null);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  // Subtitle step: picking a release reveals its embedded tracks, because they
  // can only be probed once we know which file we're downloading. Nothing is
  // fetched until then.
  const [pendingRelease, setPendingRelease] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<EmbeddedSubtitle[] | null>(null);
  const [chosenSub, setChosenSub] = useState<number | null>(null);
  // Audio is chosen per download too: a dual-audio anime release usually has the
  // English dub as track 0, so "just take the first track" gets it wrong for
  // exactly the content people download most.
  const [audios, setAudios] = useState<EmbeddedAudio[] | null>(null);
  const [chosenAudio, setChosenAudio] = useState(0);
  const { playerSettings } = useStorage();

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const [found, storage] = await Promise.all([
        findDownloadFor(metaId, videoId),
        estimateStorage(),
      ]);
      if (cancelled) return;
      // Reopening after a failed start should offer the picker again, not the
      // "Preparing…" state left behind by the previous attempt.
      setStarting(false);
      setExisting(found);
      setFreeBytes(
        storage.quota != null && storage.usage != null ? storage.quota - storage.usage : null
      );
    })();
    return () => { cancelled = true; };
  }, [isOpen, metaId, videoId]);

  if (!isOpen) return null;

  const durability = offlineDurabilityWarning(caps);
  // Louder than `durability`: without a service worker the app can't even open
  // offline, so the download would be unreachable exactly when it's needed.
  const bootWarning = offlineBootWarning(caps);
  // Per-hour figures: the true total isn't known until the proxy reports the
  // real duration, which happens when the download starts.
  const perHour = (q: OfflineQuality) => formatBytes(estimateDownloadBytes(3600, q));

  /** A release was chosen → probe it for embedded subtitle tracks and let the
   *  user burn one in. Auto-selects a full-dialogue English track when there is
   *  an obvious one, since that's what almost everyone wants. */
  const handleChooseRelease = async (url: string) => {
    if (starting) return;
    setPendingRelease(url);
    setSubtitles(null);
    setAudios(null);
    const [foundSubs, foundAudio] = await Promise.all([
      fetchEmbeddedSubtitles(url),
      fetchAudioTracks(url),
    ]);
    setSubtitles(foundSubs);
    setAudios(foundAudio);

    const english = foundSubs.filter(
      (s) => /^en/i.test(s.lang ?? '') || /english/i.test(s.title ?? '')
    );
    // Prefer a "Full"/dialogue track over a "Signs/Songs" one — the latter only
    // captions on-screen text and songs, so it looks broken as a main subtitle.
    const full =
      english.find((s) => /full|dialog/i.test(s.title ?? '') ) ??
      english.find((s) => !/sign|song/i.test(s.title ?? '')) ??
      english[0] ??
      null;
    setChosenSub(full ? full.index : null);

    // Audio default: JAPANESE WINS when the release has it.
    //
    // Track 0 is the wrong default for the content people download most: this
    // very release lists `0: eng` (dub) before `1: jpn`, which is how a download
    // came back with English audio on an anime. The presence of a Japanese track
    // is itself a strong signal that the original language is Japanese, and it
    // doesn't depend on the id namespace — the same show is reachable as both
    // `kitsu:244` and `tt0434665`, so sniffing the id would have missed it.
    // Otherwise fall back to the profile's preference, then track 0. The picker
    // below shows the choice either way, so overriding is one tap.
    const japanese = pickPreferredAudioTrack(foundAudio, 'Japanese');
    const preferred = pickPreferredAudioTrack(foundAudio, playerSettings.audioLanguage);
    setChosenAudio(japanese ?? preferred ?? 0);
  };

  const audioLabelFor = (a: EmbeddedAudio): string => {
    const lang = (a.lang ?? 'und').toUpperCase();
    const bits = [a.title, a.channels ? `${a.channels}ch` : null, a.codec?.toUpperCase()].filter(Boolean);
    return bits.length ? `${lang} · ${bits.join(' · ')}` : lang;
  };

  const subtitleLabelFor = (s: EmbeddedSubtitle): string => {
    const lang = (s.lang ?? 'und').toUpperCase();
    const bitmap = !s.textBased;
    return `${s.title ? `${lang} · ${s.title}` : lang}${bitmap ? ' (image)' : ''}`;
  };

  const handlePick = async (url: string) => {
    if (starting) return;
    setStarting(true);
    try {
      // Best-effort durability request. Chrome grants it for engaged origins;
      // WebKit doesn't implement it, so a false is expected on iOS and is not
      // treated as a failure (the Home Screen nudge covers that case).
      await requestPersistentStorage();
      const download = await startDownload({
        metaId,
        type,
        videoId,
        title,
        subtitle: subtitle ?? null,
        poster: poster ?? null,
        sourceUrl: url,
        quality,
        audioTrackIdx: chosenAudio,
        subtitleTrack: (subtitles ?? []).find((s) => s.index === chosenSub) ?? null,
        subtitleLabel:
          chosenSub != null
            ? subtitleLabelFor(
                (subtitles ?? []).find((s) => s.index === chosenSub) ?? {
                  index: chosenSub,
                  lang: null,
                  title: null,
                  codec: null,
                  textBased: false,
                }
              )
            : null,
      });
      notifySuccess(
        'Download started',
        `${subtitle ? `${title} - ${subtitle}` : title} in ${quality}`
      );
      onQueued?.(download);
      onClose();
    } catch (err: unknown) {
      notifyError(
        'Download failed to start',
        err instanceof Error ? err.message : 'Could not start the download.'
      );
      setStarting(false);
    }
  };

  // The two halves of the dialog. Stacked in the mobile sheet; side by side on
  // desktop, where a single tall column left the release list in a narrow strip
  // and wrapped the quality chips onto a second row.
  const infoPanel = (
    <>
      {poster ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${proxiedImage(poster)})` }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/75 to-[#101116]" />
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
          Download for offline
        </div>
        <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {subtitle ? <div className="mt-1 text-sm font-medium text-white/75">{subtitle}</div> : null}

        {caps.blockedReason ? (
          <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-[12px] leading-relaxed text-red-200 ring-1 ring-red-400/20">
            {caps.blockedReason}
          </div>
        ) : (
          <>
            {existing ? (
              <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-[12px] leading-relaxed text-white/70 ring-1 ring-white/10">
                Already {existing.status === 'ready' ? 'downloaded' : 'in your downloads'} in{' '}
                {existing.quality}. Downloading again adds a second copy.
              </div>
            ) : null}

            <div className="mt-4">
              {/* Called "Save as", NOT "Quality": the release list below is also
                  grouped by quality (4K/1080p/720p), and having two things
                  labelled quality in one dialog read as being asked twice. This
                  one is what the file is re-encoded to — i.e. its size. */}
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                Save as
              </div>
              <div className="mb-2 text-[11px] leading-relaxed text-white/40">
                How it's stored on this device — the release you pick below can be
                any source quality.
              </div>
              {/* Even 2x2 grid rather than wrapping flex — four chips in a
                  340px column otherwise orphan 1080p onto its own row. */}
              <div className="grid grid-cols-2 gap-2">
                {OFFLINE_QUALITIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={`cursor-pointer rounded-xl px-3 py-2 text-left transition ${
                      quality === q
                        ? 'bg-[var(--bliss-accent)] text-black'
                        : 'bg-white/10 text-white/80 ring-1 ring-white/10 hover:bg-white/15'
                    }`}
                  >
                    <div className="text-sm font-semibold">{q}</div>
                    <div
                      className={`text-[10px] ${quality === q ? 'text-black/65' : 'text-white/50'}`}
                    >
                      ~{perHour(q)}/h
                    </div>
                  </button>
                ))}
              </div>
              {freeBytes != null ? (
                <div className="mt-2 text-[11px] text-white/45">
                  {formatBytes(freeBytes)} free on this device
                </div>
              ) : null}
            </div>

            {bootWarning ? (
              <div className="mt-4 rounded-xl bg-red-500/12 px-4 py-3 text-[12px] leading-relaxed text-red-200 ring-1 ring-red-400/30">
                <div className="mb-1 font-semibold">This browser can’t play downloads offline</div>
                {bootWarning}
              </div>
            ) : null}

            {durability ? (
              <div className="mt-3 rounded-xl bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100/90 ring-1 ring-amber-300/20">
                {durability}
              </div>
            ) : null}

            <div className="mt-3 rounded-xl bg-white/5 px-4 py-3 text-[12px] leading-relaxed text-white/60 ring-1 ring-white/10">
              Keep Blissful open while it downloads — browsers can’t download in
              the background{caps.hasWakeLock ? '. The screen is kept awake for you.' : ', and this browser can’t keep your screen awake, so turn off auto-lock.'}
            </div>

          </>
        )}
      </div>
    </>
  );

  const choicePanel = caps.blockedReason ? null : (
    <div className="relative px-5 pb-5 md:px-0 md:pb-0">
            <div className="mt-4 md:mt-0">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                  Choose a release
                </div>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">
                  {releases.length}
                </span>
              </div>
              {starting ? (
                <div className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-white/70 ring-1 ring-white/10">
                  Preparing the download…
                </div>
              ) : pendingRelease ? (
                /* Subtitle step. Burned into the picture, so it must be decided
                   BEFORE downloading — the segments are encoded with it. */
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  {subtitles == null || audios == null ? (
                    <div className="py-4 text-center text-sm text-white/70">
                      Checking this release for audio and subtitles…
                    </div>
                  ) : (
                    <>
                      {/* Audio first: on a dual-audio anime release track 0 is
                          usually the English dub, so this is the setting most
                          likely to be wrong if left alone. */}
                      {audios.length > 1 ? (
                        <>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                            Audio
                          </div>
                          <div className="mb-3 space-y-1.5">
                            {audios.map((a) => (
                              <button
                                key={a.i}
                                type="button"
                                onClick={() => setChosenAudio(a.i)}
                                className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition ${
                                  chosenAudio === a.i
                                    ? 'bg-[var(--bliss-accent)] text-black'
                                    : 'bg-white/[0.06] text-white/80 hover:bg-white/10'
                                }`}
                              >
                                {audioLabelFor(a)}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}

                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                        Subtitles
                      </div>
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setChosenSub(null)}
                          className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition ${
                            chosenSub == null
                              ? 'bg-[var(--bliss-accent)] text-black'
                              : 'bg-white/[0.06] text-white/80 hover:bg-white/10'
                          }`}
                        >
                          None
                        </button>
                        {subtitles.map((s) => (
                          <button
                            key={s.index}
                            type="button"
                            onClick={() => setChosenSub(s.index)}
                            className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition ${
                              chosenSub === s.index
                                ? 'bg-[var(--bliss-accent)] text-black'
                                : 'bg-white/[0.06] text-white/80 hover:bg-white/10'
                            }`}
                          >
                            {subtitleLabelFor(s)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[11px] leading-relaxed text-white/45">
                        {subtitles.length === 0
                          ? 'This release has no embedded subtitles. It will download without them.'
                          : chosenSub != null && subtitles.find((s) => s.index === chosenSub)?.textBased === false
                            ? 'Image subtitles are burned into the picture (the only way they can show in a browser), so this can’t be changed afterwards.'
                            : 'Saved alongside the video and switchable during playback. Audio and subtitles are fixed once the download starts.'}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePick(pendingRelease)}
                          className="flex-1 cursor-pointer rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPendingRelease(null); setSubtitles(null); }}
                          className="cursor-pointer rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15"
                        >
                          Back
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : releases.length > 0 ? (
                <div className="-mx-1 max-h-[42vh] overflow-y-auto px-1">
                  <BananasPicker
                    releases={releases}
                    onSelectRelease={(url) => void handleChooseRelease(url)}
                    relevanceTitle={title}
                    verifyCache
                  />
                </div>
              ) : releasesLoading ? (
                <div className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-white/70 ring-1 ring-white/10">
                  Finding releases…
                </div>
              ) : (
                <div className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/60 ring-1 ring-white/10">
                  No downloadable release found. Offline downloads need a
                  Real-Debrid release — check your Real-Debrid key in Settings.
                </div>
              )}
            </div>
    </div>
  );

  const bodyContent = (
    <>
      {infoPanel}
      {choicePanel}
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
          className="solid-surface pointer-events-auto relative max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-[#101116] text-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15" />
          {bodyContent}
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
          {/* HeroUI's `lg` dialog caps at 512px, which is what squeezed the
              release list into a strip. Widen the frame itself. */}
          <BlissModal.Dialog className="w-full max-w-[940px]">
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Download for offline</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
              {/* Desktop: a wide dialog split in two — the decisions (quality,
                  storage, warnings) on the left over the artwork, the long
                  release list scrolling on its own on the right. The previous
                  single 460px column made a 600-release list unusable and
                  wrapped the four quality chips onto two rows. */}
              <div className="solid-surface relative mx-auto grid max-h-[86vh] w-full max-w-[900px] grid-cols-[minmax(0,340px)_minmax(0,1fr)] overflow-hidden rounded-[24px] bg-[#101116]">
                <div className="relative overflow-y-auto">{infoPanel}</div>
                <div className="relative flex min-h-0 flex-col overflow-y-auto border-l border-white/10 p-5">
                  {choicePanel}
                </div>
              </div>
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}

export default OfflineDownloadModal;
