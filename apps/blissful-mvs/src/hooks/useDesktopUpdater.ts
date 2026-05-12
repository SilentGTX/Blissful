import { useEffect, useRef, useState } from 'react';
import { desktop, isNativeShell } from '../lib/desktop';

// Hook used by AppShell to drive the "update ready" toast in the desktop
// shell. Hybrid model:
//
//   - The shell's background poller fires `update-available` whenever
//     check_once() lands a newer release. We subscribe for that event
//     and trigger downloadUpdate() on receipt (fast path).
//
//   - But the renderer might miss the very first event if React hasn't
//     finished mounting by the shell's 15-second initial-check mark —
//     and the next backend poll is 30 minutes out. So we also pull-poll
//     the shell's cached state via desktop.getUpdateStatus() on mount
//     and every 30 seconds afterwards. Whichever path sees an update
//     first wins; a `kickedOff` ref makes downloadUpdate() idempotent
//     so the two paths don't race or double-download.
export function useDesktopUpdater() {
  const [updateReady, setUpdateReady] = useState(false);
  const downloadKickedOffRef = useRef(false);

  useEffect(() => {
    if (!isNativeShell()) return;

    const kickOffDownload = () => {
      if (downloadKickedOffRef.current) return;
      downloadKickedOffRef.current = true;
      desktop.downloadUpdate().catch(() => {
        // Allow retry on next poll tick if this somehow failed at the
        // IPC boundary (the actual download runs background-style in
        // the shell and reports completion via `update-downloaded`).
        downloadKickedOffRef.current = false;
      });
    };

    const pollOnce = () => {
      desktop
        .getUpdateStatus()
        .then((info) => {
          if (info) kickOffDownload();
        })
        .catch(() => {});
    };

    // Immediate query on mount in case the backend already found an
    // update before this hook subscribed (the event-firing path is
    // one-shot per poll and isn't replayed to late subscribers).
    pollOnce();

    // Safety-net polling. The backend's 30-minute cadence means a
    // single missed event = 30 minutes of dead time; 30s polling
    // closes that window without thrashing.
    const pollTimer = window.setInterval(pollOnce, 30 * 1000);

    // Event-based fast path stays connected for the case where the
    // renderer happens to be mounted in time for the firing.
    const unsubAvail = desktop.onUpdateAvailable(() => {
      kickOffDownload();
    });
    const unsubDone = desktop.onUpdateDownloaded(() => {
      setUpdateReady(true);
    });

    return () => {
      window.clearInterval(pollTimer);
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
