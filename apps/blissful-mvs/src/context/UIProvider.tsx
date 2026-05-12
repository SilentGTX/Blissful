import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useThemeToggle } from '../layout/app-shell/hooks/useThemeToggle';
import type { UiStyle } from '../layout/app-shell/types';

type UIContextValue = {
  uiStyle: UiStyle;
  setUiStyle: (value: UiStyle) => void;
  isDark: boolean;
  setIsDark: (value: boolean) => void;
  darkGradientKey: string;
  setDarkGradientKey: (value: string) => void;
  lightGradientKey: string;
  setLightGradientKey: (value: string) => void;
  homeEditMode: boolean;
  setHomeEditMode: (value: boolean) => void;
  query: string;
  setQuery: (value: string) => void;
};

export const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within a UIProvider');
  return ctx;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const { isDark, setIsDark } = useThemeToggle();

  const [uiStyle, setUiStyleRaw] = useState<UiStyle>(() => {
    const stored = localStorage.getItem('uiStyle');
    return stored === 'netflix' ? 'netflix' : 'classic';
  });
  const [query, setQuery] = useState('');
  const [homeEditMode, setHomeEditMode] = useState(false);
  const [darkGradientKey, setDarkGradientKey] = useState(
    () => localStorage.getItem('darkGradientKey') || 'default'
  );
  const [lightGradientKey, setLightGradientKey] = useState(
    () => localStorage.getItem('lightGradientKey') || 'default'
  );

  const setUiStyle = useCallback((value: UiStyle) => {
    setUiStyleRaw(value);
    localStorage.setItem('uiStyle', value);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-ui', uiStyle);
  }, [uiStyle]);

  const value = useMemo<UIContextValue>(
    () => ({
      uiStyle,
      setUiStyle,
      isDark,
      setIsDark,
      darkGradientKey,
      setDarkGradientKey,
      lightGradientKey,
      setLightGradientKey,
      homeEditMode,
      setHomeEditMode,
      query,
      setQuery,
    }),
    [
      uiStyle,
      setUiStyle,
      isDark,
      setIsDark,
      darkGradientKey,
      lightGradientKey,
      homeEditMode,
      query,
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
