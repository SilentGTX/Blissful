import { createRoot } from 'react-dom/client';
import { init as initSpatialNavigation } from '@noriginmedia/norigin-spatial-navigation';
// Installs window.blissfulDesktop over Tauri invoke/listen when running in the
// Android TV shell. No-op in the browser and under the Windows shell (which
// injects its own bridge first). Imported before App so isNativeShell() is
// true by first render. See lib/tauriBridge.ts.
import './lib/tauriBridge';
import { isTvMode } from './lib/platform';
import { installFocusRecovery } from './spatial/focusRecovery';
import './index.css';
import App from './App';

// Spatial navigation (D-pad) for the TV layout. Global singleton — init once at
// module scope before any component mounts. Gated on TV mode so it never binds
// its global keydown handler (which would hijack arrow keys) in the normal
// desktop/browser UI. visualDebug draws focus boxes in dev.
if (isTvMode()) {
  initSpatialNavigation({
    // Focus-box debug overlay (the green lines + sn: labels). Off by default;
    // flip to true only when debugging focus traversal.
    visualDebug: false,
    distanceCalculationMethod: 'center',
    throttle: 100,
    throttleKeypresses: true,
    shouldFocusDOMNode: false, // cards are <div role=button>; ring keys off data-focused
  });
  // Global D-pad focus-recovery watchdog: if the focused node ever unmounts and
  // focus is lost (no [data-focused]), the next arrow/OK press re-seeds focus so
  // the remote never goes dead. Capture-phase, TV-only, never installed on desktop.
  installFocusRecovery();
}

createRoot(document.getElementById('root')!).render(<App />);
