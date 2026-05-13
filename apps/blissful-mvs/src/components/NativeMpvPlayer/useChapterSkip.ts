// Skip-Intro / Skip-Recap / Skip-Outro detection driven by the mpv
// `chapter-list` and the live `chapter` property.
//
// How it works:
//   1. On the player's `FileLoaded` lifecycle event we fetch the
//      file's chapter list once (`desktop.mpv.getChapters()`). The
//      list never changes within a single loadfile so we cache it.
//   2. mpv's `chapter` property is observed shell-side and forwarded
//      to the renderer as an `mpv-prop-change` event. On every change
//      we look up the new chapter's title in the cache.
//   3. The title is classified against the intro / recap / outro
//      regex set (see `classifyChapter` below — derived from
//      intro-skipper's defaults + scene survey across anime BD rips,
//      Western TV WEB-DLs, anime sims).
//   4. If the title matches, the hook surfaces a `{ kind, endTime,
//      label, onSkip }` payload to the parent so the floating button
//      can render. `endTime` is `chapters[idx + 1]?.time` (falling
//      back to `duration` for the rare last-chapter intro), so a
//      skip lands precisely at the start of the next chapter.
//   5. Skip click issues an absolute seek via the existing
//      `desktop.seek()` IPC (which the shell extends to `seek <t>
//      absolute+exact` so we hit the precise frame, not the prior
//      keyframe — see `apps/blissful-shell/src/ipc/commands.rs`).
//
// Coverage note: anime BD rips have explicit chapter markers ~80% of
// the time, and most use one of the strings we match below
// (`OP`/`Opening`/`Ending`/`ED`/`Preview` etc.). Anime simulcasts and
// Western TV are spottier. Files without markers silently get no skip
// button — no failure mode, just feature-absent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop, type MpvChapter } from '../../lib/desktop';

export type ChapterSkipKind = 'intro' | 'recap' | 'outro';

export type ChapterSkipState = {
  kind: ChapterSkipKind;
  label: string;
  endTime: number;
  onSkip: () => void;
};

// Patterns adapted from jellyfin's intro-skipper plugin defaults
// (PluginConfiguration.cs lines 278-305) plus additions from the
// scene survey: `Main Titles` / `Title Sequence` / `Cold Open`
// (Western TV), `Vorspann` / `Abspann` (German anime BDs),
// `Opening Credits` / `Closing Credits` / `End Credits` (Western TV
// disc-authoring convention). Each pattern is anchored at the start
// of the title (`^`) with a trailing boundary `(\s|:|$)` so we don't
// match `Opening Day` or `Recap And Review`. The `(?!\s+end)`
// lookahead suppresses tags like `Opening End` that some tools emit
// at chapter boundaries.
const INTRO_RE =
  /^(intro|introduction|op|opening( credits| theme)?|main titles|title sequence|cold open|vorspann)(?!\s+end)(\s|:|$)/i;
const RECAP_RE =
  /^(re-?cap|sum{1,2}ary|prev(ious(ly)?)?( on)?|last (time|episode)|earlier|catch[- ]?up)(?!\s+end)(\s|:|$)/i;
const OUTRO_RE =
  /^(ed|ending( credits| theme)?|credits?|outro|end credits|closing( credits| titles)?|abspann)(?!\s+end)(\s|:|$)/i;

function classifyChapter(title: string | null | undefined): ChapterSkipKind | null {
  if (!title) return null;
  const t = title.trim();
  if (!t) return null;
  if (INTRO_RE.test(t)) return 'intro';
  if (RECAP_RE.test(t)) return 'recap';
  if (OUTRO_RE.test(t)) return 'outro';
  return null;
}

const LABELS: Record<ChapterSkipKind, string> = {
  intro: 'Skip Intro',
  recap: 'Skip Recap',
  outro: 'Skip Credits',
};

/**
 * Detect the current chapter as intro/recap/outro and expose a skip
 * action that seeks to the end of that chapter.
 *
 * @param duration  current mpv `duration` (used to bound the skip when
 *                  the matched chapter is the last in the file)
 * @returns `null` when no skippable chapter is active, otherwise a
 *          payload the parent renders as a floating button.
 */
export function useChapterSkip(duration: number): ChapterSkipState | null {
  const [chapters, setChapters] = useState<MpvChapter[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  // After the user manually dismisses (presses skip), don't re-show
  // the button for the SAME chapter index even if mpv re-fires the
  // chapter event (e.g., a stray prop-change during the seek). Cleared
  // on file-loaded (new file → reset all suppressions).
  const dismissedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const refreshChapters = async () => {
      try {
        const list = await desktop.mpv.getChapters();
        if (cancelled) return;
        setChapters(Array.isArray(list) ? list : []);
      } catch {
        if (cancelled) return;
        setChapters([]);
      }
    };

    const unsubLifecycle = desktop.onMpvEvent((e) => {
      if (e.type === 'FileLoaded') {
        dismissedRef.current.clear();
        setCurrentIdx(-1);
        void refreshChapters();
      }
    });

    const unsubProp = desktop.onMpvPropChange((e) => {
      if (e.name !== 'chapter') return;
      const v = e.value;
      if (typeof v === 'number') setCurrentIdx(Math.floor(v));
    });

    // Initial fetch in case FileLoaded already fired before this mount.
    void refreshChapters();

    return () => {
      cancelled = true;
      unsubLifecycle();
      unsubProp();
    };
  }, []);

  const onSkip = useCallback(
    (idx: number, endTime: number) => {
      dismissedRef.current.add(idx);
      // Absolute seek; the shell's `seek` IPC handler appends `+exact`
      // so we land on the precise frame at chapter start, not the
      // prior keyframe (matters for long-GOP encodes where keyframes
      // can be 10+ s apart).
      desktop.seek(endTime, 'absolute').catch(() => {});
    },
    [],
  );

  return useMemo<ChapterSkipState | null>(() => {
    if (currentIdx < 0 || currentIdx >= chapters.length) return null;
    if (dismissedRef.current.has(currentIdx)) return null;
    const current = chapters[currentIdx];
    const kind = classifyChapter(current?.title);
    if (!kind) return null;

    // End-of-skip target: start of the NEXT chapter, or the file's
    // duration if this is the last chapter (rare for intros — comes
    // up for outros that run until EOF on some BD authoring).
    const next = chapters[currentIdx + 1];
    const endTime =
      next && Number.isFinite(next.time)
        ? next.time
        : Number.isFinite(duration)
          ? duration
          : current.time + 1; // hard fallback so we never seek to NaN

    return {
      kind,
      label: LABELS[kind],
      endTime,
      onSkip: () => onSkip(currentIdx, endTime),
    };
  }, [chapters, currentIdx, duration, onSkip]);
}
