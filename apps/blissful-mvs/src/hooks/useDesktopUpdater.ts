import { useEffect, useState } from 'react';
import { desktop, isNativeShell } from '../lib/desktop';

// Hook used by AppShell to show the "update ready" toast in the desktop
// shell. Talks to the native Rust shell via the typed `desktop` shim
// (apps/blissful-shell/src/ipc) — auto-updater itself is stubbed in
// Phase 1 and gets a real impl in Phase 6.
//
// In the browser (blissful.budinoff.com), isNativeShell() is false, the
// subscriptions are no-ops, and the toast never fires.
export function useDesktopUpdater() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!isNativeShell()) return;

    // When Rust notifies us a release is available, kick off the download.
    // Phase 6 will move both the discovery + download into the shell.
    const unsubAvail = desktop.onUpdateAvailable(() => {
      desktop.downloadUpdate().catch(() => {});
    });
    const unsubDone = desktop.onUpdateDownloaded(() => {
      setUpdateReady(true);
    });
    return () => {
      unsubAvail();
      unsubDone();
    };
  }, []);

  const installNow = () => {
    if (isNativeShell()) {
      desktop.installUpdate().catch(() => {});
    }
  };

  const dismissUpdate = () => {
    setUpdateReady(false);
  };

  return { updateReady, installNow, dismissUpdate };
}
