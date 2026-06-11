import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Force every device that has the app open to reload as soon as a
// new build's service worker takes over. vite-plugin-pwa's
// `registerType: 'autoUpdate'` already skip-waits and claims, so
// `controllerchange` fires the moment the new bundle is in charge —
// we just need to hit reload then so the user's tab actually runs
// the new code instead of just caching it for next time.
//
// Edge case: on a fresh device with no prior SW, the first
// controllerchange is the install itself, not an upgrade — we skip
// it via the `hadInitialController` snapshot.
// After a deploy, the still-loaded old bundle references hashed chunk
// filenames that no longer exist on the server. The first lazy()
// import that lands on one (e.g. opening /addons or /settings)
// 404s and React renders nothing because there's no Suspense
// fallback for an error. Vite fires `vite:preloadError` for exactly
// this case; reload to grab the new index.html + chunk names.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('blissful.preloadErrorRecovery') === '1') return;
  sessionStorage.setItem('blissful.preloadErrorRecovery', '1');
  window.location.reload();
});
// Clear the recovery flag once a navigation succeeds so a future
// stale-chunk situation can recover again. Bound at `load` so we
// know all chunks resolved this round.
window.addEventListener('load', () => {
  sessionStorage.removeItem('blissful.preloadErrorRecovery');
});

if ('serviceWorker' in navigator) {
  const hadInitialController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadInitialController) window.location.reload();
  });
  // The browser only re-checks the SW every ~24h on its own, so we drive the
  // check ourselves. A fresh sw.js (served no-store) → new SW installs →
  // skip-waits/claims → the controllerchange above auto-reloads the tab. We
  // check on a periodic timer (so a tab left open in the FOREGROUND still picks
  // up deploys — visibilitychange alone never fires for it), whenever the tab
  // regains focus/visibility, and once the registration is ready.
  const checkForUpdate = () => {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  };
  navigator.serviceWorker.ready.then(checkForUpdate).catch(() => {});
  setInterval(checkForUpdate, 60 * 1000);
  window.addEventListener('focus', checkForUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}

createRoot(document.getElementById('root')!).render(<App />);
