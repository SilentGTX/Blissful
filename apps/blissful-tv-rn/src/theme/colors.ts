// Blissful design tokens — replicated 1:1 from apps/blissful-mvs/src/index.css.
// Glass recipe, lavender accent, brand teal, exact surface alphas.
// NOT `as const` — the accent + glass-surface tokens are MUTATED at runtime by
// applyThemeColors() from the user's saved Settings (the RN analogue of the web's
// StorageProvider overriding --bliss-accent / --bliss-glass-* CSS variables).
export const colors = {
  bg: '#07090d',
  bgDetail: '#0f0d20', // detail-page backdrop base
  // Faked-glass gradient stops (--bliss-glass-top / --bliss-glass-bottom)
  glassTop: 'rgba(40,47,64,0.97)', // #282f40
  glassBottom: 'rgba(17,21,31,0.985)', // #11151f
  glassBottomSolid: '#11151f', // opaque darker surface — app background gradient base
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
};

const DEFAULT_ACCENT = '#95a2ff';
const DEFAULT_SURFACE = '#282f40';

function hexRgb(hex: string): { r: number; g: number; b: number } | null {
  const c = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(c)) return null;
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}
const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');

// Derive the glass stops from a surface hex — 1:1 with StorageProvider: the
// bottom stop is each channel × 0.42 (the original rgba(17,21,31)/rgba(40,47,64)
// ratio), stops kept at 0.97 / 0.985 alpha.
export function deriveGlass(surfaceHex: string): { top: string; bottom: string; bottomSolid: string } {
  const s = hexRgb(surfaceHex) ?? hexRgb(DEFAULT_SURFACE)!;
  const r2 = Math.round(s.r * 0.42), g2 = Math.round(s.g * 0.42), b2 = Math.round(s.b * 0.42);
  return {
    top: `rgba(${s.r},${s.g},${s.b},0.97)`,
    bottom: `rgba(${r2},${g2},${b2},0.985)`,
    bottomSolid: `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`,
  };
}

// Mutate the shared `colors` object from the user's saved Settings. Components
// reading colors.accent / colors.glass* pick up the new values on their next
// render (the ThemeProvider bumps a version to force that).
export function applyThemeColors(accentHex?: string | null, surfaceHex?: string | null): void {
  const a = hexRgb(accentHex || DEFAULT_ACCENT) ?? hexRgb(DEFAULT_ACCENT)!;
  colors.accent = (accentHex && hexRgb(accentHex)) ? accentHex : DEFAULT_ACCENT;
  colors.accentGlow = `rgba(${a.r},${a.g},${a.b},0.55)`;
  const g = deriveGlass((surfaceHex && hexRgb(surfaceHex)) ? surfaceHex : DEFAULT_SURFACE);
  colors.glassTop = g.top;
  colors.glassBottom = g.bottom;
  colors.glassBottomSolid = g.bottomSolid;
  glassSurface.backgroundColor = g.top;
}

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
  // Spectral — the immersive Home design's display serif (titles/row headers).
  spectral: 'Spectral_400Regular',
  spectralSemi: 'Spectral_600SemiBold',
  spectralBold: 'Spectral_700Bold',
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
// Not `as const` — backgroundColor is retinted by applyThemeColors().
export const glassSurface = {
  backgroundColor: 'rgba(28,33,46,0.97)', // blend of the two glass stops
  borderWidth: 1,
  borderColor: colors.hairline,
};
