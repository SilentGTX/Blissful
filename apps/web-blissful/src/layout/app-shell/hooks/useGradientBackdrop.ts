// Drives the CSS custom property `--dynamic-bg` that paints the
// `<html>` element's gradient backdrop. Two cases:
//   * Classic UI: dark/light gradient key looked up via `applyGradient`.
//   * Netflix UI: a constant solid backdrop colour (`NETFLIX_BG`).
// Lived as two near-identical `useEffect`s inside AppShell. The second
// one was a "defensive" re-apply for the initial paint where the
// stylesheet hadn't installed the property yet; collapsed here into a
// single effect that does both jobs.

import { useEffect } from 'react';
import { NETFLIX_BG } from '../constants';
import { applyGradient } from '../utils';
import type { UiStyle } from '../types';

export function useGradientBackdrop(
  uiStyle: UiStyle,
  isDark: boolean,
  darkGradientKey: string,
  lightGradientKey: string,
) {
  useEffect(() => {
    if (uiStyle === 'netflix') {
      document.documentElement.style.setProperty('--dynamic-bg', NETFLIX_BG);
      return;
    }
    applyGradient(isDark ? darkGradientKey : lightGradientKey, isDark);
  }, [uiStyle, isDark, darkGradientKey, lightGradientKey]);
}
