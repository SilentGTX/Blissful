// Unified settings panel -- tabs at the top (Audio / Subtitles) switch
// the content body. Matches OpenCode's BlissfulPlayer SettingsPanel
// visual layout, adapted for our mpv backend (mpv tracks instead of
// HTML5 TextTracks, mpv commands instead of videoRef).
//
// Audio tab: lists every audio track from mpv's track-list.
// Subtitles tab: language list -> drill into variants (embedded +
//   addon), with a "Customize Appearance" sub-screen for font size,
//   color, delay.

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { PlayerControlIcon as StremioIcon, type StremioIconName } from '../PlayerControlIcons';
import type { MpvTrack } from '../../lib/desktop';
import { isAndroidTv, isTvMode } from '../../lib/platform';
import { subtitleLangLabel } from './subtitleHelpers';
import {
  writeStoredPlayerSettings,
  type PlayerSettings,
} from '../../lib/playerSettings';

export type SettingsTab = 'audio' | 'subtitles';
export type SubtitlesView = 'list' | 'appearance';

type SubtitleVariant = {
  key: string;
  label: string;
  origin: string;
  embedded: boolean;
};

export type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;

  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;

  // Audio
  tracks: MpvTrack[];
  audioId: number | string | null;
  selectAudio: (id: number | 'no') => void;

  // Subtitles list
  selectedSubKey: string;
  selectedSubLang: string | null;
  /** Canonical language of the track that is actually playing (derived
   *  from `selectedSubKey`). Drives which language row is highlighted, so
   *  the highlight follows what's on screen rather than the browse cursor
   *  (`selectedSubLang`). */
  activeSubLang: string | null;
  setSelectedSubLang: (lang: string | null) => void;
  combinedSubLanguages: string[];
  variantsForLanguage: SubtitleVariant[];
  /** Per-canonical-lang variant count (embedded + addon). Computed by the
   *  parent so the language list can show "N VARIANTS" before drilling. */
  variantCountByLang?: Record<string, number>;
  applySubtitleSelection: (key: string) => Promise<void> | void;

  // Subtitles appearance
  subtitleSizePx: number;
  onSubtitleSizePxChange: (px: number) => void;
  subtitleColor: string;
  onSubtitleColorChange: (color: string) => void;
  subtitleDelay: number;
  onSubtitleDelayChange: (value: number) => void;

  // Save-to-account
  playerSettings: PlayerSettings;
};

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
    tracks,
    audioId,
    selectAudio,
    selectedSubKey,
    activeSubLang,
    setSelectedSubLang,
    combinedSubLanguages,
    variantsForLanguage,
    variantCountByLang,
    applySubtitleSelection,
    subtitleSizePx,
    onSubtitleSizePxChange,
    subtitleColor,
    onSubtitleColorChange,
    subtitleDelay,
    onSubtitleDelayChange,
    playerSettings,
  } = props;

  const [subtitlesView, setSubtitlesView] = useState<SubtitlesView>('list');
  // Which language the subtitle list is "drilled into"
  const [drilledLang, setDrilledLang] = useState<string | null>(null);

  const audioTracks = tracks.filter((t) => t.kind === 'audio');

  // === TV: D-pad navigation inside the panel ============================
  // The player pauses Norigin and stands its own keyboard handler down while
  // this panel is open (settingsPanelOpenRef), so the panel owns the D-pad.
  // We do NOT call Norigin resume() here (unlike useTvOverlay) — the player
  // keeps the engine paused for its whole session; resuming would re-activate
  // page navigation underneath the still-mounted player. Up/Down/Left/Right
  // walk the visible buttons in DOM order, OK clicks the lit one, Back closes.
  const panelRef = useRef<HTMLDivElement>(null);
  // Signature of the currently-rendered list. When it changes (tab switch,
  // drill in/out, appearance toggle) we re-seed focus onto the first row so
  // the cursor never strands on a node that just unmounted.
  const viewSig = `${tab}|${subtitlesView}|${drilledLang ?? ''}`;
  useEffect(() => {
    if (!open || !isTvMode()) return;
    const FOCUSABLE =
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const r = panelRef.current;
      if (!r) return;
      const active = document.activeElement as HTMLElement | null;
      // Leave the user's focus alone once they're driving inside the panel.
      if (active && r.contains(active)) return;
      // Prefer the first row in the scrollable content list (e.g. "Off" /
      // first track / the "‹ back" row after drilling in) over the tab/close
      // buttons in the header — so a fresh open or a view change lands the
      // cursor where the user actually picks, not on the tab. Tabs + close
      // stay reachable by pressing Up.
      const first =
        r.querySelector<HTMLElement>(`.bliss-tv-navlist ${FOCUSABLE}`) ??
        r.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    };
    const timers = [0, 80, 200].map((ms) => window.setTimeout(focusFirst, ms));

    const handler = (e: KeyboardEvent) => {
      const r = panelRef.current;
      if (!r) return;
      const active = document.activeElement as HTMLElement | null;
      const inRoot = !!active && r.contains(active);
      const focusLost = !active || active === document.body;
      // Only react when we own focus (or it was lost and needs reclaiming).
      if (!inRoot && !focusLost) return;
      timers.forEach((t) => window.clearTimeout(t));

      const k = e.key;
      const isBack =
        k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || e.keyCode === 10009;
      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const isOk =
        k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Select' ||
        e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;
      if (isOk) {
        // Android System WebView doesn't synthesize a click for a
        // programmatically-focused button (desktop Chrome does), so click it
        // ourselves there; in browser ?tv=1 we let the native Enter→click run.
        if (isAndroidTv()) {
          e.preventDefault();
          e.stopPropagation();
          if (inRoot && active) active.click();
        }
        return;
      }
      const isArrow =
        k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight';
      if (!isArrow) return;
      const isInput = active?.tagName === 'INPUT';
      // On a range slider, Left/Right adjust the value natively — let them pass.
      if (isInput && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
      const focusables = Array.from(r.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!focusables.length) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = inRoot && active ? focusables.indexOf(active) : -1;
      const delta = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
      const next = focusables[(idx + delta + focusables.length) % focusables.length];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('keydown', handler, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewSig]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-40 flex items-start justify-end gap-3 bg-black/30 px-8 pb-28 pt-28"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            initial={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.85 }}
            className="bliss-tv-navpanel pointer-events-auto flex max-h-full w-[420px] flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tabs + close row */}
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              <div className="flex items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-md">
                {audioTracks.length > 0 ? (
                  <button
                    type="button"
                    className={
                      'cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium capitalize outline-none transition ' +
                      (tab === 'audio'
                        ? 'bg-white/15 text-white'
                        : 'text-white/60 hover:text-white')
                    }
                    onClick={() => onTabChange('audio')}
                  >
                    Audio
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    'cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium capitalize outline-none transition ' +
                    (tab === 'subtitles'
                      ? 'bg-white/15 text-white'
                      : 'text-white/60 hover:text-white')
                  }
                  onClick={() => onTabChange('subtitles')}
                >
                  Subtitles
                </button>
              </div>
              <button
                type="button"
                className="pointer-events-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
                onClick={onClose}
                aria-label="Close"
              >
                <StremioIcon name={'x' as StremioIconName} className="h-4 w-4" />
              </button>
            </div>

            {/* Content panel */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101116]/95 shadow-2xl backdrop-blur-md">
              <div className="bliss-tv-navlist flex-1 overflow-auto p-3">
                {/* AUDIO */}
                {tab === 'audio' ? (
                  <div className="flex flex-col gap-1">
                    {audioTracks.length === 0 ? (
                      <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-white/60">
                        No audio tracks
                      </div>
                    ) : (
                      audioTracks.map((t) => {
                        const active = t.selected || audioId === t.id;
                        const label = t.title ?? t.lang ?? t.codec ?? `Track ${t.id}`;
                        const meta = [t.lang, t.codec].filter(Boolean).join(' · ');
                        return (
                          <button
                            key={`a-${t.id}`}
                            type="button"
                            className={
                              'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition ' +
                              (active
                                ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                                : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                            }
                            onClick={() => {
                              selectAudio(t.id);
                              onClose();
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            <div className="flex items-center gap-2">
                              {meta ? (
                                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                                  {meta}
                                </span>
                              ) : null}
                              {active ? (
                                <StremioIcon
                                  name={'check' as StremioIconName}
                                  className="h-5 w-5 text-[var(--bliss-accent)]"
                                />
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}

                {/* SUBTITLES -- language list */}
                {tab === 'subtitles' && subtitlesView === 'list' ? (
                  drilledLang == null ? (
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className={
                          'flex cursor-pointer items-center justify-between rounded-xl px-4 py-3 text-left transition ' +
                          (selectedSubKey === 'off'
                            ? 'bg-white/10 text-white'
                            : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                        }
                        onClick={() => {
                          void applySubtitleSelection('off');
                        }}
                      >
                        <span>Off</span>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                          No Subtitles
                        </span>
                      </button>
                      {combinedSubLanguages.map((lang) => {
                        const rowCanon = subtitleLangLabel(lang);
                        const sameCanon = (l: string) => subtitleLangLabel(l) === rowCanon;
                        const hasEmbedded = tracks.some(
                          (t) =>
                            t.kind === 'sub' &&
                            sameCanon((t.lang ?? 'unknown').toLowerCase()),
                        );
                        // Total variant count from the parent's precomputed map
                        const totalVariants = variantCountByLang?.[rowCanon] ?? 0;
                        // Highlight the language whose track is actually
                        // playing (activeSubLang, derived from the active
                        // sid), not the browse cursor (selectedSubLang) —
                        // otherwise the picker can mark a language that
                        // isn't the one on screen.
                        const isSelectedInLang =
                          activeSubLang != null &&
                          subtitleLangLabel(activeSubLang) === rowCanon;
                        return (
                          <button
                            key={lang}
                            type="button"
                            className={
                              'flex cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition ' +
                              (isSelectedInLang
                                ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                                : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                            }
                            onClick={() => {
                              setDrilledLang(lang);
                              setSelectedSubLang(lang);
                            }}
                          >
                            <span>{rowCanon}</span>
                            <span className="flex items-center gap-2">
                              {hasEmbedded ? (
                                <span className="rounded bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                                  Built-in
                                </span>
                              ) : null}
                              {totalVariants > 1 ? (
                                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                                  {totalVariants} variants
                                </span>
                              ) : null}
                              <span className="text-white/40">&rsaquo;</span>
                            </span>
                          </button>
                        );
                      })}
                      {combinedSubLanguages.length === 0 ? (
                        <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-white/60">
                          No subtitles available
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    /* Variants for the drilled language */
                    (() => {
                      const rowCanon = subtitleLangLabel(drilledLang);
                      return (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className="flex cursor-pointer items-center gap-2 self-start rounded-full px-2 py-1 text-sm text-white/80 hover:bg-white/10"
                            onClick={() => setDrilledLang(null)}
                          >
                            <span>&lsaquo;</span>
                            <span>{rowCanon}</span>
                          </button>
                          {variantsForLanguage.map((v) => {
                            const isSelected = selectedSubKey === v.key;
                            const isEmbedded = v.embedded;
                            const tagClass = isEmbedded
                              ? 'bg-[var(--bliss-accent)]/20 text-[var(--bliss-accent)]'
                              : 'bg-white/10 text-white/70';
                            return (
                              <button
                                key={v.key}
                                type="button"
                                className={
                                  'flex cursor-pointer flex-col gap-1 rounded-xl px-4 py-3 text-left transition ' +
                                  (isSelected
                                    ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
                                    : 'bg-white/[0.04] text-white/85 hover:bg-white/10')
                                }
                                onClick={() => {
                                  void applySubtitleSelection(v.key);
                                }}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    {v.embedded ? subtitleLangLabel(drilledLang) : v.label || v.origin || 'Subtitle'}
                                  </span>
                                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tagClass}`}>
                                    {isEmbedded ? 'Built-in' : v.origin}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                          {variantsForLanguage.length === 0 ? (
                            <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-white/60">
                              No variants found
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  )
                ) : null}

                {/* SUBTITLES -- customize appearance sub-screen */}
                {tab === 'subtitles' && subtitlesView === 'appearance' ? (
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-2 self-start rounded-full px-2 py-1 text-sm text-white/80 hover:bg-white/10"
                      onClick={() => setSubtitlesView('list')}
                    >
                      <span>&lsaquo;</span>
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
                        max={56}
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
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange(Math.max(-30, +(subtitleDelay - 0.5).toFixed(1)))}
                        >
                          -0.5s
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange(0)}
                        >
                          {subtitleDelay.toFixed(1)}
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-xl bg-white/[0.06] py-3 text-sm font-medium text-white hover:bg-white/10"
                          onClick={() => onSubtitleDelayChange(Math.min(30, +(subtitleDelay + 0.5).toFixed(1)))}
                        >
                          +0.5s
                        </button>
                      </div>
                    </div>

                    {/* Reset */}
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

                    {/* Save to account */}
                    <button
                      type="button"
                      className="cursor-pointer rounded-xl bg-[var(--bliss-accent)] py-3 text-sm font-semibold text-black shadow-lg hover:brightness-90"
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
                        onClose();
                      }}
                    >
                      Save to account
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Sticky footer -- Customize Appearance row */}
              {tab === 'subtitles' && subtitlesView === 'list' ? (
                <div className="border-t border-white/10 bg-[#101116] p-3">
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-left text-white/85 transition hover:bg-white/10"
                    onClick={() => setSubtitlesView('appearance')}
                  >
                    <span className="flex items-center gap-2">
                      <StremioIcon name="settings" className="h-4 w-4" />
                      <span>Customize Appearance</span>
                    </span>
                    <span className="text-white/40">&rsaquo;</span>
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
