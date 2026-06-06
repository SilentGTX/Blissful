// Blissful design tokens — replicated 1:1 from apps/blissful-mvs/src/index.css.
// Glass recipe, lavender accent, brand teal, exact surface alphas.
export const colors = {
  bg: '#07090d',
  bgDetail: '#0f0d20', // detail-page backdrop base
  // Faked-glass gradient stops (--bliss-glass-top / --bliss-glass-bottom)
  glassTop: 'rgba(40,47,64,0.97)', // #282f40
  glassBottom: 'rgba(17,21,31,0.985)', // #11151f
  // white overlays
  surface: 'rgba(255,255,255,0.06)',
  surface08: 'rgba(255,255,255,0.08)',
  surface10: 'rgba(255,255,255,0.10)',
  surface12: 'rgba(255,255,255,0.12)',
  surface18: 'rgba(255,255,255,0.18)',
  hairline: 'rgba(255,255,255,0.12)',
  accent: '#95a2ff',
  accentGlow: 'rgba(149,162,255,0.55)',
  accentInk: '#05070a', // text on the lavender button
  brand: '#19f7d2',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.72)',
  textFaint: 'rgba(255,255,255,0.6)',
  textGhost: 'rgba(255,255,255,0.45)',
  danger: '#ff6b6b',
  imdbGold: '#f5c518',
  ink: '#212121', // text on the white button
} as const;

export const radius = {
  card: 16,
  hero: 36,
  panel: 28,
  field: 14,
  pill: 999,
} as const;

// expo-google-fonts family names (loaded in App.tsx via useFonts)
export const font = {
  serif: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',
  body: 'IBMPlexSans_400Regular',
  bodyMed: 'IBMPlexSans_500Medium',
  bodySemi: 'IBMPlexSans_600SemiBold',
} as const;

// NOTE: the Android TV emulator (and most 1080p TVs) run at density 320 (2x),
// so the logical canvas is ~960x540 dp — size everything for THAT, not a phone.
export const layout = {
  safeX: 40,
  safeY: 28,
  posterW: 124,
  posterH: 182, // ~ 1 / 1.464 aspect
  radius: radius.card,
} as const;

// Glass surface (solid-surface). RN can't do backdrop-blur over arbitrary
// content cheaply, so we approximate with the near-opaque gradient base +
// hairline border (visually matches the web glass on dark backgrounds).
export const glassSurface = {
  backgroundColor: 'rgba(28,33,46,0.97)', // blend of the two glass stops
  borderWidth: 1,
  borderColor: colors.hairline,
} as const;
