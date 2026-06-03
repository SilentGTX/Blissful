// Tauri ⇄ Blissful bridge adapter (Android TV build only).
//
// The React UI talks to its native host exclusively through
// `window.blissfulDesktop = { runtime:'native', call, on }` (see desktop.ts).
// On Windows that object is injected by the Rust shell's WebView2 script
// (ipc/mod.rs JS_SHIM) over `window.chrome.webview.postMessage` — APIs that do
// NOT exist in the Android System WebView. This module re-creates the SAME
// object over Tauri's `invoke`/`event.listen` (exposed as `window.__TAURI__`
// by `withGlobalTauri: true`), so the entire isNativeShell()-gated UI lights
// up unchanged on Android.
//
// Self-installing on import and fully guarded:
//   - no-op if `window.blissfulDesktop` already exists (Windows shell wins)
//   - no-op if `window.__TAURI__` is absent (plain browser / dev without Tauri)
// so importing it from main.tsx is safe in every build.
//
// Wire model: Tauri's `invoke` already correlates request↔response, so unlike
// the WebView2 shim we don't need the {id} envelope — `call` is a thin wrapper
// over `invoke('bridge', { command, args })`, and `on` wraps `event.listen`.

interface TauriGlobal {
  core: {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    // Plugin-scoped events (Kotlin BlissfulMpvPlugin `trigger(...)`) arrive here,
    // not on the global event bus. Optional — absent in older runtimes.
    addPluginListener?: <T>(
      plugin: string,
      event: string,
      cb: (payload: T) => void,
    ) => Promise<{ unregister: () => Promise<void> }>;
  };
  event: {
    listen: <T>(
      event: string,
      handler: (e: { payload: T }) => void,
    ) => Promise<() => void>;
  };
}

// The native player plugin (Kotlin BlissfulMpvPlugin) CANNOT deliver its
// mpv-prop-change / mpv-event stream through Tauri's plugin event system:
// `addPluginListener('blissful-mpv', …)` invokes `plugin:blissful-mpv|
// registerListener`, which the capability ACL denies — the in-crate plugin
// (tauri::plugin::Builder in src/mpv.rs) ships no permission set, so there is
// no `blissful-mpv:*` permission to grant. Instead the Kotlin side pushes each
// event straight into the page via `webView.evaluateJavascript("window.
// __blissMpvEmit(event, payload)")`; we register those listeners in a local map
// that __blissMpvEmit fans out to. Everything else (update-available, etc.) is a
// global app event via listen(), which core:default permits. (The `bridge`
// invoke command is app-defined and NOT ACL-gated — that's why call() works.)
const PLUGIN_EVENTS = new Set(['mpv-prop-change', 'mpv-event']);

function installTauriBridge(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    blissfulDesktop?: unknown;
    __TAURI__?: TauriGlobal;
    __blissMpvListeners?: Record<string, Set<(d: unknown) => void>>;
    __blissMpvEmit?: (event: string, data: unknown) => void;
  };

  // Windows shell already injected the real bridge — leave it alone.
  if (w.blissfulDesktop) return;
  // Not running under Tauri (browser / Vite dev) — stay a no-op so
  // isNativeShell() stays false and the SimplePlayer/browser paths apply.
  const tauri = w.__TAURI__;
  if (!tauri) return;

  const { invoke } = tauri.core;
  const { listen } = tauri.event;

  w.blissfulDesktop = {
    runtime: 'native',
    // Extra hint for platform.ts::isAndroidTv() — harmless on desktop.
    platform: 'android-tv',

    call<T = unknown>(command: string, args?: unknown): Promise<T> {
      return invoke<T>('bridge', { command, args: args ?? null });
    },

    on<T = unknown>(event: string, cb: (data: T) => void): () => void {
      // Player (mpv) events: delivered by the Kotlin plugin via
      // webView.evaluateJavascript -> window.__blissMpvEmit (see the note above
      // re: ACL). Register into a local fan-out map; no Tauri event system.
      if (PLUGIN_EVENTS.has(event)) {
        const reg = (w.__blissMpvListeners ??= {});
        const set = (reg[event] ??= new Set<(d: unknown) => void>());
        set.add(cb as (d: unknown) => void);
        if (!w.__blissMpvEmit) {
          w.__blissMpvEmit = (ev: string, data: unknown) => {
            const s = w.__blissMpvListeners?.[ev];
            if (!s) return;
            // Copy so a listener that unsubscribes mid-dispatch can't mutate the
            // set we're iterating; a throwing listener must not kill the rest.
            for (const fn of Array.from(s)) {
              try {
                fn(data);
              } catch {
                /* ignore */
              }
            }
          };
        }
        return () => {
          reg[event]?.delete(cb as (d: unknown) => void);
        };
      }
      // Non-plugin app events (update-available, fullscreen-changed, …) use the
      // global event bus, which core:default permits. listen() resolves to an
      // unlisten fn; bridge the async gap so the returned disposer always works.
      let dispose: (() => void) | null = null;
      let cancelled = false;
      void Promise.resolve(listen<T>(event, (e) => cb(e.payload))).then((un) => {
        if (cancelled) un();
        else dispose = un;
      });
      return () => {
        cancelled = true;
        if (dispose) dispose();
      };
    },
  };

  // eslint-disable-next-line no-console
  console.log('blissfulDesktop: Tauri bridge installed (android-tv)');
}

installTauriBridge();

export {};
