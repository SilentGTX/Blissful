// Bitcine-style unified settings panel. Tabs at the top
// (Quality / Subtitles / Servers) switch the content body. Each tab:
//   - Quality: list of quality buckets + per-row heart to mark a
//     favorite quality that's auto-selected on future plays.
//   - Subtitles: list view = pick a language (any track for that
//     language), with a "Customize Appearance" sub-screen for font
//     size / color / latency / save-to-account.
//   - Servers: PLAYER_SERVERS rows with selection + favorite heart.
//
// Bag of props mirrors the inline version's state references — kept
// flat for simplicity rather than refactoring the player's state into
// a context just for this panel. If the prop count keeps growing,
// that refactor becomes the next move.

import { AnimatePresence, motion } from 'framer-motion';
import { BlissTabs } from '../base';
import { useState, type MutableRefObject } from 'react';
import { StremioIcon, type StremioIconName } from '../PlayerControlIcons';
import { PLAYER_SERVERS } from '../../lib/playerServers';
import { BananasPicker } from '../BananasPicker';
import {
  type SubtitleTrack,
  isEmbeddedOrigin,
  scoreSubtitleTrack,
  subtitleLangLabel,
} from '../../lib/subtitleUtils';
import type { PlayerSettings } from '../../lib/playerSettings';
import { writeStoredPlayerSettings } from '../../lib/playerSettings';

export type QualityOption = { label: string; quality: string };

/** An audio track of a transcoded source. `i` maps to ffmpeg `-map 0:a:i`. */
export type TranscodeAudioTrack = {
  i: number;
  lang: string | null;
  title: string | null;
  channels: number | null;
  codec: string | null;
};

export type SettingsTab = 'quality' | 'subtitles' | 'servers' | 'releases' | 'audio';

/** A selectable Real-Debrid release/torrent for the fallback "change torrent" picker. */
export type ReleaseOption = {
  name: string;
  torrentName: string | null;
  quality: string | null;
  size: string | null;
  seeders: string | null;
  url: string;
};
export type SubtitlesView = 'list' | 'appearance';

export type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;

  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;

  subtitlesView: SubtitlesView;
  onSubtitlesViewChange: (v: SubtitlesView) => void;

  // Quality
  qualityOptions?: QualityOption[];
  selectedQuality?: string | null;
  onSelectQuality?: (q: string) => void;
  favoriteQuality: string | null;
  onSetFavoriteQuality: (q: string | null) => void;

  // Audio tracks (transcoded RD streams) — pick which audio the transcoder muxes
  audioTracks?: TranscodeAudioTrack[];
  selectedAudioTrack?: number;
  onSelectAudioTrack?: (i: number) => void;

  // Subtitles list
  selectedSubtitleKey: string;
  onSelectSubtitleKey: (key: string) => void;
  subtitleLanguages: string[];
  allSubtitleTracks: SubtitleTrack[];
  onSelectLanguage: (lang: string | null) => void;
  userPickedSubtitleRef: MutableRefObject<boolean>;
  autoPickedSubtitleKeyRef: MutableRefObject<string | null>;

  // Subtitles appearance
  subtitleSizePx: number;
  onSubtitleSizePxChange: (px: number) => void;
  subtitleColor: string;
  onSubtitleColorChange: (color: string) => void;
  subtitleDelay: number;
  onSubtitleDelayChange: (delay: number | ((prev: number) => number)) => void;

  // Servers
  hideServerPicker?: boolean;
  selectedServer: string;
  onSelectServer: (id: string) => void;
  unavailableServers: Set<string>;
  favoriteServer: string | null;
  onSetFavoriteServer: (id: string | null) => void;

  // Releases — Real-Debrid fallback "change torrent" picker
  releases?: ReleaseOption[];
  selectedReleaseUrl?: string | null;
  onSelectRelease?: (url: string) => void;

  // Save-to-account button needs both the current settings + sync fn
  playerSettings: PlayerSettings;
  savePlayerSettingsToAccount: (settings: PlayerSettings) => Promise<void>;
};

// Heuristic numeric rank for sorting the quality list high→low. The
// label is whatever Videasy / the addon returned ("1080p", "4K",
// "Original", etc.) so we normalize a few common aliases and fall
// back to the first integer we find in the string.
function qualityRank(label: string): number {
  const lower = label.toLowerCase();
  if (/2160p|4k|uhd|original|org/.test(lower)) return 2160;
  if (/1440p|2k/.test(lower)) return 1440;
  if (/1080p|fhd/.test(lower)) return 1080;
  if (/720p|hd/.test(lower)) return 720;
  if (/480p|sd/.test(lower)) return 480;
  if (/360p/.test(lower)) return 360;
  const m = label.match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}


const SUBTITLE_COLOR_SWATCHES = [
  'rgba(255,255,255,1)',
  'rgba(255,84,112,1)',
  'rgba(189,189,189,1)',
  'rgba(200,255,225,1)',
  'rgba(140,40,230,1)',
  'rgba(230,40,40,1)',
  'rgba(40,210,140,1)',
  'rgba(255,180,40,1)',
  'rgba(255,200,210,1)',
  'rgba(80,160,235,1)',
  'rgba(30,60,140,1)',
  'rgba(245,224,170,1)',
];

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    open,
    onClose,
    tab,
    onTabChange,
    subtitlesView,
    onSubtitlesViewChange,
    qualityOptions,
    selectedQuality,
    onSelectQuality,
    favoriteQuality,
    onSetFavoriteQuality,
    audioTracks,
    selectedAudioTrack,
    onSelectAudioTrack,
    selectedSubtitleKey,
    onSelectSubtitleKey,
    subtitleLanguages,
    allSubtitleTracks,
    onSelectLanguage,
    userPickedSubtitleRef,
    autoPickedSubtitleKeyRef,
    subtitleSizePx,
    onSubtitleSizePxChange,
    subtitleColor,
    onSubtitleColorChange,
    subtitleDelay,
    onSubtitleDelayChange,
    hideServerPicker,
    selectedServer,
    onSelectServer,
    unavailableServers,
    favoriteServer,
    onSetFavoriteServer,
    releases,
    selectedReleaseUrl,
    onSelectRelease,
    playerSettings,
    savePlayerSettingsToAccount,
  } = props;

  // Which language the subtitle list is "drilled into" — null = top-level
  // language list; non-null = showing all variants for that language
  // (e.g. clicking "English" expands to every track tagged English,
  // including each OpenSubtitles release). Local state — the picker
  // forgets the drill on close, which is fine: the next open shows the
  // language list again.
  const [drilledLang, setDrilledLang] = useState<string | null>(null);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-40 flex items-start justify-end gap-3 bg-black/90 p-4 pb-24 md:bg-black/30 md:px-8 md:pb-28 md:pt-28 [@media(max-height:520px)]:!p-2"
          onClick={onClose}
        >
          {/* On short-height (landscape phone) screens the panel is scaled down
              (zoom) so all the rows + tabs fit without the giant md: padding
              squishing them — "more zoomed out, everything visible". */}
          <motion.div
            initial={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.85 }}
            className="pointer-events-auto flex max-h-full w-[80%] flex-col gap-3 md:w-[420px] [@media(max-height:520px)]:gap-1.5 [@media(max-height:520px)]:[zoom:0.8] [@media(max-height:400px)]:[zoom:0.7]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tabs + close row — floats above the content panel with
                a small gap between them, matching the bitcine floating-
                modal layout. */}
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              <BlissTabs
                selectedKey={tab}
                onSelectionChange={(k) => onTabChange(k as SettingsTab)}
              >
                <BlissTabs.ListContainer>
                  <BlissTabs.List aria-label="Player settings">
                    {qualityOptions && qualityOptions.length > 1 ? (
                      <BlissTabs.Tab id="quality">
                        Quality
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    ) : null}
                    {audioTracks && audioTracks.length > 1 ? (
                      <BlissTabs.Tab id="audio">
                        Audio
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    ) : null}
                    <BlissTabs.Tab id="subtitles">
                      Subtitles
                      <BlissTabs.Indicator />
                    </BlissTabs.Tab>
                    {hideServerPicker ? null : (
                      <BlissTabs.Tab id="servers">
                        Servers
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    )}
                    {releases && releases.length > 0 ? (
                      <BlissTabs.Tab id="releases">
                        Releases
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    ) : null}
                  </BlissTabs.List>
                </BlissTabs.ListContainer>
              </BlissTabs>
              <button
                type="button"
                className="pointer-events-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
                onClick={onClose}
                aria-label="Close"
              >
                <StremioIcon name={'x' as StremioIconName} className="h-4 w-4" />
              </button>
            </div>

            {/* Content panel — separate rounded card under the
                floating tab row. Flex column so the Customize
                Appearance row can stick to the bottom while the
                language list scrolls behind it. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101116]/95 shadow-2xl backdrop-blur-md">
              <div className="flex-1 overflow-auto p-3">
                {/* QUALITY */}
                {tab === 'quality' && qualityOptions ? (
                  <div className="flex flex-col gap-1">
                    {/* Sort high-to-low so the highest resolution sits
                        on top — that's the option users typically
                        reach for first. Parses leading digits of the
                        quality label (1080p → 1080, 4K → 4000, etc.).
                        Unknown labels sink to the bottom. */}
                    {[...qualityOptions]
                      .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
                      .map((opt) => {
                      const isSelected = opt.quality === selectedQuality;
                      const isFav =
                        favoriteQuality != null
                        && favoriteQuality.toLowerCase() === opt.quality.toLowerCase();
                      const is4K = /4k|2160p|uhd|original|org/i.test(opt.quality);
                      const isFullHd = !is4K && /1080/.test(opt.quality);
                      const isHd = !is4K && !isFullHd && /720/.test(opt.quality);
                      return (
                        <button
                          key={opt.quality}
                          type="button"
                          className={
                            'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition ' +
                            (isSelected ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]' : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                          }
                          onClick={() => {
                            onSelectQuality?.(opt.quality);
                            onClose();
                          }}
                        >
                          <span>{opt.label}</span>
                          <div className="flex items-center gap-2">
                            {is4K ? (
                              <span className="rounded bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                                Ultra HD
                              </span>
                            ) : isFullHd ? (
                              <span className="rounded bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                                Full HD
                              </span>
                            ) : isHd ? (
                              <span className="rounded bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                                HD
                              </span>
                            ) : null}
                            <span
                              role="button"
                              tabIndex={0}
                              aria-pressed={isFav}
                              aria-label={isFav ? 'Unfavorite quality' : 'Favorite quality'}
                              className="cursor-pointer rounded-full p-1.5 hover:bg-white/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSetFavoriteQuality(isFav ? null : opt.quality);
                              }}
                            >
                              <StremioIcon
                                name={(isFav ? 'heart-filled' : 'heart') as StremioIconName}
                                className={'h-5 w-5 ' + (isFav ? 'text-red-500' : 'text-white/50')}
                              />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* AUDIO — pick which audio track the transcoder muxes */}
                {tab === 'audio' && audioTracks ? (
                  <div className="flex flex-col gap-1">
                    {audioTracks.map((t) => {
                      const isSelected = t.i === (selectedAudioTrack ?? 0);
                      const lang = t.lang ? subtitleLangLabel(t.lang) : null;
                      const chLabel = t.channels === 6 ? '5.1' : t.channels === 8 ? '7.1'
                        : t.channels === 2 ? 'Stereo' : t.channels === 1 ? 'Mono'
                        : t.channels ? `${t.channels}ch` : null;
                      const primary = lang || t.title || `Track ${t.i + 1}`;
                      const meta = [t.codec ? t.codec.toUpperCase() : null, chLabel].filter(Boolean).join(' · ');
                      return (
                        <button
                          key={t.i}
                          type="button"
                          className={
                            'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition ' +
                            (isSelected ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]' : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                          }
                          onClick={() => {
                            if (!isSelected) onSelectAudioTrack?.(t.i);
                            onClose();
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{primary}</div>
                            {t.title && t.title !== primary ? (
                              <div className="truncate text-xs text-white/55">{t.title}</div>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {meta ? (
                              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">{meta}</span>
                            ) : null}
                            {isSelected ? (
                              <StremioIcon name={'check' as StremioIconName} className="h-5 w-5 text-[var(--bliss-accent)]" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* SUBTITLES — language list */}
                {tab === 'subtitles' && subtitlesView === 'list' ? (
                  drilledLang == null ? (
                    /* Language list — clicking a row drills into its
                       variants instead of auto-picking the best one.
                       That auto-pick was hiding OpenSubtitles releases
                       behind the embedded track for the same language;
                       the drill-down surfaces every variant. */
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className={
                          'flex cursor-pointer items-center justify-between rounded-xl px-4 py-3 text-left transition ' +
                          (selectedSubtitleKey === 'off'
                            ? 'bg-white/10 text-white'
                            : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                        }
                        onClick={() => {
                          userPickedSubtitleRef.current = true;
                          autoPickedSubtitleKeyRef.current = null;
                          onSelectSubtitleKey('off');
                          onSelectLanguage(null);
                          try { window.localStorage.removeItem('blissful.subtitleLang'); } catch { /* ignore */ }
                        }}
                      >
                        <span>Off</span>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                          No Subtitles
                        </span>
                      </button>
                      {subtitleLanguages.map((lang) => {
                        const rowCanon = subtitleLangLabel(lang);
                        const sameCanon = (l: string) => subtitleLangLabel(l) === rowCanon;
                        const hasEmbedded = allSubtitleTracks.some(
                          (t) => sameCanon(t.lang) && isEmbeddedOrigin(t.origin),
                        );
                        const langTracks = allSubtitleTracks.filter((t) => sameCanon(t.lang));
                        const selectedInLang = langTracks.some((t) => t.key === selectedSubtitleKey);
                        const variantCount = langTracks.length;
                        return (
                          <button
                            key={lang}
                            type="button"
                            className={
                              'flex cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition ' +
                              (selectedInLang
                                ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                                : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                            }
                            onClick={() => setDrilledLang(lang)}
                          >
                            <span>{rowCanon}</span>
                            <span className="flex items-center gap-2">
                              {hasEmbedded ? (
                                <span className="rounded bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                                  Built-in
                                </span>
                              ) : null}
                              {variantCount > 1 ? (
                                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                                  {variantCount} variants
                                </span>
                              ) : null}
                              <span className="text-white/40">›</span>
                            </span>
                          </button>
                        );
                      })}
                      {allSubtitleTracks.length === 0 ? (
                        <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-white/60">No subtitles available</div>
                      ) : null}
                    </div>
                  ) : (
                    /* Variants for the drilled language — every track
                       (embedded + each addon release) shown with its
                       origin label so the user can pick a specific
                       OpenSubtitles release if the auto-pick mistimed. */
                    (() => {
                      const rowCanon = subtitleLangLabel(drilledLang);
                      const sameCanon = (l: string) => subtitleLangLabel(l) === rowCanon;
                      const langTracks = allSubtitleTracks
                        .filter((t) => sameCanon(t.lang))
                        .slice()
                        .sort((a, b) => {
                          const sa = scoreSubtitleTrack(a);
                          const sb = scoreSubtitleTrack(b);
                          if (sb !== sa) return sb - sa;
                          return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
                        });
                      return (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className="flex cursor-pointer items-center gap-2 self-start rounded-full px-2 py-1 text-sm text-white/80 hover:bg-white/10"
                            onClick={() => setDrilledLang(null)}
                          >
                            <span>‹</span>
                            <span>{rowCanon}</span>
                          </button>
                          {langTracks.map((track) => {
                            const isSelected = track.key === selectedSubtitleKey;
                            const isEmbedded = isEmbeddedOrigin(track.origin);
                            const isOpenSub = track.origin.toLowerCase().includes('opensubtitles');
                            const tagClass = isEmbedded
                              ? 'bg-[var(--bliss-accent)]/20 text-[var(--bliss-accent)]'
                              : isOpenSub
                                ? 'bg-yellow-500/20 text-yellow-200'
                                : 'bg-white/10 text-white/70';
                            return (
                              <button
                                key={track.key}
                                type="button"
                                className={
                                  'flex cursor-pointer flex-col gap-1 rounded-xl px-4 py-3 text-left transition ' +
                                  (isSelected
                                    ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                                    : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                                }
                                onClick={() => {
                                  userPickedSubtitleRef.current = true;
                                  autoPickedSubtitleKeyRef.current = null;
                                  onSelectLanguage(drilledLang);
                                  onSelectSubtitleKey(track.key);
                                }}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate">{track.label || track.origin || 'Subtitle'}</span>
                                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tagClass}`}>
                                    {isEmbedded ? 'Built-in' : isOpenSub ? 'OpenSubs' : track.origin}
                                  </span>
                                </span>
                                {!isEmbedded && track.label && track.label !== track.origin ? (
                                  <span className="text-[11px] text-white/45">{track.origin}</span>
                                ) : null}
                              </button>
                            );
                          })}
                          {langTracks.length === 0 ? (
                            <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-white/60">No variants found</div>
                          ) : null}
                        </div>
                      );
                    })()
                  )
                ) : null}

                {/* SUBTITLES — customize appearance sub-screen */}
                {tab === 'subtitles' && subtitlesView === 'appearance' ? (
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-2 self-start rounded-full px-2 py-1 text-sm text-white/80 hover:bg-white/10"
                      onClick={() => onSubtitlesViewChange('list')}
                    >
                      <span>‹</span>
                      <span>Back to Subtitles</span>
                    </button>

                    {/* Font Size */}
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-white/90">Font Size</span>
                        <span className="text-sm font-semibold text-[var(--bliss-accent)]">{subtitleSizePx}px</span>
                      </div>
                      <input
                        type="range"
                        min={14}
                        max={120}
                        step={1}
                        value={subtitleSizePx}
                        className="bliss-player-range h-1 w-full cursor-pointer appearance-none rounded-full"
                        onChange={(e) => onSubtitleSizePxChange(Number.parseInt(e.target.value, 10))}
                      />
                    </div>

                    {/* Color swatches */}
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <div className="mb-3 text-sm font-medium text-white/90">Color</div>
                      <div className="grid grid-cols-6 gap-2">
                        {SUBTITLE_COLOR_SWATCHES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Subtitle color ${c}`}
                            className={
                              'h-9 w-full cursor-pointer rounded-lg border-2 transition ' +
                              (subtitleColor === c ? 'border-white' : 'border-white/10 hover:border-white/40')
                            }
                            style={{ backgroundColor: c }}
                            onClick={() => onSubtitleColorChange(c)}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Latency */}
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium text-white/90">Latency</span>
                        <span className="text-sm font-semibold text-[var(--bliss-accent)]">
                          {subtitleDelay >= 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange((v: number) => Math.max(-30, +(v - 0.5).toFixed(1)))}
                        >
                          -0.5s
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange(0)}
                        >
                          {subtitleDelay.toFixed(1)}
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange((v: number) => Math.min(30, +(v + 0.5).toFixed(1)))}
                        >
                          +0.5s
                        </button>
                      </div>
                    </div>

                    {/* Reset / Save */}
                    <button
                      type="button"
                      className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-semibold text-white/85 hover:bg-white/10"
                      onClick={() => {
                        onSubtitleSizePxChange(playerSettings.subtitlesSizePx);
                        onSubtitleColorChange(playerSettings.subtitlesTextColor);
                        onSubtitleDelayChange(0);
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded-xl bg-gradient-to-b from-red-500 to-red-600 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/30 hover:from-red-500 hover:to-red-700"
                      onClick={() => {
                        const next = {
                          ...playerSettings,
                          subtitlesSizePx: subtitleSizePx,
                          subtitlesTextColor: subtitleColor,
                        };
                        try {
                          writeStoredPlayerSettings(next);
                        } catch {
                          /* localStorage may be full/disabled */
                        }
                        // Persist to MongoDB via blissful-storage so the
                        // choice follows the account, matching the
                        // /settings page's save flow.
                        void savePlayerSettingsToAccount(next).catch(() => {
                          /* sync failure non-fatal — localStorage holds
                             the value and useStoredStateSync will retry */
                        });
                        onClose();
                      }}
                    >
                      Save to account
                    </button>
                  </div>
                ) : null}

                {/* SERVERS */}
                {tab === 'servers' ? (
                  <div className="flex flex-col gap-1">
                    {PLAYER_SERVERS.map((srv) => {
                      const isSelected = selectedServer === srv.id;
                      const isFav = favoriteServer === srv.id;
                      const isUnavailable = unavailableServers.has(srv.id);
                      return (
                        <button
                          key={srv.id}
                          type="button"
                          disabled={isUnavailable}
                          className={
                            'flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ' +
                            (isSelected
                              ? 'cursor-pointer bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                              : isUnavailable
                                ? 'bg-white/[0.03] text-white/35 line-through cursor-not-allowed'
                                : 'cursor-pointer bg-white/[0.04] text-white/85 hover:bg-white/10')
                          }
                          onClick={() => {
                            if (isUnavailable) return;
                            onSelectServer(srv.id);
                            onClose();
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="text-2xl leading-none">{srv.flag}</span>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{srv.name}</div>
                              <div className="truncate text-xs text-white/55">
                                {srv.audio}
                                {srv.notes ? ` (${srv.notes})` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isSelected ? (
                              <StremioIcon name={'check' as StremioIconName} className="h-5 w-5 text-[var(--bliss-accent)]" />
                            ) : null}
                            <span
                              role="button"
                              tabIndex={0}
                              aria-pressed={isFav}
                              aria-label={isFav ? 'Unfavorite server' : 'Favorite server'}
                              className="cursor-pointer rounded-full p-1.5 hover:bg-white/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSetFavoriteServer(isFav ? null : srv.id);
                              }}
                            >
                              <StremioIcon
                                name={(isFav ? 'heart-filled' : 'heart') as StremioIconName}
                                className={'h-5 w-5 ' + (isFav ? 'text-red-500' : 'text-white/50')}
                              />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* RELEASES — switch the Real-Debrid torrent. Cached-only,
                    sorted by seeders/√size, grouped by resolution — mirrors
                    the detail-page stream list. */}
                {tab === 'releases' ? (
                  <BananasPicker
                    releases={releases ?? []}
                    selectedReleaseUrl={selectedReleaseUrl}
                    onSelectRelease={onSelectRelease}
                    onClose={onClose}
                  />
                ) : null}
              </div>

              {/* Sticky footer — Customize Appearance row, only on the
                  subtitle LIST view. The language list above scrolls
                  underneath it so the trigger is always reachable
                  without scrolling to the bottom. */}
              {tab === 'subtitles' && subtitlesView === 'list' ? (
                <div className="border-t border-white/10 bg-[#101116] p-3">
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-left text-white/85 transition hover:bg-white/10"
                    onClick={() => onSubtitlesViewChange('appearance')}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">🎨</span>
                      <span>Customize Appearance</span>
                    </span>
                    <span className="text-white/40">›</span>
                  </button>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
