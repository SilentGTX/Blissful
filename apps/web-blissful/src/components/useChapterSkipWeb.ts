// "Skip Intro / Recap / Credits" hook for BlissfulPlayer. Classifies
// chapter markers fetched from the addon-proxy's ffprobe endpoint
// (/probe-streams) and watches the HTML5 <video>.currentTime ticker
// to surface the skip button when the playhead enters a matched
// chapter.
//
// Coverage: files with explicit chapter markers (anime BDs, many Western
// TV WEB-DLs). Files without chapters silently render no button.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type Chapter = {
  id: number;
  time: number;
  end: number;
  title: string | null;
};

export type ChapterSkipKind = 'intro' | 'recap' | 'outro';

export type ChapterSkipState = {
  kind: ChapterSkipKind;
  label: string;
  endTime: number;
  onSkip: () => void;
};

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

/** True if any chapter's title classifies as intro/recap/credits. Lets
 *  the player decide whether to fall back to AniSkip times when the
 *  file's own (ffprobe) chapters carry no skippable markers. */
export function hasClassifiableChapter(chapters: Chapter[]): boolean {
  return chapters.some((c) => classifyChapter(c.title) !== null);
}

function findCurrentChapter(chapters: Chapter[], t: number): number {
  if (chapters.length === 0) return -1;
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (t >= chapters[i].time) return i;
  }
  return -1;
}

/**
 * Detect the current chapter as intro/recap/outro and expose a skip
 * action that seeks `<video>.currentTime` to the end of that chapter.
 *
 * @param videoRef  the HTMLVideoElement ref for the current player
 * @param chapters  chapter list from /probe-streams (empty if file has none)
 * @param duration  total video duration (used to bound the skip when
 *                  the matched chapter is the last in the file)
 */
export function useChapterSkipWeb(
  videoRef: RefObject<HTMLVideoElement | null>,
  chapters: Chapter[],
  duration: number
): ChapterSkipState | null {
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  // Suppress re-showing the same chapter's button after the user clicked
  // skip — clears whenever the chapter list changes (i.e. on next file).
  const dismissedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    dismissedRef.current.clear();
    setCurrentIdx(-1);
  }, [chapters]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || chapters.length === 0) return;
    let raf = 0;
    const tick = () => {
      const idx = findCurrentChapter(chapters, video.currentTime || 0);
      setCurrentIdx((prev) => {
        if (prev === idx) return prev;
        // Left a chapter — clear its dismissed flag so seeking back into
        // it later re-shows the skip button (instead of staying hidden
        // for the rest of the file after one skip).
        if (prev >= 0) dismissedRef.current.delete(prev);
        return idx;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [videoRef, chapters]);

  const onSkip = useCallback(
    (idx: number, endTime: number) => {
      dismissedRef.current.add(idx);
      const v = videoRef.current;
      if (v) {
        try {
          v.currentTime = endTime;
        } catch {
          // ignore — seek past end / invalid time
        }
      }
    },
    [videoRef]
  );

  return useMemo<ChapterSkipState | null>(() => {
    if (currentIdx < 0 || currentIdx >= chapters.length) return null;
    if (dismissedRef.current.has(currentIdx)) return null;
    const current = chapters[currentIdx];
    const kind = classifyChapter(current?.title);
    if (!kind) return null;
    const next = chapters[currentIdx + 1];
    const endTime =
      next && Number.isFinite(next.time)
        ? next.time
        : Number.isFinite(duration)
          ? duration
          : current.time + 1;
    return {
      kind,
      label: LABELS[kind],
      endTime,
      onSkip: () => onSkip(currentIdx, endTime),
    };
  }, [chapters, currentIdx, duration, onSkip]);
}
