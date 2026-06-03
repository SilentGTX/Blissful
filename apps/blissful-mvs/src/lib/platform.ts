import { isNativeShell } from './desktop';

// True when the renderer is running inside one of our desktop wrappers
// (legacy Electron or the new native Rust shell). Used by code that needs
// to skip browser-only fallbacks (VLC drawer on iOS, etc.).
//
// Function name is kept as `isElectronDesktopApp` to avoid touching every
// call site — the semantics are "are we in a desktop wrapper", not
// specifically Electron. The Rust shell branch is the new path; Electron
// stays detected for the transition window.
export function isElectronDesktopApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Electron/i.test(ua)) return true;
  return isNativeShell();
}

// True when running inside the Tauri shell (the Android TV build). Keyed on the
// global `withGlobalTauri` injects before our bundle runs, so it's reliable at
// module-eval time. Used to select the localhost proxy origin (proxyBase.ts)
// and to force the TV layout/theme regardless of viewport heuristics.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in (window as object);
}

// The shell is currently a TV-only build, so Tauri implies Android TV. If a
// phone Tauri build is ever added, refine this via a platform flag from the
// native bridge (window.blissfulDesktop.platform) or Android UiModeManager.
export function isAndroidTv(): boolean {
  return isTauri();
}

// Dev/browser escape hatch: open `?tv=1` to force the TV layout in a normal
// browser (drive D-pad nav with arrow keys), `?tv=0` to clear. Persisted to
// localStorage because React Router drops the query string on client-side nav,
// which would otherwise turn TV mode off after the first in-app navigation.
export function forceTv(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('tv');
  if (param === '1') localStorage.setItem('bliss:forceTv', '1');
  if (param === '0') localStorage.removeItem('bliss:forceTv');
  return localStorage.getItem('bliss:forceTv') === '1';
}

// The single switch for the TV interaction layer: a real Android TV OR forced
// via ?tv=1 for browser testing.
export function isTvMode(): boolean {
  return isAndroidTv() || forceTv();
}
