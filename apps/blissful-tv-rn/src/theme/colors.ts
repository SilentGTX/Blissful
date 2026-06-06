// Blissful palette (TV). Mirrors the web app's brand tokens; will grow into a
// ThemeContext (accent/surface recolor from playerSettings) per the plan.
export const colors = {
  bg: '#07090d',
  surface: 'rgba(255,255,255,0.06)',
  surfaceStrong: 'rgba(255,255,255,0.12)',
  brand: '#19f7d2',
  accent: '#95a2ff',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.72)',
  textFaint: 'rgba(255,255,255,0.45)',
  danger: '#ff8a8a',
} as const;

export const layout = {
  safeX: 48,
  safeY: 40,
  posterW: 150,
  posterH: 225,
  radius: 12,
} as const;
