// Three-column subtitle picker: Languages | Variants | Settings.
// Mirrors the panel SimplePlayer ships on the web build. Addon-fetched
// subs and embedded mpv tracks (kind === 'sub') share the same modal
// — embedded variants get an "EMBEDDED" pill so the user can tell them
// apart. Settings column ports the SimplePlayer controls (delay, size,
// vertical position, three color slots) 1:1.
//
// Extracted from NativeMpvPlayer so a parent re-render caused by an
// mpv tick or addon fetch doesn't repaint the (substantial) popover
// JSX. Memoised so unchanged props skip the re-render entirely.

import React from 'react';
import type { MpvTrack } from '../../lib/desktop';
import { subtitleLangLabel } from './subtitleHelpers';

type ParsedColor = { hex: string; alpha: number };
type SubtitleVariant = {
  key: string;
  origin: string;
  embedded: boolean;
};
type ColorSlot = 'text' | 'bg' | 'outline';

export type SubtitleMenuPopoverProps = {
  tracks: MpvTrack[];

  selectedSubKey: string;
  selectedSubLang: string | null;
  setSelectedSubLang: (lang: string | null) => void;

  combinedSubLanguages: string[];
  variantsForLanguage: SubtitleVariant[];
  firstVariantKeyForLanguage: (lang: string) => string | null;
  applySubtitleSelection: (key: string) => Promise<void> | void;

  subtitleDelay: number;
  setSubtitleDelay: (value: number) => void;

  subtitleSizePx: number;
  applySubtitleSize: (value: number) => void;

  subtitleVerticalPercent: number;
  setSubtitleVerticalPercent: (value: number) => void;

  subtitleTextParsed: ParsedColor;
  subtitleBgParsed: ParsedColor;
  subtitleOutlineParsed: ParsedColor;
  openColorPopover: (slot: ColorSlot, anchor: HTMLElement) => void;

  onClose: () => void;
};

export const SubtitleMenuPopover = React.memo(function SubtitleMenuPopover({
  tracks,
  selectedSubKey,
  selectedSubLang,
  setSelectedSubLang,
  combinedSubLanguages,
  variantsForLanguage,
  firstVariantKeyForLanguage,
  applySubtitleSelection,
  subtitleDelay,
  setSubtitleDelay,
  subtitleSizePx,
  applySubtitleSize,
  subtitleVerticalPercent,
  setSubtitleVerticalPercent,
  subtitleTextParsed,
  subtitleBgParsed,
  subtitleOutlineParsed,
  openColorPopover,
  onClose,
}: SubtitleMenuPopoverProps) {
  return (
    // Full-screen transparent backdrop intercepts outside clicks. The
    // panel itself stops propagation so only clicks AROUND the panel
    // close it.
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div
        className="absolute right-6 bottom-32 w-[min(820px,94vw)] rounded-2xl border border-white/10 bg-black/85 p-3 text-sm text-white backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_240px]">
          {/* Column 1 — Subtitles Languages */}
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">
              Subtitles Languages
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 p-1">
              <button
                type="button"
                className={
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                  (selectedSubKey === 'off' ? 'bg-white/10' : '')
                }
                onClick={() => {
                  setSelectedSubLang(null);
                  void applySubtitleSelection('off');
                  onClose();
                }}
              >
                <span>Off</span>
                {selectedSubKey === 'off' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                ) : null}
              </button>

              {combinedSubLanguages.map((lang) => {
                // "EMBEDDED" tag fires if ANY embedded sub matches
                // the canonical of this row's lang — handles cases
                // where the row's raw lang is "english" (from addon)
                // but the embedded track is "eng".
                const rowCanon = subtitleLangLabel(lang);
                const embeddedCount = tracks.filter(
                  (t) =>
                    t.kind === 'sub' &&
                    subtitleLangLabel((t.lang ?? 'unknown').toLowerCase()) === rowCanon,
                ).length;
                return (
                  <button
                    key={lang}
                    type="button"
                    className={
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                      (selectedSubLang === lang ? 'bg-white/10' : '')
                    }
                    onClick={() => {
                      setSelectedSubLang(lang);
                      // Auto-apply the first variant for this language
                      // so users don't have to take a second click —
                      // matches the existing on-mount auto-pick
                      // behavior but for manual language switches.
                      const key = firstVariantKeyForLanguage(lang);
                      if (key) void applySubtitleSelection(key);
                    }}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span>{subtitleLangLabel(lang)}</span>
                      {embeddedCount > 0 ? (
                        <span className="rounded bg-[#19f7d2]/20 px-1 text-[9px] uppercase tracking-wider text-[#19f7d2]">
                          embedded
                        </span>
                      ) : null}
                    </span>
                    {selectedSubLang === lang ? (
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                    ) : null}
                  </button>
                );
              })}

              {combinedSubLanguages.length === 0 ? (
                <div className="px-3 py-2 text-xs text-white/60">No subtitles</div>
              ) : null}
            </div>
          </div>

          {/* Column 2 — Subtitles Variants */}
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">
              Subtitles Variants
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 p-1">
              {selectedSubLang ? (
                variantsForLanguage.length > 0 ? (
                  variantsForLanguage.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className={
                        'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                        (selectedSubKey === v.key ? 'bg-white/10' : '')
                      }
                      onClick={() => {
                        void applySubtitleSelection(v.key);
                        onClose();
                      }}
                    >
                      {/* Per user spec: just `Language` on top and
                          `Embedded`/`<addon name>` underneath. Hide
                          the raw codec/title (dvd_subtitle, eng,
                          etc.) — those are useless to a viewer. */}
                      <span className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white/90">
                          {subtitleLangLabel(selectedSubLang)}
                        </div>
                        <div className="truncate text-xs text-white/60">
                          {v.embedded ? 'Embedded' : v.origin}
                        </div>
                      </span>
                      {selectedSubKey === v.key ? (
                        <span className="mt-1 h-2 w-2 rounded-full bg-emerald-300" />
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-white/60">No variants</div>
                )
              ) : (
                <div className="px-3 py-2 text-xs text-white/60">Choose a language</div>
              )}
            </div>
          </div>

          {/* Column 3 — Subtitles Settings (ports SimplePlayer 1:1) */}
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">
              Subtitles Settings
            </div>
            <div className="space-y-4 rounded-xl border border-white/10 p-3 text-xs text-white/70">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Delay (s)</span>
                  <span>{subtitleDelay.toFixed(1)}</span>
                </div>
                <input
                  className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  value={subtitleDelay}
                  onChange={(e) => setSubtitleDelay(Number.parseFloat(e.target.value))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Size</span>
                  <span>{subtitleSizePx}px</span>
                </div>
                <input
                  className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                  type="range"
                  min={16}
                  max={64}
                  step={2}
                  value={subtitleSizePx}
                  onChange={(e) => applySubtitleSize(Number.parseFloat(e.target.value))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Vertical Position</span>
                  <span>
                    {subtitleVerticalPercent === 0
                      ? 'default'
                      : `${subtitleVerticalPercent > 0 ? '+' : ''}${subtitleVerticalPercent}`}
                  </span>
                </div>
                <input
                  className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={subtitleVerticalPercent}
                  onChange={(e) => setSubtitleVerticalPercent(Number.parseFloat(e.target.value))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Text color</span>
                  <span>{subtitleTextParsed.alpha === 0 ? 'transparent' : subtitleTextParsed.hex.toUpperCase()}</span>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                  onClick={(event) => openColorPopover('text', event.currentTarget)}
                >
                  {subtitleTextParsed.alpha === 0 ? (
                    <span className="text-xs text-white/60">transparent</span>
                  ) : (
                    <span
                      className="h-5 w-full rounded border border-white/20"
                      style={{ background: subtitleTextParsed.hex }}
                    />
                  )}
                </button>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Background</span>
                  <span>{subtitleBgParsed.alpha === 0 ? 'transparent' : subtitleBgParsed.hex.toUpperCase()}</span>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                  onClick={(event) => openColorPopover('bg', event.currentTarget)}
                >
                  {subtitleBgParsed.alpha === 0 ? (
                    <span className="text-xs text-white/60">transparent</span>
                  ) : (
                    <span
                      className="h-5 w-full rounded border border-white/20"
                      style={{ background: subtitleBgParsed.hex }}
                    />
                  )}
                </button>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span>Outline</span>
                  <span>{subtitleOutlineParsed.alpha === 0 ? 'transparent' : subtitleOutlineParsed.hex.toUpperCase()}</span>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                  onClick={(event) => openColorPopover('outline', event.currentTarget)}
                >
                  {subtitleOutlineParsed.alpha === 0 ? (
                    <span className="text-xs text-white/60">transparent</span>
                  ) : (
                    <span
                      className="h-5 w-full rounded border border-white/20"
                      style={{ background: subtitleOutlineParsed.hex }}
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
