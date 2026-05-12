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
