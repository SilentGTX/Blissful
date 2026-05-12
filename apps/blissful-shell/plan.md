# Blissful Native Shell — Rust + WebView2 + libmpv

## Goal

Replace `apps/blissful-desktop/` (Electron) with a native Windows shell that matches Stremio Desktop's playback architecture: Rust binary linking `libmpv` (via the `libmpv2` crate), rendering directly to a Win32 HWND via d3d11/gpu-next, with the existing React app hosted in a WebView2 surface composited above. Cold-torrent playback, 4K HDR HEVC, seek latency, audio codec coverage — all match Stremio Desktop because we use the same playback engine the same way.

**Estimated effort: 26–43 working days** (Windows-only MVP, including the larger Phase 4 frontend refactor and the LGPL `libmpv-2.dll` sourcing step).

## Why this stack, not Tauri or Electron

- **Stremio's own shell-ng team chose this stack** (`webview2` + `native-windows-gui` + `libmpv2` directly, no Tauri). They evaluated the same options and went raw.
- **Tauri abstracts the load-bearing compositing layer** behind `wry`, and `wry`'s transparency story has multiple open bugs at exactly the parented-HWND scenario we need.
- **Electron + libmpv has no path forward**: no maintained N-API binding for libmpv, no PPAPI in modern Chromium, koffi FFI would still hit the GPU frame-transport problem. The koffi route is 2–3 weeks of risky engineering that gets us to "maybe works"; the raw-Rust route is more boilerplate but a known-good architecture.

The cost is more boilerplate. The gain is no surprises in the rendering pipeline.

## Reference, not source

`stremio-shell-ng` is **reference for architecture and patterns only**, not a code source — its repo has no LICENSE file, so we can't copy code wholesale. Clean-room implementation following the same architectural choices (HWND layout, IPC command names, input-forwarding strategy, libmpv property set). The `libmpv2` crate itself is LGPL-2.1, fine to depend on.

### libmpv distribution license — checkpoint before bundling

**mpv ships GPL by default; LGPL only when built with `-Dgpl=false`.** The `libmpv-2.dll` we bundle determines the obligations on us, not the `libmpv2` Rust crate.

- The current Electron build uses `mpv-winbuild-cmake` releases, which are **GPL-licensed** ([repo](https://github.com/shinchiro/mpv-winbuild-cmake), README). Shipping that DLL with a closed-source app is a GPL violation.
- We must switch to an **LGPL-built** `libmpv-2.dll`. Options:
  - Build `libmpv` ourselves with `meson -Dgpl=false -Dlibmpv=true` using the official mpv build instructions
  - Source a prebuilt LGPL binary from a maintained build pipeline (verify license headers + linked FFmpeg config before bundling — ffmpeg also has GPL components like libpostproc and x264 we must avoid)

**LGPL compliance is more than dropping a license file in the installer.** Section 6 of LGPL-2.1 requires we preserve the user's ability to swap in a modified `libmpv-2.dll`. Concretely, in our build we will:

1. **Dynamic linking only** — our Rust binary links to `libmpv-2.dll` at runtime, not statically. The `libmpv2` crate is fine; libmpv-sys also resolves the DLL at load time. Verify with `dumpbin /imports blissful-shell.exe` that `libmpv-2.dll` appears as an import.
2. **Bundle a `LICENSE-libmpv.txt`** in the installer (the LGPL-2.1 text) alongside `libmpv-2.dll`. Visible in `Add/Remove Programs` notice and shipped in `%PROGRAMFILES%/Blissful/`.
3. **Document the source and build origin** in `apps/blissful-shell/THIRD_PARTY_NOTICES.md`:
   - Where the DLL came from (URL of build pipeline, or our `meson` invocation)
   - The exact mpv tag/commit hash
   - The FFmpeg version it was linked against and its `--enable-*`/`--disable-*` flags
   - A pointer to where the user can obtain the source code matching this DLL (mpv tag → mpv-player/mpv GitHub, FFmpeg version → FFmpeg/FFmpeg GitHub)
4. **Make replacement practical** — `libmpv-2.dll` sits in `%PROGRAMFILES%/Blissful/` as a standalone file (no DLL embedding, no signed-binary mechanism that would reject a user-replaced DLL). A user with a modified LGPL `libmpv-2.dll` can swap the file and re-run the shell.
5. **Mention LGPL replacement-right in `README.md`** under a Licensing section, linking to the THIRD_PARTY_NOTICES file.
6. **Re-verify after each libmpv version bump** — when we update the bundled DLL, also update `THIRD_PARTY_NOTICES.md` with the new mpv/FFmpeg versions and check the build config hasn't accidentally re-enabled GPL components.

This applies to all future bundled mpv components (sub-codecs, decoders, dvdnav, libbluray) — track licensing per-component.

**Action item before Phase 2:** sourced or built LGPL `libmpv-2.dll` placed at `apps/blissful-shell/resources/mpv-x64/libmpv-2.dll`, with `THIRD_PARTY_NOTICES.md` documenting origin. Do not link against the current GPL `mpv-winbuild-cmake` binary in any shipped artifact.

## Architecture decisions (Phase 0a-verified)

These are the choices that actually proved out in the Phase 0a spike. Some are different from the original plan — see "Phase 0a findings" below for why.

- **Shell binary**: Rust 1.75+, native Win32 entry point.
- **Window management**: `native-windows-gui` (NWG). Handles HWND lifecycle, system tray, native dialogs, DPI.
- **Web UI host**: **`webview2 = "0.1.4"` + `webview2-sys = "0.1.1"`** — the older higher-level wrapper that stremio-shell-ng ships in production. **NOT `webview2-com`** (we tried it first; that crate's controller does not composite over libmpv's d3d11 surface — see findings).
- **Video engine**: `libmpv2 = "5.0"` crate (we tested with libmpv build mpv v0.41.0-524-g5921fe50b, HW decode via d3d11va confirmed).
- **HWND layout** (load-bearing — note simplified from original plan):
  - **Parent frame HWND** — created by NWG, owns both siblings below directly
  - **mpv render HWND** (sibling 1) — libmpv creates this *itself* as a direct child of parent when we pass `wid = parent_hwnd`. We never create an intermediate video_host wrapper — that was the original plan's mistake. The mpv-created HWND has class "mpv".
  - **WebView2 host HWND** (sibling 2) — created by `webview2::EnvironmentBuilder::build` → `create_controller(parent_hwnd, ...)`. Has class `Chrome_WidgetWin_0`. Background set to `webview2_sys::Color { r:0, g:0, b:0, a:0 }`. Page body is `background: transparent`.
- **IPC** (Phase 0a uses simplified version): JS calls `window.chrome.webview.postMessage(JSON.stringify(cmd))`, Rust receives via `webview.add_web_message_received(...)`. JSON-encoded values arrive with surrounding quotes — parse via `serde_json::from_str` to extract the bare string. Phase 1 adds the full request/response/event protocol with correlation IDs.

This is the `stremio-shell-ng` architectural pattern, ported with our own implementation.

## Phase 0a findings (what we actually learned spiking this)

These supersede some of the original plan above. Recorded here so future iterations don't repeat the experiment.

### What went right (the proven setup)

1. **The `webview2` crate composites correctly over libmpv's d3d11 surface without any z-order tricks or composition controller.** Whatever it does internally — likely setting WS_EX_NOACTIVATE or similar on its host HWND — Just Works. Stremio Desktop has been shipping this for years and we now know why.
2. **Pass `wid = parent_hwnd` to libmpv**, not a child HWND. libmpv creates its own render window. Trying to give libmpv an empty STATIC parent class window (our "video_host" attempt) doesn't change anything — libmpv re-parents or creates siblings anyway.
3. **Don't pre-configure `vo`, `gpu-api`, `d3d11-flip`, `hwdec=auto-safe`.** mpv's defaults are correct on Windows. The minimal stremio config (just `wid`, `hwdec=auto`, `audio-client-name`, logging) is what works.

### What went wrong (rejected paths)

1. **`webview2-com 0.36`** — modern Microsoft bindings, abstracted at the wrong level. With `webview2-com`, the WebView2's HWND is created as a sibling under the parent BUT the d3d11 swap chain owned by mpv's child window draws on top in DWM composition regardless of HWND z-order. SetWindowPos(HWND_TOP) does nothing. SetWindowPos(HWND_BOTTOM) on mpv hides it instead of pushing it under. Three different tests (default flip-model, `d3d11-flip=no` bitblt-model, `vo=direct3d` D3D9 backend) all kept WebView2 invisible. The standard Microsoft remediation here is **CoreWebView2CompositionController + DirectComposition visual tree (~200 lines of additional COM)** — we did not need to write that because `webview2 = "0.1.4"` already handles this.
2. **Intermediate video_host HWND** — adding our own STATIC child between parent and mpv added zero value and complicated z-order debugging.
3. **`libmpv2 = "5.0"` event API** — `Mpv::wait_event` takes `&mut Mpv` which conflicts with sharing via `Arc<Mpv>`. Stremio uses libmpv2 4.x which exposes `EventContext::new(mpv.ctx)` directly. Phase 1 will solve this via `Mpv::create_client(Some("event-loop"))` so we get a second handle for the event thread.

### Runtime/build wrinkles documented in PREREQUISITES.md

- `mpv.lib` (MSVC import library) is not shipped with shinchiro's mpv-winbuild-cmake archives. Generate from the DLL using `dumpbin /exports` + `lib /def:mpv.def`. PREREQUISITES.md §2 captures the recipe.
- `libmpv-2.dll` must be next to the .exe at runtime (Windows resolves implicit DLL imports before `main()` runs, so `SetDllDirectoryW` in our entry point is too late). For dev: copy from `resources/mpv-x64/` to `target/debug/`. For installer: place in same dir as `Blissful.exe`.
- shinchiro's libmpv build is **GPL** (compiled with `gpl=true`, `libbluray`, `dvdnav` enabled). Fine for local Phase 0 dev; must be replaced with an LGPL build before any installer ships. See LGPL section above.

## What stays vs what gets rewritten

### Stays unchanged

- **`apps/blissful-mvs/` React app** — components, hooks, lib, Stremio API integration, addon-proxy logic, library sync, progress save, splash, toasts, settings UI
- **Streaming server bundle** — `stremio-service.zip` and `ffmpeg-dlls/` from the existing build
- **`SimplePlayer.tsx`** stays for web (browser-based usage on `blissful.budinoff.com`) — does NOT change

### Gets rewritten / added

- **New `apps/blissful-mvs/src/components/NativeMpvPlayer.tsx`** — a sibling of SimplePlayer, hosts the controls overlay but talks to libmpv via the new IPC bridge instead of an `HTMLVideoElement`. Reuses the controls UI (factored out) but doesn't pretend `<video>` events drive anything.
- **`apps/blissful-mvs/src/pages/PlayerPage.tsx`** — routes to NativeMpvPlayer when running in the native shell (detected via `window.blissfulDesktop?.runtime === 'native'`), SimplePlayer otherwise
- **Shared controls component** — extracted from SimplePlayer (back button, seek bar, audio/sub menus, play/pause/volume, settings, up-next, toasts). Both SimplePlayer and NativeMpvPlayer mount it and pass an adapter object exposing `{play, pause, seek, setVolume, setMuted, audioTracks, subTracks, isPlaying, currentTime, duration, isBuffering}`.
- **`apps/blissful-mvs/src/lib/desktop.ts`** — typed shim that exposes `window.blissfulDesktop.*` calling `window.chrome.webview.postMessage` underneath. Replaces the preload bridge.
- **`apps/blissful-shell/`** new Rust crate (full structure below).
- **Auto-updater** — small Rust downloader + self-replace bootstrapper, matches existing in-app toast UX.
- **Installer + signing** — WiX or NSIS via `cargo-wix`/`cargo-bundle`, same Authenticode cert.

### Explicit inventory of the current desktop API surface to preserve or deprecate

From [`apps/blissful-desktop/preload.cjs`](apps/blissful-desktop/preload.cjs) — every method exposed on `window.blissfulDesktop`:

| Method | New shell handling |
|---|---|
| `openPlayer(options)` | Port — opens a player route in the WebView |
| `onUpdateAvailable(cb)` | Port — Rust auto-updater fires event |
| `onUpdateDownloaded(cb)` | Port |
| `downloadUpdate()` | Port — Rust handler downloads from GitHub Release |
| `installUpdate()` | Port — Rust launches the downloaded installer + quits |
| `getAppVersion()` | Port — Rust returns `env!("CARGO_PKG_VERSION")` |
| `toggleFullscreen()` | Port — NWG sets borderless fullscreen, resizes child HWNDs |
| `isFullscreen()` | Port |
| `onFullscreenChanged(cb)` | Port |
| `ensureStreamingServer()` | Port |
| `log(line)` | Port — writes to `%APPDATA%/Blissful/player.log` |
| `getRemuxUrl(sourceUrl)` | **Deprecate** — ffmpeg-remux endpoint was only needed because Chrome's `<video>` couldn't decode E-AC-3 in MKV. libmpv handles every codec natively. The endpoint can stay implemented for SimplePlayer/web fallback but the native shell doesn't need it. |
| *(new)* `mpv.command(...)`, `mpv.setProperty(...)`, `mpv.observeProperty(...)`, `mpv.on(cb)` | Port from the deleted MpvPlayer IPC — same JSON shape, new transport |
| *(new)* `runtime: 'native'` | Sentinel so the renderer knows it's running in the Rust shell |

## Project structure

```
apps/
  blissful-mvs/                            # React app (kept; gains NativeMpvPlayer + adapter)
  blissful-desktop/                        # Existing Electron shell — kept until Phase 8 swap
  blissful-shell/                          # NEW
    Cargo.toml
    build.rs
    src/
      main.rs                              # Win32 entry, argv parse, splash
      app.rs                               # AppState, channel wiring
      main_window.rs                       # Parent frame, sibling layout + resize. mpv + WebView2 BOTH children of this window's HWND. NO video_host wrapper (Phase 0a confirmed it's unnecessary).
      webview.rs                           # WebView2 controller via `webview2` crate, transparent setup, postMessage bridge
      ipc/
        mod.rs                             # Protocol + dispatcher
        protocol.rs                        # Request/response/event types (serde)
        commands.rs                        # One Rust fn per IPC command
      player/
        mod.rs
        mpv.rs                             # libmpv2 init + event thread + command thread
        input.rs                           # Mouse/keyboard forwarding to mpv (WS_DISABLED workaround)
      streaming_server.rs                  # stremio-runtime spawn + auto-restart
      proxy.rs                             # /addon-proxy, /stremio/* HTTP proxy
      ui_server.rs                         # Local HTTP server for blissful-ui/ in packaged builds
      updater.rs                           # GitHub Releases check + self-replace
      tray.rs                              # System tray
      paths.rs                             # %APPDATA%, resources dir, log paths
      log.rs                               # File logger
    resources/
      blissful-ui/                         # Copied from apps/blissful-mvs/dist at build time
      mpv-x64/libmpv-2.dll                 # Bundled libmpv
      ffmpeg-dlls/                         # Same set as current Electron build
      stremio-service.zip
      icon.ico
      splash.png
    installer/
      blissful.wxs                         # WiX installer
      sign.ps1                             # Code-signing helper
    .github/
      workflows/
        release.yml                        # Build → sign → installer → sign → GitHub Release
```

## Phase 0 — Architecture spike (HARD GATE) — ✅ 0a + 0b PASSED

**This phase is a kill-switch.** If transparency + HWND compositing don't work as expected, the entire architecture is invalidated and we go back to the planning table before sinking weeks into the rewrite.

**Status (2026-05-11):** BOTH hard gates passed.

- **0a** — hardcoded HTML compositing over libmpv with HEVC HW decode (d3d11va), transparent WebView2 strips, working Play/Pause IPC roundtrip.
- **0b** — same checklist but with the real React app: temporary [`PlayerSpikePage.tsx`](../blissful-mvs/src/pages/PlayerSpikePage.tsx) route registered as a top-level sibling of `/` in [`App.tsx`](../blissful-mvs/src/App.tsx) (outside `AppShell`, `SplashScreen`, and providers — keeps the spike minimal). Rust shell points its WebView at `http://localhost:5173/player-spike` via the `BLISSFUL_SPIKE_URL` env var (default), navigates via the `webview2` crate's `webview.navigate(url)`. Render result is identical to 0a — confirms `apps/blissful-mvs/src/index.css` doesn't carry opaque `html/body/#root` backgrounds.

Time invested: ~5 hours, mostly burned on webview2-com vs webview2 crate selection that should have been resolved by reading stremio-shell-ng's Cargo.toml on day one. See "Phase 0a findings" above.

Cleanup deferred to Phase 1 start: delete `PlayerSpikePage.tsx`, remove the `/player-spike` route registration from `App.tsx`, restore the original `<BrowserRouter><SplashScreen>...` wrapping. Tracked as a TODO in the route comments.

Build the smallest possible proof. No IPC framework, no updater, no proxies, no React. Just:

1. **Native Win32 main window** via NWG (`MainWindow` with title bar, close button).
2. **Video host child HWND** (`STATIC` class, `WS_CHILD | WS_CLIPSIBLINGS`) sized to **fill the entire client area**. This is critical — the video host must extend the full window, not just the middle band, so the test actually proves "semi-transparent WebView2 overlays compose with video underneath" rather than "video plays in a sub-region". If the video host is recessed under the strips, video isn't actually showing through the translucent overlay; we'd be proving a weaker property.
3. **libmpv loads a hardcoded local 4K HEVC HDR file** with `wid` set to the video-host HWND. Set `vo=gpu`, `hwdec=auto-safe`, `keep-open=yes`. Confirm via Task Manager that GPU video decode usage is non-zero (HW decode working).
4. **WebView2 host HWND** sized to fill the entire parent client area, z-order above the video host (same layout as the video host — they stack as siblings, both at full size). Load a hardcoded HTML string:
   ```html
   <html style="background: transparent">
     <body style="margin:0; background: transparent; color: white; font: 14px sans-serif">
       <div style="position:fixed; top:0; left:0; right:0; height:60px; background: rgba(0,0,0,0.6); padding:16px">← Back</div>
       <div style="position:fixed; bottom:0; left:0; right:0; height:80px; background: rgba(0,0,0,0.6); padding:16px">
         <button id="pause">Pause</button>
         <button id="play">Play</button>
       </div>
     </body>
     <script>
       document.getElementById('pause').onclick = () => window.chrome.webview.postMessage({cmd:'pause'});
       document.getElementById('play').onclick = () => window.chrome.webview.postMessage({cmd:'play'});
     </script>
   </html>
   ```
5. **Set WebView2 transparent background**: `CoreWebView2Controller.DefaultBackgroundColor = Color.FromArgb(0,0,0,0)`. Page body and html elements are `background: transparent`. The two strips are semi-opaque dark rectangles; the **middle is transparent (video fully visible) AND the strips themselves should show video bleed through their 40% transparency** — both must work.
6. **Wire postMessage**: `WebMessageReceived` handler dispatches to `mpv.command("set", "pause", "yes"|"no")`.

### Phase 0a acceptance — hardcoded-HTML compositing proof

- [ ] Native window opens, no Electron processes, single .exe runs
- [ ] mpv plays the test file with HW decode (verified in Task Manager → Performance → GPU 0 → Video Decode)
- [ ] WebView2 loads the HTML, renders semi-opaque strips top and bottom
- [ ] **Middle region is fully transparent** — video shows through with no white/black square hiding it
- [ ] **Translucent strips actually let video bleed through** — looking at the strip you should see the video tinted darker by the 40% black, not a flat opaque rectangle. (If strips are flat opaque, transparency is per-window not per-pixel and the architecture needs adjustment.)
- [ ] Click the Play/Pause buttons in the HTML — mpv actually pauses/resumes via postMessage
- [ ] Resize the window — both child HWNDs follow, no flicker, no compositor jank
- [ ] Toggle window focus — strips don't flash white/black on focus change
- [ ] Drag-resize the window — strips redraw without ghost titlebar or stale frames
- [ ] Quit cleanly — no hung processes

### Phase 0b — actual React app compositing proof (do this BEFORE Phase 1)

Hardcoded HTML passing 0a doesn't prove the React app composites transparently. `apps/blissful-mvs/` has accumulated opaque root backgrounds, `<html>` styling, and theme CSS that can hide mpv even when WebView2's controller is transparent. Add this second gate:

- Build `apps/blissful-mvs/` with Vite (`npm run build`).
- Add a temporary `/player-spike` route that renders:
  - Empty top div (60 px, semi-opaque bg) — back-button placeholder
  - Empty middle div with **`background: transparent` and explicit `pointer-events: none`** — this is where mpv shows through
  - Empty bottom div (80 px, semi-opaque bg) — controls placeholder with one button
- Audit `index.html`, `index.css`, AppShell, theme provider for opaque backgrounds. Override `html, body, #root { background: transparent; }` on the player route specifically.
- Point the shell's WebView at `http://localhost:5173/player-spike` (or local UI server in packaged mode).
- The same nine-box acceptance from 0a must pass with the real React-rendered DOM.

**Phase 0b is also a hard gate.** If the real React app can't be made transparent in the player region, the whole UI layer needs deeper rework (root component restructure, CSS audit) before Phase 1 makes sense.

### If Phase 0 fails — fallbacks

- Try `WebView2.put_DefaultBackgroundColor` with a tiny non-zero alpha (some reports suggest exact transparent black has compositing issues)
- Try a layered window approach (`WS_EX_LAYERED` on the WebView host)
- Try `wry` instead of `webview2-com` direct (Tauri's wrapper may apply transparency tricks we'd need)
- Fall back to "WebView2 above, mpv host outside the WebView region" with the controls in a separate strip (no overlay at all — less elegant but still beats Electron)

**Do not proceed past Phase 0 until both 0a and 0b acceptance boxes are checked.** This protects the whole rest of the plan.

## Phase 1 — IPC bridge — ✅ functional MVP shipped (2026-05-11)

**Status:** Phase 1 protocol bridge is alive end-to-end with the full Phase 1 command surface plus stubs for Phase 3/6 commands so the renderer's shim API is stable.

What's wired (verified in the PlayerSpikePage running over libmpv):
- Typed protocol: `Request { id, command, args }`, `Response { id, ok, result|error }`, `Event { event, data }`. JSON-tagged Outgoing for response/event discrimination. ([protocol.rs](src/ipc/protocol.rs))
- JS shim auto-injected via `add_script_to_execute_on_document_created`. Generates UUID per call, resolves Promises by `id`, dispatches Events to subscribers. ([ipc/mod.rs](src/ipc/mod.rs) JS_SHIM const)
- Commands: `getAppVersion`, `log` (writes to `%APPDATA%/Blissful/player.log`), `play`, `pause`, `toggleFullscreen`, `isFullscreen`, `openPlayer`, `ensureStreamingServer` (Phase 1 stub returning true), `downloadUpdate`/`installUpdate` stubs ([commands.rs](src/ipc/commands.rs)).
- Event direction (Rust → JS): `fullscreen-changed` fires after toggle. ([state.rs](src/state.rs) event_sink registered from webview.rs after controller-ready callback)
- Typed renderer shim at [apps/blissful-mvs/src/lib/desktop.ts](../blissful-mvs/src/lib/desktop.ts) with `isNativeShell()` sentinel and all the methods above.
- Shared state lives in a thread_local `ShellState` (player handle, main HWND, fullscreen state, log file, event sink, resize_webview callback). Every dispatch runs on the UI thread for now; no Tokio yet.

What's deliberately deferred from the original Phase 1 spec:
- **Tokio + flume Notice channel for cross-thread dispatch.** None of the current commands need it (all fast UI-thread work). When the first I/O-bound command lands (e.g. HTTP fetch in the auto-updater, file extraction for stremio-service), we add the threading layer alongside it. Document the WebView2 STA rule in webview.rs when we do.
- **Real `ensureStreamingServer` impl.** Plan.md Phase 3 owns that.
- **Real auto-updater (`downloadUpdate`, `installUpdate`, `update-*` events).** Plan.md Phase 6 owns that. Stubs only.
- **mpv property observers + event thread.** Plan.md Phase 2 owns that. The libmpv `wait_event` `&mut Mpv` requirement means we'll use `Mpv::create_client(Some("event-loop"))` to get a separate handle for the event thread.

### Threading rule (still applies; documented in webview.rs)

WebView2's `CoreWebView2` and `CoreWebView2Controller` COM objects are STA. Every method on them, including `post_web_message_as_string`, MUST be called on the UI thread that created the WebView. Phase 1 satisfies this trivially because all dispatch runs synchronously in the `add_web_message_received` callback (already on the UI thread). When Tokio joins the party (Phase 1.5 / 2 / 6), the pattern locked in is:

- Tokio runs on a separate threadpool for I/O-bound or long-running work.
- A `flume::Sender<UiTask>` is shared with all Tokio tasks. `UiTask` carries an `Outgoing` payload destined for the WebView.
- The UI thread pumps the NWG event loop and a `flume::Receiver<UiTask>` together via NWG's `Notice` (a wrapper over `PostMessage(WM_USER)`), draining the channel and calling `post_web_message_as_string` from the UI thread.
- Same rule applies to libmpv → renderer events: the libmpv event thread sends an Event payload through the channel, the UI thread picks it up and posts.

### Original Phase 1 implementation plan, kept for reference

### WebView2 threading rule (lock this in before coding)

WebView2's `CoreWebView2` and `CoreWebView2Controller` COM objects are STA (single-threaded apartment) — every method on them, including `PostWebMessageAsJson`, **must be called on the UI thread that created the WebView**. Calling from a Tokio worker thread will return `RPC_E_WRONG_THREAD` or crash.

The pattern we follow:

- The UI thread (the one NWG's main window runs on) owns the WebView2 controller.
- Tokio runs on a separate threadpool for any I/O-bound or long-running work (HTTP requests, file extraction, stremio-runtime supervision, libmpv event loop).
- A `flume::Sender<UiTask>` is shared with all Tokio tasks. A `UiTask` is anything that needs to touch the WebView (e.g., `UiTask::PostMessage(json: String)`).
- The UI thread pumps the message loop and a `flume::Receiver<UiTask>` together: NWG provides `dispatch_thread_events_with_callback` or we use a `WM_USER`-level custom window message to wake the UI thread when a `UiTask` is enqueued, then `try_recv` drains the channel and calls `PostWebMessageAsJson` from the UI thread.
- Same rule applies to libmpv → renderer events: the libmpv event thread sends an `Event` payload through a channel, the UI thread picks it up and posts it to the WebView.

Document this in `src/webview.rs` doc comment so future contributors don't accidentally call `PostWebMessageAsJson` from a worker.

### Implementation

- Define `ipc/protocol.rs` types: `Request { id, command, args }`, `Response { id, result | error }`, `Event { name, data }`. Match the existing IPC command names from `apps/blissful-desktop/preload.cjs` so renderer code stays simple.
- WebView2 script injection (`add_script_to_execute_on_document_created`): inject the `window.blissfulDesktop` shim mapping every exposed API to a `postMessage` call with a generated correlation ID.
- Rust side: `WebMessageReceived` handler (runs on UI thread) deserializes, hands off to a Tokio task in `ipc/commands.rs` for the actual work, then a `UiTask::PostMessage` lands back to the UI thread which sends the response via `PostWebMessageAsJson`.
- Two endpoints first: `log(line)` (fire-and-forget) and `getAppVersion()` (request/response). Verify roundtrip from `apps/blissful-mvs/`.
- Migrate `apps/blissful-mvs/src/components/SimplePlayer.tsx`'s `ensureStreamingServer` call to also work in the native shell (same shim API).

**Exit criteria:** React app's `playerLog(...)` writes to `%APPDATA%/Blissful/player.log` via the new IPC; `getAppVersion()` returns the right semver; verified that the WebView2 call is happening on the UI thread (logged thread ID in dev builds).

## Phase 2 — libmpv playback fully wired — ✅ functional MVP (2026-05-11)

**Status:** event thread + property observation + cross-thread dispatch all working end-to-end. Renderer subscribes to live `mpv-prop-change` (time-pos, duration, pause, volume, mute, paused-for-cache, eof-reached, idle-active, aid, sid) and lifecycle `mpv-event` (FileLoaded, StartFile, Seek, PlaybackRestart, EndFile, Shutdown). Seek / setProperty / pause / play all routed through typed IPC.

What's wired:
- [src/player/mpv_events.rs](src/player/mpv_events.rs) — `OwnedMpvEvent` (Send-safe owned form of libmpv2 `Event<'a>`) + `OBSERVED_PROPERTIES` list.
- [src/player/mpv.rs](src/player/mpv.rs) — `Player::init` takes an `EventDispatcher` callback. Uses `Mpv::create_client(None)` to get a second handle moved into the event thread (it owns it mutably). Event thread loops `wait_event(-1.0)` and dispatches owned events. Adds `Player::command`, `set_property_{string,double,bool}` helpers for the IPC bridge.
- [src/main_window.rs](src/main_window.rs) — creates `nwg::Notice` + flume channel BEFORE `Player::init`. Dispatcher closure sends through flume + pings Notice. `OnNotice` handler drains channel and posts `Outgoing::Event` via `state::post_outgoing` → JS shim → React `desktop.onMpvPropChange` / `desktop.onMpvEvent` subscribers.
- [src/ipc/commands.rs](src/ipc/commands.rs) — `mpv.command`, `mpv.setProperty`, `seek` (relative/absolute) IPC commands.
- [apps/blissful-mvs/src/lib/desktop.ts](../blissful-mvs/src/lib/desktop.ts) — `desktop.mpv.command()`, `desktop.mpv.setProperty()`, `desktop.seek()`, `desktop.onMpvPropChange()`, `desktop.onMpvEvent()`.

Threading model now in place:
- libmpv event thread (named "mpv-events") owns its own `Mpv` handle from `create_client`, runs `wait_event` in a loop.
- flume::unbounded channel for `OwnedMpvEvent` payloads.
- NWG `Notice` (built on `PostMessage(WM_USER)`) wakes the UI thread when there's a pending event.
- UI thread's OnNotice handler runs the WebView2 post — STA rule satisfied without any explicit thread-id checks.

### libmpv2 5.0.3 footgun (worth remembering)

`Mpv::create_client(Some(name))` is UB-broken: it takes `.as_ptr()` from a temporary CString that's dropped at end of expression, then immediately calls `NonNull::new_unchecked` on the resulting (NULL) handle, which trips the safety precondition and aborts the process (`STATUS_STACK_BUFFER_OVERRUN`). Workaround: pass `None` — that branch uses `ptr::null()` directly and works. The name is just a log label; not load-bearing. Filed mentally as "bug in libmpv2 5.0.3"; if we ever need named clients, fork the crate or drop to `libmpv2-sys` directly.

### Deliberately deferred from Phase 2 (per original spec)

- `track-list` property observation — libmpv emits this as `Format::Node` which our PropertyData mapping doesn't handle yet. Will add once audio/sub track UI lands in Phase 4.
- "HEVC HDR torrent plays" exit criterion — requires Phase 3's streaming server. Local HEVC HW decode (d3d11va) is already proven from Phase 0a.

### Original Phase 2 plan, kept for reference (5–7 days)

Builds on Phase 0's working mpv spike.

- Create `Mpv::with_initializer` setting the property set below.

### libmpv initializer property set (embedded so it survives migration)

```rust
let mpv = Mpv::with_initializer(|init| {
    init.set_property("wid", video_host_hwnd as i64)?;
    init.set_property("audio-client-name", "Blissful")?;

    // No mpv UI — Blissful's React overlay handles all controls.
    init.set_property("osc", "no")?;
    init.set_property("osd-bar", "no")?;
    init.set_property("osd-level", 0i64)?;
    init.set_property("cursor-autohide", "no")?;

    // Keep mpv alive across file loads (we drive it via property/command).
    init.set_property("idle", "yes")?;
    init.set_property("keep-open", "yes")?;

    // Render pipeline (Windows). gpu-next is faster but more recent; gpu is
    // the safe fallback. Re-evaluate after Phase 2 perf testing.
    init.set_property("vo", "gpu")?;
    // Explicit d3d11 backend — matches the current Electron build and gives
    // HW decode via DXVA2/D3D11VA. Without this, mpv auto-selects between
    // d3d11/dxinterop/opengl based on its heuristics; locking it down avoids
    // driver-specific surprises. Verify in mpv logs that "vo/gpu: d3d11"
    // appears on startup; if not, fall back to the default and log why.
    init.set_property("gpu-api", "d3d11")?;
    init.set_property("hwdec", "auto-safe")?;

    // Demuxer / cache tuned for torrent streams. Match the values we
    // measured to work in the Electron build.
    init.set_property("cache", "yes")?;
    init.set_property("demuxer-max-bytes", "150MiB")?;
    init.set_property("demuxer-max-back-bytes", "75MiB")?;
    init.set_property("demuxer-readahead-secs", 20i64)?;

    // Input — we forward all input via IPC; mpv itself ignores keystrokes.
    init.set_property("input-default-bindings", "no")?;
    init.set_property("input-vo-keyboard", "no")?;

    // Subtitles — auto-load matching .srt/.ass files if present.
    init.set_property("sub-auto", "fuzzy")?;

    // Logging — quiet in release; switch to terminal=yes in dev builds.
    #[cfg(debug_assertions)]
    init.set_property("terminal", "yes")?;
    #[cfg(debug_assertions)]
    init.set_property("msg-level", "all=v")?;
    #[cfg(not(debug_assertions))]
    init.set_property("msg-level", "all=warn")?;

    Ok(())
})?;
```

Notes on changes from the deleted Electron arg set:
- `vo=gpu` / `gpu-api=d3d11` separated; libmpv2 lets us configure each via properties
- `hwdec=auto-safe` (libmpv ≥0.36 default-safe option) instead of `auto-copy` — fewer CPU copies, modern drivers
- Demuxer cache bumped from 15 MiB → 150 MiB. The 15 MiB limit was a Stremio mpv.cpp legacy; modern mpv handles larger caches better for high-bitrate torrents.
- `--force-window`, `--no-config`, `--border`, `--show-in-taskbar`, etc. all dropped — those were necessary for the external `mpv.exe` child-window setup. With in-process libmpv targeting our own HWND via `wid`, mpv doesn't manage any windowing itself.
- Event thread: `wait_event(-1.0)`, forward `PropertyChange`, `FileLoaded`, `Seek`, `PlaybackRestart`, `EndFile`, `Shutdown` as IPC events.
- Command thread: receive IPC commands, dispatch to `mpv.command()` / `mpv.set_property()`.
- Observe these properties on init: `time-pos`, `duration`, `pause`, `paused-for-cache`, `volume`, `mute`, `eof-reached`, `track-list`, `aid`, `sid`, `idle-active`.
- Resize bridging: when the parent window resizes, recompute the video host HWND bounds and `SetWindowPos` it; libmpv repaints automatically.
- Fullscreen: when the renderer requests fullscreen, the parent goes borderless, the WebView2 host fills the whole client area, the video host fills 100% (no top/bottom strips). Toggle back to windowed restores strips.

**Exit criteria:** clicking the play button in the React UI plays a real HEVC HDR torrent; seek/pause/volume work; audio/sub track lists populate in the menus.

## Phase 3 — Streaming server + same-origin server (3–4 days)

Port `apps/blissful-desktop/main.cjs`'s streaming-server + proxy logic to Rust. **Critical: the React app uses relative URLs (`/storage/*`, `/addon-proxy/*`, `/resolve-url/*`, `/stremio-server/*`) and expects them on the same origin as the page itself.** Splitting these onto a separate port would break dozens of `fetch` call sites in `apps/blissful-mvs/`. The Rust shell must serve the React app AND all those proxied routes from one HTTP origin.

### Routes the UI server must own (audit of the renderer's fetch calls)

These are the actual URL shapes the React app uses (verified by grepping `apps/blissful-mvs/src/**/*.ts`):

- `GET /` and `GET /assets/*` — serve `blissful-ui/dist/` static files (the React build output)
- `GET /addon-proxy?url=<encoded>` — **query-string style, not path**. Proxy the target URL via `https://blissful.budinoff.com/addon-proxy?url=<encoded>`. Used by `apps/blissful-mvs/src/lib/stremioAddon.ts`, `useAddonRows.ts`, `probeMkvCodecs.ts`, `useImdbRating.ts`.
- `GET /storage/*` — path-style. Proxy to `https://blissful.budinoff.com/storage/*`. Used by `apps/blissful-mvs/src/lib/storageApi.ts`.
- `GET /resolve-url?url=<encoded>` — **implemented locally** in `proxy.rs`, NOT proxied to Budinoff. Performs HEAD-redirect chase on the target URL and returns `{ "url": "<final-resolved-url>" }` as JSON. Matches the current Electron implementation in `main.cjs` (`resolveRedirectUrl`).
- `GET /stremio/*` — path-style. Proxy to `https://www.strem.io/*`. Used by `apps/blissful-mvs/src/lib/stremioFacebook.ts` for OAuth.
- *(optional, only if the React app starts calling it)* `/stremio-server/*` — proxy to `http://127.0.0.1:11470/*` for clients that hit the streaming server via a UI-origin path instead of localhost directly. Current Electron build doesn't have this; only add if a renderer call shows up needing it.
- `GET /sw.js` and `GET /registerSW.js` — return a no-op stub. Prevents PWA service worker from caching the bundle in the native shell (would break the auto-updater path). Current Electron does this; preserve the behavior.

**Audit before Phase 3 starts:** the grep is done, but re-run it just before implementation to catch any new routes added between now and then.

### Implementation

- **`ui_server.rs`** (single HTTP server on `127.0.0.1:5174`, hyper-based):
  - GET `/` and `/assets/*` → serve from `resources/blissful-ui/`
  - All proxy routes above dispatched to handlers in `proxy.rs`
  - In dev mode (env var `BLISSFUL_DEV=1`), `/` and `/assets/*` instead proxy to `http://localhost:5173` (Vite dev server)
- **`proxy.rs`**: HTTP proxy helpers — redirect-follow, header pass-through, byte streaming for the streaming-server route. Reuse logic from `apps/blissful-desktop/main.cjs`'s `proxyHttpRequest` and `resolveRedirectUrl`.
- **`streaming_server.rs`**: extract `stremio-service.zip` to `%APPDATA%/Blissful/stremio-service/` on first run, spawn `stremio-runtime.exe`, supervise with auto-restart on crash, expose `ensureStreamingServer()` IPC.
- The WebView points at `http://127.0.0.1:5174/` in all builds. Production loads our static React build; dev mode proxies to Vite. Single origin everywhere → no CORS, no relative-URL surprises.

**Exit criteria:** packaged dev build launches, loads React app from `http://127.0.0.1:5174/`, all relative-URL fetches succeed, stremio-runtime is alive, addon-proxy serves through.

## Phase 4 — Shared playback layer + NativeMpvPlayer (6–10 days)

This is the **largest frontend task** in the plan. `SimplePlayer.tsx` is ~2900 lines and the controls UI is only ~30% of it — most of the code is state machines, side effects, and async lifecycle around the playback engine (HTMLVideoElement events drive nearly everything). A naive "swap the adapter" approach would leave half the logic still coupled to `<video>`. Treat this phase as designing a shared playback layer, not a quick refactor.

### What's actually entangled with HTMLVideoElement in SimplePlayer

Auditing the current file, these subsystems use video-element events/state directly and need re-implementation against libmpv:

- **Playback state machine** — `isPlaying`/`currentTime`/`duration`/`volume`/`muted`/`isBuffering` are driven by `loadedmetadata`/`timeupdate`/`durationchange`/`volumechange`/`waiting`/`stalled`/`canplay`/`playing` listeners. Replace with libmpv's `pause`/`time-pos`/`duration`/`volume`/`mute`/`paused-for-cache` property observations.
- **Source resolution** — magnet → torrent URL → streaming-server URL, with the warm-reader bootstrap. libmpv doesn't need the warm reader (single sequential read = mpv's natural behavior), but the streaming-server URL flow stays.
- **Subtitle fetching** — `fetchSubtitles` from addons writes blob URLs into `<track>` elements. With libmpv, fetch URLs and pass them to `sub-add <url>` mpv commands; mpv renders the subs into its own surface. Subtitle styling sliders map to `sub-color`, `sub-font-size`, `sub-back-color`, `sub-border-color` property sets.
- **Progress save** — periodic `setProgress(...)` + `updateLibraryItemProgress(...)` calls, throttled. The timer driver moves from `timeupdate` events to `time-pos` property-change events. Stremio API call stays identical.
- **Up Next overlay** — fires when `(duration - currentTime) < notificationDuration`. Driver moves from `timeupdate` to `time-pos`.
- **Audio track switching** — currently uses `videoEl.audioTracks` (Chrome's audio-track API) and HLS.js's `hls.audioTrack`. Replace with libmpv's `track-list` property + `aid` setter.
- **Subtitle track switching** — currently uses `<track>` elements + HLS.js. Replace with libmpv's `sid` setter.
- **HLS.js path** — gone entirely in the native shell (libmpv handles HLS natively if a stream is ever HLS, but stremio-runtime serves raw torrents we play directly).
- **Stream history** — `getLastStreamSelection`/`setLastStreamSelection` — pure localStorage, stays the same.
- **Continue Watching** — same.
- **Stremio library sync** — same.
- **Keyboard handlers + auto-hide controls** — DOM-side, stay the same.
- **Fullscreen** — currently `document.requestFullscreen`; native shell uses `blissfulDesktop.toggleFullscreen()` IPC.

### Plan for the shared layer

Don't try to make one file work for both engines. Instead:

1. **`apps/blissful-mvs/src/player/types.ts`** — define the `PlaybackEngine` interface:
   ```ts
   interface PlaybackEngine {
     load(url: string, startTime?: number): void;
     play(): void; pause(): void; cycle_pause(): void;
     seek(seconds: number): void; seekRelative(delta: number): void;
     setVolume(v: number): void; setMuted(m: boolean): void;
     setAudioTrack(id: string | number | 'auto'): void;
     setSubtitleTrack(id: string | number | 'no'): void;
     loadExternalSubtitle(url: string): Promise<string>; // returns track id
     dispose(): void;
     // Observable state via subscribe callbacks:
     onState(cb: (state: PlaybackState) => void): () => void;
     onEvent(cb: (event: PlaybackEvent) => void): () => void;
   }
   type PlaybackState = { isPlaying, currentTime, duration, volume, muted, isBuffering, audioTracks, subtitleTracks, selectedAudio, selectedSub, ... };
   type PlaybackEvent = { type: 'file-loaded' | 'end-of-file' | 'error', ... };
   ```
2. **`apps/blissful-mvs/src/player/html5Engine.ts`** — implements `PlaybackEngine` driving an `HTMLVideoElement`. Lifts the existing SimplePlayer event-listener mess into one place.
3. **`apps/blissful-mvs/src/player/libmpvEngine.ts`** — implements `PlaybackEngine` driving libmpv via `blissfulDesktop.mpv.*` IPC.
4. **`apps/blissful-mvs/src/player/shared/`** — engine-agnostic logic that listens to the `PlaybackEngine`'s state/events:
   - `useProgressSync.ts` — periodic local + Stremio API progress saves
   - `useSubtitleLoader.ts` — fetches from addons, calls `loadExternalSubtitle`
   - `useUpNext.ts` — auto-advance countdown
   - `useStreamHistory.ts` — already engine-agnostic, just needs the engine to call into it on stream-load
5. **`apps/blissful-mvs/src/components/PlayerControls.tsx`** — pure UI, takes the `PlaybackState` and a command-dispatch fn as props.
6. **`apps/blissful-mvs/src/components/SimplePlayer.tsx`** — refactored to create an `Html5Engine`, mount the shared hooks + `PlayerControls`. Mostly thinner than today.
7. **`apps/blissful-mvs/src/components/NativeMpvPlayer.tsx`** — creates a `LibmpvEngine`, mounts the same shared hooks + `PlayerControls`.
8. **`apps/blissful-mvs/src/pages/PlayerPage.tsx`** — picks engine based on `window.blissfulDesktop?.runtime === 'native'`.

This isn't a one-day refactor of SimplePlayer. Honest breakdown:

- 1d: design `PlaybackEngine` interface + `PlaybackState` shape, write doc comments
- 1d: extract `PlayerControls.tsx` (pure UI subset)
- 2d: extract shared hooks (`useProgressSync`, `useSubtitleLoader`, `useUpNext`)
- 2d: refactor SimplePlayer to use the new structure with `Html5Engine` — verify web build doesn't regress
- 2d: implement `LibmpvEngine` driving the IPC layer
- 1d: wire `NativeMpvPlayer.tsx`, route through `PlayerPage.tsx`
- 1d: input forwarding edge cases (`WS_DISABLED` mpv HWND doesn't get pointer events; transparent click-catcher overlay in NativeMpvPlayer handles them)

**Exit criteria:** every feature in current SimplePlayer (seek, volume, audio/sub switch, fullscreen, back, settings menu, up-next, progress save, library sync, addon-subs) works in NativeMpvPlayer driving libmpv. Web SimplePlayer still works identically through the refactored layer.

## Phase 5 — Tray, splash, fullscreen polish (2–3 days)

- System tray icon (NWG) with show/hide/quit menu
- Splash window on startup, dismissed when WebView fires `NavigationCompleted` for the player route
- Borderless fullscreen via `SetWindowLong(GWL_STYLE)` toggling, handle Esc to exit
- DPI awareness (NWG has Per-Monitor V2 support; verify it works correctly with WebView2 + libmpv on a 4K + 1080p multi-monitor setup)

**Exit criteria:** app feels native — splash on launch, tray icon works, fullscreen smooth, multi-DPI handled.

## Phase 6 — Auto-updater — ✅ shipped (2026-05-11)

**Status:** [src/updater.rs](src/updater.rs) polls
`api.github.com/repos/SilentGTX/OpenCode/releases/latest` 15 s after launch
+ every 30 min, semver-compares `tag_name` to `env!("CARGO_PKG_VERSION")`,
emits the `update-available` IPC Event when a newer release exists. The
renderer's existing [`useDesktopUpdater.ts`](../blissful-mvs/src/hooks/useDesktopUpdater.ts)
hook auto-calls `downloadUpdate`; we pull the installer to `%TEMP%` and
fire `update-downloaded`. Renderer toast → `installUpdate` → we spawn the
installer (`msiexec /i ... /quiet` for MSI, `installer.exe /SILENT` for
EXE) and stop the message loop so the installer can replace the running
binary.

Authenticode verification before spawning is deferred (we'd need a signed
test build to validate). Phase 7 ships signing infra; once that's live,
`download_available` should call `WinVerifyTrust` on the downloaded file
before firing `update-downloaded`.

### Original Phase 6 plan, kept for reference

- `updater.rs`: on startup + every 30 min, GET `https://api.github.com/repos/SilentGTX/OpenCode/releases/latest`. Compare `tag_name` semver to `env!("CARGO_PKG_VERSION")`.
- If newer, download the installer to `%TEMP%`, verify signature (Authenticode), fire IPC `update-downloaded` event.
- Renderer's existing `useDesktopUpdater.ts` hook shows the HeroUI toast (same UI as Electron version — only the IPC endpoint name changes).
- On user accept, Rust spawns the installer with `/SILENT` (NSIS) or `/quiet` (MSI) flags and quits the running app. Installer waits for the old `.exe` to release its lock then replaces.

**Exit criteria:** install v0.4.0 locally, publish v0.4.1 to GitHub Releases, app picks it up within 30 min and successfully updates.

## Phase 7 — Installer + code signing — ✅ scaffold shipped (2026-05-11)

**Status:** Files in place; awaits one-time user setup (install WiX, add cert
secrets, decide vendored-binaries source) before `git tag shell-vX.Y.Z`
produces a signed MSI on GitHub Releases.

- [installer/blissful.wxs](installer/blissful.wxs) — WiX 3.x product: per-machine install to `%ProgramFiles%\Blissful`, Start Menu + Desktop shortcuts, ARP entry, MajorUpgrade across versions, WebView2 evergreen bootstrapper custom action (no-op when WV2 already present).
- [installer/build.ps1](installer/build.ps1) — orchestrates `npm ci` → `npm run build` → `cargo build --release` → stage payload → `heat → candle → light` → MSI → optional sign.
- [installer/sign.ps1](installer/sign.ps1) — signtool wrapper, auto-discovers signtool in Windows SDK install dirs.
- [installer/README.md](installer/README.md) — prereqs + run instructions.
- [.github/workflows/release.yml](.github/workflows/release.yml) — on `shell-v*` tag push, installs WiX, decodes cert from `BLISSFUL_CERT_PFX_BASE64` repo secret, runs build.ps1, uploads MSI to the GitHub Release.

### Open items before first release

1. **Install WiX Toolset 3.x** on your dev machine — https://github.com/wixtoolset/wix3/releases.
2. **Add repo secrets** `BLISSFUL_CERT_PFX_BASE64` (base64 of your `.pfx`) and `BLISSFUL_CERT_PASSWORD`.
3. **Vendored binaries source** — the release workflow has a `TODO` for fetching `libmpv-2.dll`, `stremio-service.zip`, `ffmpeg-dlls/*` into `resources/` before the build. Options:
   - Private GitHub release with the binaries, downloaded via `gh release download`
   - Self-hosted CDN
   - In-CI compilation: build `libmpv` from source with `meson -Dgpl=false` for the LGPL-clean variant (matches plan.md's libmpv licensing requirement)
4. **Decide tag scheme.** Workflow currently triggers on `shell-v*` to avoid colliding with Electron's `v*`. Switch to plain `v*` during Phase 8 cutover.

### Original Phase 7 plan, kept for reference

- `installer/blissful.wxs`: WiX 3.x or 4.x definition. Bundle the shell `.exe`, `libmpv-2.dll`, `ffmpeg-dlls/*`, `stremio-service.zip`, `blissful-ui/*`, `icon.ico`. WebView2 is a Windows component — add an evergreen bootstrapper for older Windows 10 builds that lack it.
- `installer/sign.ps1`: signtool wrapper using the existing Authenticode cert.
- `release.yml` GitHub Actions: tag push → build Rust → sign `.exe` → build installer → sign installer → upload to GitHub Release with `latest.json` for the updater.
- Expected installed size: 50–80 MB (vs Electron's 150–200 MB).

**Exit criteria:** `gh release create v0.4.0-rc1 ./dist/Blissful-Setup-0.4.0.msi` works; clean Win11 VM installs and runs without missing dependencies.

## Phase 8 — Verification & swap — ⏳ checklist ready (2026-05-11)

**Status:** [TEST_MATRIX.md](TEST_MATRIX.md) lists every codec, source,
UI element, and OS-integration check that should pass before tagging
`shell-v0.4.0`. Walk the matrix on a clean Windows 11 VM + your dev box.

After all green: rename `apps/blissful-desktop/` → `apps/blissful-desktop-legacy/`,
update CLAUDE.md + README.md, switch the release workflow tag prefix to
plain `v*`, tag `shell-v0.4.0` → MSI on GitHub Releases.

### Original Phase 8 plan, kept for reference

- Test matrix: HEVC HDR Atmos remux, H.264 AAC WEB-DL, anime FLAC, BluRay TrueHD, Dolby Vision Profile 5, Real-Debrid HTTPS, addon subtitles, cold torrent, warm torrent, far seek, fullscreen toggle, library sync, progress save/restore, audio mid-playback switch, sub mid-playback switch
- Performance benchmarks against Stremio Desktop on the same content (target: within 10% on cold-start, seek, sustained CPU/RAM)
- 8-hour memory soak
- Rename `apps/blissful-desktop/` → `apps/blissful-desktop-legacy/` (keep in repo for one release)
- Update `CLAUDE.md`, `README.md`, release notes
- Tag `v0.4.0`

**Exit criteria:** acceptance criteria below all pass.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 0 transparency spike fails | Medium | Project-ending | Three fallbacks already enumerated in Phase 0. Worst case: ship with no overlay (controls in fixed bottom strip outside video region). |
| `WS_DISABLED` input forwarding edge cases (modifier keys, double-click, scroll) | Medium | Medium | Capture all relevant events in a transparent click-catcher overlay on the React side, forward via IPC. Mirror stremio-shell-ng's command set (reference, not copy). |
| WebView2 missing on user's Windows 10 | Low | Medium | Bundle the evergreen bootstrapper; installer prompts to install on first run if absent. |
| libmpv2 crate missing a niche API we need | Low | Low | Drop to `libmpv-sys` raw FFI for that one call. |
| Auto-updater self-replace race on Windows | Low | Medium | Use a 2-stage bootstrapper: shell.exe launches the installer with `/SILENT` and exits; installer waits for handle close before replace. |
| Code-signing cert is EV-only for SmartScreen | Low | Medium | Reuse current cert; if SmartScreen complains, factor cost. |
| GPU driver issues with `vo=gpu-next` | Low | Low | Default to `vo=gpu`. Add advanced setting to switch. |
| Subtitle styling parity with SimplePlayer's color/size controls | Medium | Low | mpv's `sub-color`, `sub-font-size`, `sub-back-color`, `sub-border-color` properties cover the same controls. Map the existing settings UI to set them via IPC. |
| MSI / NSIS bundling of stremio-service.zip + extraction logic | Low | Low | Same approach the current Electron build uses, just invoked from Rust on first run. |
| Stremio API session migration (cookies, auth tokens stored in Electron's `localStorage`) | Medium | Medium | Migration step: on first launch of native shell, read existing Electron localStorage via filesystem path (`%APPDATA%/Blissful/Local Storage/leveldb`), import authKey into new shell's storage. Drop after one release. |
| Performance regression vs Stremio on edge cases (e.g. very tall HEVC bitrate) | Low | Low | We use the same engine; if Stremio plays it, we play it. If we find a regression, it's a config diff we can fix. |

## Build/distribution implications

- **Bundle size**: ~50–80 MB installed (Electron: ~150–200 MB). Net: −100 MB.
- **Startup cold-launch**: native binary ~150 ms vs Electron ~800 ms.
- **Memory**: WebView2 + libmpv ~250–400 MB during 4K playback vs Electron ~800 MB.
- **Dependency**: WebView2 Runtime. Pre-installed on Windows 11. Auto-installed by our bootstrapper on Windows 10.
- **Updates**: GitHub Releases, custom Rust downloader.

## Acceptance criteria for v0.4.0

- 4K HEVC HDR torrents (e.g. Atmos remuxes with E-AC-3 or TrueHD) play at full quality with HW decode, audio working, **mpv-native subtitles selectable** via the existing menus
- Cold-start time-to-first-frame within 10% of Stremio Desktop on the same content
- Seek latency within 10% of Stremio Desktop
- Sustained 2-hour playback session with no memory creep
- Library sync, Continue Watching, progress save all work end-to-end
- Bundle size ≤ 80 MB installed
- Auto-update flow round-trips end-to-end (install v0.4.0, publish v0.4.1, app updates)
- Smoke test passes on a clean Windows 11 VM with WebView2 auto-bootstrap
- WebView2 transparency + HWND compositing remains stable across resize, fullscreen toggle, focus change, multi-monitor moves

## Out of scope for v0.4.0

- macOS port (requires `WKWebView` + Cocoa NSView for libmpv; the architecture supports it but Phase 9+)
- Linux port (WebKitGTK + libmpv on X11/Wayland; Phase 10+)
- ARM64 Windows build
- React-side subtitle rendering (mpv renders subs natively into its HWND; the SimplePlayer subtitle styling sliders map to mpv property sets, not browser-side rendering)
- Picture-in-picture (Electron had its own PiP API; the native shell would need a separate top-level window for this — deferred)
- HDR Dolby Vision Profile 7 layer unpacking (Stremio Desktop also tonemaps DV → HDR10)

## What I need from you to start

1. Confirm the 26–43 day effort and the decision to go raw Rust over Tauri.
2. Confirm Windows-only for v0.4.0.
3. Approval to create `apps/blissful-shell/` as a new sibling project, keeping `apps/blissful-desktop/` alongside until Phase 8.
4. Code-signing cert availability — same Authenticode cert as the current Electron build, or new?
5. Approval of the Phase 0a + 0b hard-gate model: if compositing doesn't work with hardcoded HTML OR the actual React build, we stop and reassess before sinking weeks into the rewrite.
6. Acknowledgment that the bundled `libmpv-2.dll` must be sourced/built under LGPL (not the current GPL `mpv-winbuild-cmake` binary) before any installer ships.

Once those are confirmed, day 1 = clone `stremio-shell-ng` for reading + `cargo new --bin apps/blissful-shell` + audit the React app's relative-URL fetch surface + draft the Phase 0a spike code.
