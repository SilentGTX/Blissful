// Typed shim for talking to the native Rust shell. The actual JS bridge is
// injected by apps/blissful-shell at runtime (window.blissfulDesktop). When
// running in the browser instead of the shell, every command throws and
// every `on*` subscription is a no-op — feature code should branch on
// isNativeShell() to opt into shell-only behavior.
//
// Pattern: each method wraps blissfulDesktop.call(command, args). The shim
// generates a UUID per call and resolves the Promise when the matching
// {type:'response', id, ok, result} message arrives.

interface BlissfulDesktopBridge {
  runtime: 'native';
  call: <T = unknown>(command: string, args?: unknown) => Promise<T>;
  on: <T = unknown>(event: string, cb: (data: T) => void) => () => void;
}

export interface MpvTrack {
  id: number;
  /** "audio" | "video" | "sub" */
  kind: string;
  title: string | null;
  lang: string | null;
  codec: string | null;
  selected: boolean;
}

declare global {
  interface Window {
    blissfulDesktop?: BlissfulDesktopBridge;
  }
}

function bridge(): BlissfulDesktopBridge | null {
  return window.blissfulDesktop ?? null;
}

export function isNativeShell(): boolean {
  return bridge()?.runtime === 'native';
}

async function call<T>(command: string, args?: unknown): Promise<T> {
  const b = bridge();
  if (!b) throw new Error(`blissfulDesktop unavailable (command=${command})`);
  return b.call<T>(command, args);
}

function on<T = unknown>(event: string, cb: (data: T) => void): () => void {
  const b = bridge();
  if (!b) return () => {};
  return b.on<T>(event, cb);
}

export const desktop = {
  // Sentinel — true only when the Rust shell injected the bridge.
  isNativeShell,

  // ---- core / lifecycle ----
  getAppVersion(): Promise<string> {
    return call<string>('getAppVersion');
  },
  log(line: string): Promise<null> {
    return call<null>('log', line);
  },
  ensureStreamingServer(): Promise<boolean> {
    return call<boolean>('ensureStreamingServer');
  },

  // ---- player controls (mpv) ----
  play(): Promise<null> {
    return call<null>('play');
  },
  pause(): Promise<null> {
    return call<null>('pause');
  },

  // ---- mpv generic bridge (Phase 2) ----
  mpv: {
    /** Fire an mpv command. Equivalent to `mpv.command(name, ...args)`. */
    command(name: string, ...args: unknown[]): Promise<null> {
      return call<null>('mpv.command', [name, ...args]);
    },
    /** Set an mpv property — value type is preserved (bool/number/string). */
    setProperty(name: string, value: unknown): Promise<null> {
      return call<null>('mpv.setProperty', [name, value]);
    },
    /**
     * Fetch the current track list. libmpv2 5.0 can't return the
     * Node-format `track-list` directly, so the shell walks
     * `track-list/N/...` primitives and serializes the result.
     */
    getTracks(): Promise<MpvTrack[]> {
      return call<MpvTrack[]>('mpv.getTracks');
    },
  },

  /** Seek N seconds relative to current time-pos (negative = backwards). */
  seek(seconds: number, mode: 'relative' | 'absolute' = 'relative'): Promise<null> {
    return call<null>('seek', { seconds, mode });
  },

  // ---- mpv events (Phase 2) ----
  /** Subscribe to property changes. Fires per property; check `name`. */
  onMpvPropChange(cb: (e: { name: string; value: unknown }) => void): () => void {
    return on<{ name: string; value: unknown }>('mpv-prop-change', cb);
  },
  /** Subscribe to lifecycle events: FileLoaded, StartFile, Seek, PlaybackRestart, EndFile, Shutdown. */
  onMpvEvent(cb: (e: { type: string; reason?: string }) => void): () => void {
    return on<{ type: string; reason?: string }>('mpv-event', cb);
  },

  // ---- window / fullscreen ----
  toggleFullscreen(): Promise<boolean> {
    // Resolves with the NEW fullscreen state after toggling.
    return call<boolean>('toggleFullscreen');
  },
  isFullscreen(): Promise<boolean> {
    return call<boolean>('isFullscreen');
  },
  onFullscreenChanged(cb: (fullscreen: boolean) => void): () => void {
    return on<boolean>('fullscreen-changed', cb);
  },

  // ---- navigation ----
  openPlayer(options?: unknown): Promise<null> {
    return call<null>('openPlayer', options);
  },

  // ---- auto-updater (Phase 1 stubs; Phase 6 implements) ----
  downloadUpdate(): Promise<null> {
    return call<null>('downloadUpdate');
  },
  installUpdate(): Promise<null> {
    return call<null>('installUpdate');
  },
  onUpdateAvailable(cb: (version: string) => void): () => void {
    return on<string>('update-available', cb);
  },
  onUpdateDownloaded(cb: () => void): () => void {
    return on<null>('update-downloaded', () => cb());
  },

  // ---- generic event subscription escape hatch ----
  on,
};
