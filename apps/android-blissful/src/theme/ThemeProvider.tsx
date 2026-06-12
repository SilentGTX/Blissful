import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyThemeColors, colors, deriveGlass } from './colors';
import { readTvSettings, writeTvSettings } from '../lib/tvSettings';

type ThemeValue = {
  accent: string;
  surface: string;
  /** App background gradient stops, derived from the surface colour. */
  bgGradient: string[];
  /** Push a new accent/surface (e.g. from Settings) — applies + persists live. */
  setTheme: (next: { accent?: string; surface?: string }) => void;
  /** Bumped whenever the theme changes, so consumers re-render + re-read colors. */
  version: number;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Seed from the saved settings synchronously so the first paint is themed.
  const initial = readTvSettings();
  const [accent, setAccent] = useState(initial.accentColor || '#95a2ff');
  const [surface, setSurface] = useState(initial.surfaceColor || '#282f40');
  const [version, setVersion] = useState(0);

  // Mutate the shared `colors` object on every theme change (before paint).
  useMemo(() => applyThemeColors(accent, surface), [accent, surface]);

  // A later cloud-hydrate (Settings runs it) may change the persisted values —
  // re-read once on mount so the box matches the account.
  useEffect(() => {
    const s = readTvSettings();
    if (s.accentColor && s.accentColor !== accent) setAccent(s.accentColor);
    if (s.surfaceColor && s.surfaceColor !== surface) setSurface(s.surfaceColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((next: { accent?: string; surface?: string }) => {
    const a = next.accent;
    const s = next.surface;
    if (a) setAccent(a);
    if (s) setSurface(s);
    applyThemeColors(a ?? accent, s ?? surface);
    setVersion((v) => v + 1);
    try {
      const cur = readTvSettings();
      writeTvSettings({ ...cur, accentColor: a ?? cur.accentColor, surfaceColor: s ?? cur.surfaceColor });
    } catch {
      // best-effort local persist
    }
  }, [accent, surface]);

  const value = useMemo<ThemeValue>(() => {
    const glass = deriveGlass(surface);
    // Surface tint at the top fading to the base bg — the web's glass-derived
    // page background (was flat black on TV before).
    return { accent, surface, bgGradient: [surface, glass.bottomSolid, colors.bg], setTheme, version };
  }, [accent, surface, setTheme, version]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
