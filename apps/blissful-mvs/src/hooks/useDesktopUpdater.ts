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
  // `isInstalling` is set when the user clicks "Update & Restart". The
  // overlay reads it to render an "Installing update..." screen. We hold
  // for ~800ms before firing the IPC so the user sees the overlay
  // BEFORE the shell quits — otherwise the click registers as "app
  // suddenly closed with no feedback" (which is how the broken /SILENT
  // path manifested).
  const [isInstalling, setIsInstalling] = useState(false);
  const downloadKickedOffRef = useRef(false);

  useEffect(() => {
    if (!isNativeShell()) return;

    // All log lines route to player.log via the shell's `log` IPC, so
    // they survive `windows_subsystem = "windows"` in release builds.
    const log = (line: string) => {
      desktop.log(`[updater] ${line}`).catch(() => {});
    };
    log('hook mounted');

    const kickOffDownload = (source: string) => {
      if (downloadKickedOffRef.current) {
        log(`download already kicked off, ignoring (source=${source})`);
        return;
      }
      downloadKickedOffRef.current = true;
      log(`kicking off downloadUpdate (source=${source})`);
      desktop.downloadUpdate().catch((e: unknown) => {
        log(`downloadUpdate IPC threw: ${String(e)}`);
        downloadKickedOffRef.current = false;
      });
    };

    const pollOnce = () => {
      desktop
        .getUpdateStatus()
        .then((status) => {
          const ver = status.available ? status.available.version : 'null';
          log(`getUpdateStatus -> available=${ver}, downloaded=${status.downloaded}`);
          if (status.downloaded) {
            // Installer is on disk and ready to spawn. Flip the toast
            // even if no event-bus message arrived (events drop on
            // background-thread firings due to thread-local sink).
            setUpdateReady(true);
          } else if (status.available) {
            kickOffDownload('poll');
          }
        })
        .catch((e: unknown) => {
          log(`getUpdateStatus IPC threw: ${String(e)}`);
        });
    };

    pollOnce();
    const pollTimer = window.setInterval(pollOnce, 30 * 1000);

    const unsubAvail = desktop.onUpdateAvailable((version: string) => {
      log(`update-available event: ${version}`);
      kickOffDownload('event');
    });
    const unsubDone = desktop.onUpdateDownloaded(() => {
      log('update-downloaded event — toast firing');
      setUpdateReady(true);
    });
    const unsubFail = desktop.onUpdateDownloadFailed((reason: string) => {
      log(`update-download-failed event: ${reason}`);
      downloadKickedOffRef.current = false;
    });

    return () => {
      window.clearInterval(pollTimer);
      unsubAvail();
      unsubDone();
      unsubFail();
    };
  }, []);

  const installNow = () => {
    if (!isNativeShell()) return;
    // Show the overlay first, then trigger the install after a short
    // delay. The shell exits as soon as installUpdate is dispatched,
    // so without this delay the user sees zero feedback between
    // clicking the button and the window vanishing.
    setIsInstalling(true);
    window.setTimeout(() => {
      desktop.installUpdate().catch(() => {
        // IPC error means the install never spawned. Drop the overlay
        // so the user isn't stuck looking at "Installing..." forever.
        setIsInstalling(false);
      });
    }, 800);
  };

  const dismissUpdate = () => {
    setUpdateReady(false);
  };

  return { updateReady, isInstalling, installNow, dismissUpdate };
}
