// Bitcine-style "coverflow" episodes drawer that slides in from the
// right while playing a series. Each card is a 16:9 thumbnail; the
// focused card is full size and the neighbours scale down + darken.
// Scroll-snap forces one episode per scroll step so the user can't
// fling from ep 3 to ep 8.
//
// Header: search + season picker + auto-next toggle + close.
//
// IMPORTANT: this component is intentionally a pass-through of state
// and refs from BlissfulPlayer rather than owning them itself. The
// coverflow scroll logic (handleEpisodesScroll, episodesListRef,
// currentEpisodeCardRef, episodesFocusIndex, episodesCountRef) all
// live in the parent because they're tied to keyboard shortcuts and
// the auto-advance flow that lives outside the drawer JSX. Lifting
// them out would mean re-wiring a much larger surface.

import { AnimatePresence, motion } from 'framer-motion';
import { Label, ListBox, Select, Switch } from '@heroui/react';
import { useLayoutEffect, useRef, useState, type Ref } from 'react';
import { StremioIcon } from '../PlayerControlIcons';
import { EpisodeThumbnail } from './EpisodeThumbnail';
import { getProgressPercent } from '../../lib/progressStore';
import { notifyWarning } from '../../lib/toastQueues';

export type EpisodeVideo = {
  id: string;
  title: string | null;
  season: number | null;
  episode: number | null;
  thumbnail: string | null;
  released: string | null;
  description: string | null;
  rating: string | null;
};

export type DrawerSeasonInfo = {
  overview: string | null;
  episodes: Record<number, { runtime: number | null; overview: string | null }>;
};

export type EpisodesDrawerProps = {
  open: boolean;
  onClose: () => void;

  // Stream identity
  type: string | null;
  videos?: EpisodeVideo[];
  videoId: string | null;
  background?: string | null;
  poster: string | null;

  // Season picker
  seriesSeasons: number[];
  episodesSeason: number | null;
  setEpisodesSeason: (n: number) => void;
  currentSeasonInfo: DrawerSeasonInfo | undefined;

  // Search
  episodesSearch: string;
  setEpisodesSearch: (q: string) => void;

  // Auto-advance toggle
  autoNext: boolean;
  setAutoNext: (value: boolean) => void;

  // Coverflow refs + state (owned by parent — see file header)
  episodesListRef: Ref<HTMLDivElement>;
  currentEpisodeCardRef: Ref<HTMLButtonElement>;
  handleEpisodesScroll: () => void;
  /** Suppresses the parent's scroll-handler from re-snapping focusIndex
   *  during programmatic smooth scrolls (click / wheel-step). */
  lockEpisodesScroll: (durationMs?: number) => void;
  episodesFocusIndex: number | null;
  setEpisodesFocusIndex: (n: number | null) => void;
  episodesCountRef: { current: number };

  // Stream identity for progress lookup. type + id + videoId are the
  // progressStore key — we read existing watch progress per episode
  // to render the bottom progress bar.
  progressLookupId: string;
  progressLookupType: string;

  // Called when the user picks a focused episode (play button or
  // clicking the already-focused card). Parent decides whether to
  // prompt resume/start-over or navigate directly.
  onSelectEpisode: (video: EpisodeVideo) => void;
  /** Watch-party gate — when true (= guest in a room), episode
   *  clicks are no-ops, cards render visibly inert, and we show a
   *  hint at the top explaining why. */
  disableSelection?: boolean;
};

export function EpisodesDrawer(props: EpisodesDrawerProps) {
  const {
    open,
    onClose,
    type,
    videos,
    videoId,
    background,
    poster,
    seriesSeasons,
    episodesSeason,
    setEpisodesSeason,
    currentSeasonInfo,
    episodesSearch,
    setEpisodesSearch,
    autoNext,
    setAutoNext,
    episodesListRef,
    currentEpisodeCardRef,
    episodesFocusIndex,
    setEpisodesFocusIndex,
    episodesCountRef,
    progressLookupId,
    progressLookupType,
    onSelectEpisode,
    disableSelection,
  } = props;

  // Videasy-style transform-driven carousel: no native scroll.
  // Stack translates by a JS-computed translateY so the focused card
  // lands at viewport center. Wheel + touch inputs are handled in
  // BlissfulPlayer (one accumulator → step focusIndex by ±N), so the
  // drawer just renders the layout reacting to focusIndex.
  const [stackMetrics, setStackMetrics] = useState({ containerH: 0, cardH: 0, titleH: 0 });
  const titleBlockRef = useRef<HTMLDivElement | null>(null);

  // Season Select sometimes refuses to close after selection — the
  // wheel + touchmove handlers on the episode-list container call
  // `preventDefault`, which can swallow the pointerdown that React
  // Aria uses internally to dismiss the popover. The most reliable
  // close is to bump a key and let the Select remount on every
  // selection; the new instance starts closed by default.
  const [seasonSelectKey, setSeasonSelectKey] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const listEl = (episodesListRef as { current: HTMLDivElement | null }).current;
      if (!listEl) return;
      const cardEl = listEl.querySelector<HTMLElement>('[data-episode-idx="0"]');
      setStackMetrics({
        containerH: listEl.clientHeight,
        cardH: cardEl?.clientHeight ?? 0,
        titleH: titleBlockRef.current?.clientHeight ?? 0,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, episodesListRef, episodesSeason, episodesSearch, videos, currentSeasonInfo]);

  return (
    <AnimatePresence>
      {open && type === 'series' && videos && videos.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-40 flex items-center justify-end gap-3 bg-black/90 p-4 pb-24 md:bg-black/30 md:px-8 md:py-12"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.85 }}
            // Vertical-center + capped panel height, mirroring Videasy's
            // `top-1/2 -translate-y-1/2 ... max-h-[800px]` so the controls
            // (and the episode column under them) stay near the visual
            // middle of the screen no matter how tall the viewport is.
            className="pointer-events-auto flex h-full max-h-[800px] w-[80%] flex-col gap-3 md:w-[520px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Floating header — bitcine-style layout:
                  [ search | season | auto-play ]   [ close ]
                The first three controls live in an outlined "pill
                cluster" (glass-card on dark backdrop). The close
                button sits OUTSIDE that cluster as its own circular
                glass chip — visually separated so dismissing the
                drawer reads as a different action from filtering. */}
            <div className="pointer-events-auto ml-auto flex flex-shrink-0 items-center justify-end gap-2 py-2">
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/45 p-1 backdrop-blur-md md:gap-2">
                <div className="flex h-8 flex-shrink items-center rounded-full border border-white/10 bg-transparent px-2">
                  <svg
                    viewBox="0 0 24 24"
                    className="mr-1.5 h-3.5 w-3.5 flex-shrink-0 text-white"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-12 min-w-0 border-none bg-transparent text-[16px] text-white placeholder-white/80 outline-none transition-all focus:w-20 md:w-20 md:text-[13px] md:focus:w-28"
                    placeholder="Search"
                    value={episodesSearch}
                    onChange={(e) => setEpisodesSearch(e.target.value)}
                  />
                </div>
                {seriesSeasons.length > 1 ? (
                  <Select
                    key={seasonSelectKey}
                    aria-label="Season"
                    selectedKey={episodesSeason != null ? String(episodesSeason) : null}
                    onSelectionChange={(key) => {
                      const n = Number.parseInt(String(key), 10);
                      if (Number.isFinite(n)) setEpisodesSeason(n);
                      // Bump the key so the Select remounts — guarantees
                      // the popover closes even when our parent's
                      // wheel/touch listeners have eaten the
                      // pointerdown React Aria uses internally.
                      setSeasonSelectKey((prev) => prev + 1);
                    }}
                  >
                    <Select.Trigger className="flex h-8 min-h-0 cursor-pointer items-center gap-1 rounded-full border border-white/10 bg-transparent px-2.5 text-[12px] font-medium text-white transition-all hover:bg-white/10 md:text-[13px]">
                      <Select.Value>
                        {() => (
                          <span className="whitespace-nowrap">
                            S{episodesSeason ?? '—'}
                          </span>
                        )}
                      </Select.Value>
                      {/* Plain static chevron — rendering it outside
                          Select.Indicator on purpose so HeroUI's
                          `data-open` rotation class doesn't apply. */}
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {seriesSeasons.map((s) => (
                          <ListBox.Item key={s} id={String(s)} textValue={`Season ${s}`}>
                            Season {s}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : null}
                <Switch
                  isSelected={autoNext}
                  onChange={setAutoNext}
                  aria-label="Auto play"
                  className="flex h-8 cursor-pointer items-center gap-2"
                >
                  {({ isSelected }) => (
                    <>
                      <Switch.Content>
                        <Label className="cursor-pointer text-[13px] font-medium text-white">
                          Auto play
                        </Label>
                      </Switch.Content>
                      {/* `!` overrides on h/w + ms because HeroUI's
                          slot CSS uses higher-specificity selectors
                          (.switch[data-selected=true] .switch__thumb)
                          than a plain Tailwind class can beat. */}
                      <Switch.Control
                        className={
                          '!h-8 !w-14 ' +
                          (isSelected
                            ? '!bg-[var(--bliss-accent)] shadow-lg'
                            : '!bg-white/20')
                        }
                      >
                        <Switch.Thumb
                          className={
                            '!h-6 !w-6 ' +
                            (isSelected
                              ? '!ms-[calc(100%-1.75rem)] !bg-black'
                              : '!ms-1 !bg-white')
                          }
                        />
                      </Switch.Control>
                    </>
                  )}
                </Switch>
              </div>
              <button
                type="button"
                className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/45 text-gray-300 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white"
                onClick={onClose}
                aria-label="Close"
              >
                <StremioIcon name="x" className="h-4 w-4" />
              </button>
            </div>

            {/* Episode coverflow — Videasy-style transform stack.
                No native scroll, no scroll-snap. We translate the
                whole stack via translateY so the focused card lands
                at the viewport center. Cards have only a scale
                transform (bucketed by distance from focus) and a
                black overlay opacity for the darken effect.
                BlissfulPlayer handles wheel + touch input by
                accumulating delta and stepping focusIndex. */}
            <div
              ref={episodesListRef}
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{
                // Cards entering the top/bottom bands fade to
                // transparent so distant cards disappear cleanly
                // instead of stacking as dark rectangles below the
                // focus. Fixed pixel ranges (not %) so the top fade
                // doesn't grow with viewport height and start clipping
                // into the Season title.
                maskImage:
                  'linear-gradient(to bottom, transparent 0, black 50px, black calc(100% - 80px), transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0, black 50px, black calc(100% - 80px), transparent 100%)',
              }}
            >
              {(() => {
                const inSeason = (videos ?? []).filter((v) => v.season === episodesSeason);
                const filtered = inSeason.filter((v) => {
                  const needle = episodesSearch.trim().toLowerCase();
                  if (!needle) return true;
                  // Numeric query — match the episode number exactly.
                  // Accepts "3" or "3." (mirrors how episodes are
                  // labeled in the UI: "3. The One Where…"), matching
                  // the detail page's useEpisodeSelection.
                  const numericNeedle = needle.replace(/\.$/, '');
                  if (/^\d+$/.test(numericNeedle)) {
                    const n = Number.parseInt(numericNeedle, 10);
                    return v.episode === n;
                  }
                  return (v.title?.toLowerCase().includes(needle) ?? false)
                    || (v.description?.toLowerCase().includes(needle) ?? false);
                });
                if (filtered.length === 0) {
                  return (
                    <div className="absolute inset-0 flex items-center justify-center px-3 py-6 text-center text-white/50">
                      No episodes found
                    </div>
                  );
                }
                const currentIndex = filtered.findIndex((v) => v.id === videoId);
                const focusIndex = episodesFocusIndex ?? (currentIndex >= 0 ? currentIndex : 0);
                episodesCountRef.current = filtered.length;

                // Translate the stack so the focused card center
                // aligns with a "focus target" Y. Normally that's the
                // viewport center, but we cap it on tall screens so
                // the Season title doesn't get pushed hundreds of px
                // below the controls. The cap is computed in title-
                // relative terms: the title top stays at most
                // TITLE_TOP_GAP from the viewport top regardless of
                // screen height. Smaller viewports still center
                // naturally because the cap is `min(center, capValue)`.
                const overlapPx = 64;
                const titleTopGap = 24;
                const { containerH, cardH, titleH } = stackMetrics;
                const spacing = cardH > 0 ? cardH - overlapPx : 0;
                const focusTargetY = containerH > 0 && cardH > 0
                  ? Math.min(containerH / 2, titleH + cardH / 2 + titleTopGap)
                  : 0;
                const translateY = containerH > 0 && cardH > 0
                  ? focusTargetY - titleH - focusIndex * spacing - cardH / 2
                  : 0;

                return (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      // Key on season so swapping S1↔S2 unmounts the
                      // old stack and mounts a fresh one — gives
                      // AnimatePresence a clear before/after to
                      // crossfade instead of just swapping contents
                      // mid-frame (which read as a flash).
                      key={episodesSeason ?? 'no-season'}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className={
                        // items-end + per-child mr-4/md:mr-8 makes the
                        // title and cards share the same right edge
                        // as the controls header. The
                        // transition-transform here is the per-focus
                        // translateY animation; the AnimatePresence
                        // fade above is the per-season crossfade.
                        'flex w-full flex-col items-end will-change-transform ' +
                        (containerH > 0 && cardH > 0
                          ? 'transition-transform duration-300 ease-out'
                          : '')
                      }
                      style={{ transform: `translateY(${translateY}px)` }}
                    >
                    {/* Season title + description — first child of the
                        translating wrapper so it scrolls with the
                        cards (visible at ep 1, off-screen at ep 2+).
                        Width is sized to roughly match the controls
                        header so the title visually columns with
                        them. The pb-8 here is the breathing room
                        between the description and the first card. */}
                    <div
                      ref={titleBlockRef}
                      className="mr-4 w-[78%] max-w-[340px] pb-8 pt-8 text-center md:mr-8 md:w-[64%]"
                    >
                      <div className="text-2xl font-semibold">
                        Season {episodesSeason ?? '—'}
                      </div>
                      {currentSeasonInfo?.overview ? (
                        <div className="mt-2 line-clamp-4 text-[13px] leading-relaxed text-white/70">
                          {currentSeasonInfo.overview}
                        </div>
                      ) : null}
                    </div>
                    {/* Cards sub-stack — owns the `-space-y-16` so the
                        overlap only applies between cards, not between
                        the title block and the first card. */}
                    <div className="flex w-full flex-col items-end -space-y-16">
                      {filtered.map((v, idx) => {
                        const isCurrent = v.id === videoId;
                        const isFocused = idx === focusIndex;
                        const ep = v.episode ?? 0;
                        const progressPct = getProgressPercent({
                          type: progressLookupType,
                          id: progressLookupId,
                          videoId: v.id,
                        });
                        const tmdbEp = ep != null ? currentSeasonInfo?.episodes?.[ep] : undefined;
                        const rawRuntimeMinutes = tmdbEp?.runtime ?? null;
                        const epRuntimeStr = rawRuntimeMinutes != null
                          ? `${rawRuntimeMinutes}m`
                          : ((v as { runtime?: string }).runtime ?? null);
                        const epDescription = tmdbEp?.overview ?? v.description ?? null;
                        const absDistance = Math.abs(idx - focusIndex);
                        // Bucketed scales matching Videasy:
                        //   focus 1.15, 1 away 1.0, 2 away 0.9, 3 away
                        //   0.8, 4+ away 0.7.
                        const scale =
                          absDistance === 0 ? 1.15
                            : absDistance === 1 ? 1.0
                              : absDistance === 2 ? 0.9
                                : absDistance === 3 ? 0.8
                                  : 0.7;
                        // Matching Videasy overlay opacities.
                        const overlayOpacity =
                          absDistance === 0 ? 0
                            : absDistance === 1 ? 0.5
                              : absDistance === 2 ? 0.75
                                : absDistance === 3 ? 0.9
                                  : 1;
                        return (
                          <button
                            key={v.id}
                            ref={isCurrent ? currentEpisodeCardRef : undefined}
                            data-episode-idx={idx}
                            type="button"
                            className={
                              'group mr-4 block w-[78%] max-w-[340px] origin-center text-left transition-transform duration-300 ease-out will-change-transform md:mr-8 md:w-[64%] '
                              + (disableSelection ? 'cursor-not-allowed' : 'cursor-pointer')
                            }
                            style={{
                              transform: `scale(${scale})`,
                              zIndex: 100 - absDistance,
                              position: 'relative',
                            }}
                            onClick={() => {
                              if (disableSelection) {
                                notifyWarning('Only the host can change episodes');
                                return;
                              }
                              if (!isFocused) {
                                setEpisodesFocusIndex(idx);
                                return;
                              }
                              onSelectEpisode(v);
                            }}
                          >
                            <div
                              className="relative w-full overflow-hidden rounded-2xl bg-gray-900"
                              style={{ aspectRatio: '16 / 9' }}
                            >
                              <EpisodeThumbnail
                                thumbnail={v.thumbnail}
                                fallback={background ?? poster ?? null}
                              />
                              {/* Distance-based dimming overlay.
                                  Hovering the card clears the overlay
                                  (`group-hover:!opacity-0`) so the
                                  thumbnail reads at full brightness
                                  on interaction — Videasy parity. The
                                  `!` is required because the inline
                                  `opacity` style would otherwise win
                                  on specificity. */}
                              <div
                                className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-300 ease-out group-hover:!opacity-0"
                                style={{ opacity: overlayOpacity }}
                              />
                              {progressPct > 0 ? (
                                <div className="absolute inset-x-0 bottom-0 z-30 h-1.5 bg-white/15">
                                  <div
                                    className="h-full bg-[var(--bliss-accent)]"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              ) : null}
                              {isFocused && !disableSelection ? (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Play ${v.title ?? `Episode ${ep}`}`}
                                  className="absolute right-3 top-3 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-black/45 backdrop-blur-md transition hover:scale-105 hover:bg-black/65 md:h-10 md:w-10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEpisode(v);
                                  }}
                                >
                                  <StremioIcon name="play" className="h-3.5 w-3.5 text-white md:h-4 md:w-4" />
                                </span>
                              ) : null}
                              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                              <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-3 pt-6 md:px-4 md:pb-4 md:pt-8">
                                <div className="flex items-center gap-2">
                                  {isCurrent ? (
                                    <span className="shrink-0 rounded-md bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white md:px-2 md:text-[10px]">
                                      Watching
                                    </span>
                                  ) : null}
                                  <div className="text-sm font-semibold leading-snug text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)] md:text-base">
                                    {ep}. {v.title ?? `Episode ${ep}`}
                                  </div>
                                </div>
                                {epRuntimeStr ? (
                                  <div className="mt-0.5 text-xs text-white/80 drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                                    {epRuntimeStr}
                                  </div>
                                ) : null}
                                {isFocused && epDescription ? (
                                  <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/75 drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                                    {epDescription}
                                  </div>
                                ) : null}
                              </div>
                              {/* Focused-card outline, matching Videasy's
                                pure-white 2.5px ring sitting above the
                                gradient + overlay. */}
                              <div
                                className={
                                  'pointer-events-none absolute inset-0 rounded-2xl transition-all duration-300 ease-out ' +
                                  (isFocused
                                    ? 'z-30 border-[2.5px] border-white/90'
                                    : 'border border-transparent')
                                }
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    </motion.div>
                  </AnimatePresence>
                );
              })()}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
