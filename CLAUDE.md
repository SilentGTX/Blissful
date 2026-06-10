# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Blissful** — a Stremio client whose primary target is the native Windows desktop app. Four apps + a shared package under one repo:

- `apps/blissful-shell/` — Rust native shell (Windows desktop). Hosts a same-origin local HTTP server (`/addon-proxy`, `/storage/*`, `/stremio/*`, `/subtitles.vtt`, `/opensubHash`), spawns + supervises the bundled `stremio-service`, drives playback via in-process `libmpv2`, ships the GitHub-Releases auto-updater.
- `apps/blissful-mvs/` — React UI for the desktop shell (and the legacy Tauri TV shell). Built into `dist/` and served by whichever shell hosts it. Also the 1:1 visual/behaviour reference the RN TV app is ported from.
- `apps/blissful-tv-shell/` — **Tauri v2 shell for Android TV** (the PRIOR TV approach, superseded by the React Native app below). Re-implements the `window.blissfulDesktop` bridge, the same-origin backend proxy, and a notify-only updater for Android. Its own [`SPEC.md`](apps/blissful-tv-shell/SPEC.md) + [`docs/PORT-MAP.md`](apps/blissful-tv-shell/docs/PORT-MAP.md) document it.
- `apps/blissful-tv-rn/` — **React Native (react-native-tvos) rewrite for Android TV — the CURRENT active TV effort** (branch `react-native-blissful`). A ground-up native rewrite that matches the Windows/web app 1:1. See the dedicated section below.
- `packages/blissful-core/` (`@blissful/core`) — shared TypeScript logic (stremio API, addon protocol, storage/auth, presence, friends, watch-party REST, Trakt) consumed **as source** by the RN app. **New cross-platform pure-TS logic goes here**, platform behaviour injected via `configureCore()`; the web app consumes it through thin re-export shims, the RN app through a `node_modules` junction (`scripts/link-core.js`).

The desktop shell auto-detects whether a Vite dev server is up on `:5173` and proxies UI requests to it; otherwise it serves the prebuilt `apps/blissful-mvs/dist/`.

**Scope:** the **Windows desktop client is the production app**; the **RN TV app is the current active development** (this branch). The React UI also runs in a browser context (`SimplePlayer` instead of `NativeMpvPlayer`, `isNativeShell()` gating) — those paths exist but the web deployment is not maintained here. The Tauri TV shell and the TV-awareness it added to `apps/blissful-mvs` are legacy — see the superseded section below and "TV mode (legacy, gated)" under UI architecture. When editing shared UI, keep TV/browser branches gated and don't break the desktop path.

**Branches:** `main` = desktop production (release tags are cut here; PRs default here). `android-tv` = the frozen Tauri TV effort. `react-native-blissful` (off `android-tv`) = the **active branch** — the RN TV app + `packages/blissful-core`; TV work stays here until the rewrite ships.

## Reference apps & terminology (READ FIRST)

When the user says "match/port/copy from the X app", these are the canonical sources of truth. Read their code with the Read tool and replicate behaviour/visuals exactly — never invent generic UI.

- **"Windows app" / "desktop app"** → `D:\JS\Blissful\apps\blissful-mvs` (the React UI) **and** `D:\JS\Blissful\apps\blissful-shell` (the Rust shell). This is the production reference for feature parity — playback, watch party, player UX, etc. Watch-party logic in particular lives here (`apps/blissful-mvs/src/lib/useWatchPartyMpv.ts` + `lib/watchParty.ts` + `components/WatchParty/*` + `PartyInviteListener.tsx`), NOT in OpenCode.
- **"Web version"** → `D:\JS\OpenCode\apps\blissful-mvs` (the SilentGTX/OpenCode fork, checked out locally). Check here FIRST for any `blissful-mvs` bug fix — it usually has the fix already; read it locally rather than `gh api`.

## Backend surface (blissful.budinoff.com)

The hosted backend (separate repo, **not in this workspace**) serves every client: the desktop shell reaches it through its `/storage/*` proxy, the RN app directly via `getStorageBaseUrl()` (backend root = the same host minus `/storage`). What the apps depend on:

- Under `getStorageBaseUrl()` (`https://blissful.budinoff.com/storage`): auth + the shared `/state` doc (addons, `homeRowPrefs`, player settings, library), watch-party REST (`/watch-party*`, `/party-invite/*`), presence (`/presence/heartbeat`), profiles (`/users/:id/profile`), and the WebSockets `/ws/room` (room sync) + `/ws/user` (invite push, `{t:'auth',token}` first frame).
- At the backend root: `/img` (image proxy/edge cache — allowlists metahub + tmdb only; fanart.tv is routed through images.weserv.nl client-side instead), `/imdb-rating?imdbId`, `/tmdb-find?imdbId` → `{tmdbId, mediaType}`, `/tmdb-season-info?tmdbId&season` (server-keyed TMDB stills/ratings/runtimes), `/trakt/*` (Trakt proxy), `/addon-proxy` (used by web/Tauri; the RN app fetches addons directly).

If a task needs a NEW endpoint (e.g. the planned server-keyed TMDB **backdrop** for home tiles), don't invent it — surface the requirement to the user.

## Blissful TV — React Native (apps/blissful-tv-rn) — CURRENT ACTIVE TV EFFORT

A ground-up **React Native (react-native-tvos) rewrite** of the Blissful client for **Android TV** (leanback) and the real living-room TV. Replaces the Tauri `blissful-tv-shell`. **Goal: match the Windows/web app 1:1** in visuals and behaviour — read the reference component + `index.css` and replicate exactly; no generic UI. Branch: `react-native-blissful`. Per-session state + decisions live in the memory dir (`MEMORY.md` index — `project_rn_migration_progress`, `project_tv_rn_*`).

**Feature registry — read first, keep updated:** [apps/blissful-tv-rn/docs/FEATURES.md](apps/blissful-tv-rn/docs/FEATURES.md) holds one structured record per screen/feature (files, the reference it mirrors, deliberate decisions, gotchas, how to verify). **Before** working on a feature, Grep that file for its heading and read the record (plus the *Cross-cutting: D-pad focus* record). **After** adding or changing behaviour — or discovering a new decision/gotcha — update the record in the same change. Records are current-state pointers, not changelogs; keep them ≤ ~15 lines. **Doc hierarchy:** this file = repo map + build/run + hard rules; FEATURES.md = per-feature truth; the memory dir = cross-session state.

### Stack
- **Expo SDK 56** + **react-native-tvos@0.85.3-0** + **New Architecture** (Fabric/Hermes). IMPORTANT (see `apps/blissful-tv-rn/AGENTS.md`): Expo changed a lot — read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing Expo code.
- **expo-video** for playback (the mpv analogue; bridged via hook opts `{getTime, pausedRef, seek, play, pause, setRate}`). The **emulator cannot decode most video** (no x86 decoder → frozen picture) — the **real TV is the truth** for playback/4K. 4K MUST play perfectly; never downscale the pick to work around the emulator.
- react-native-svg, expo-linear-gradient, MMKV (`kv`), @react-navigation/stack (+ `lib/navigationRef`), reanimated/gesture-handler.
- **`@blissful/core`** consumed as source — the single home of cross-platform logic.

### Build / run / test

**Start the dev environment (emulator + Metro + app)** — Windows/PowerShell; `$adb` = `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`, `$emulator` = `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe`, package = `com.blissful.tv.rn`:
1. **Boot the TV emulator** (background): `& $emulator -avd Television_1080p -no-snapshot-save -gpu host`. AVDs: `Television_1080p` (use this), `Television_1080p_old`. Wait until `& $adb shell getprop sys.boot_completed` → `1` and `& $adb devices` shows `emulator-5554  device`.
2. **Start Metro from the PROJECT ROOT** (`apps/blissful-tv-rn`) — NOT `assets/`; a wrong cwd makes Expo look for `assets/package.json` and fail. Background: `Set-Location D:\JS\Blissful\apps\blissful-tv-rn; npx expo start --port 8081`. If port 8081 is taken, `expo start` is non-interactive and silently skips the dev server — free it first: kill the PID from `Get-NetTCPConnection -LocalPort 8081 -State Listen`. Ready when `http://localhost:8081/status` returns `packager-status:running`.
3. **Point the device at Metro + launch:** `& $adb reverse tcp:8081 tcp:8081` then `& $adb shell monkey -p com.blissful.tv.rn -c android.intent.category.LAUNCHER 1`.
4. **Redbox "Cannot find native module …"** = the installed APK is stale vs the current native deps. Reinstall the dev build: `& $adb install -r android\app\build\outputs\apk\debug\app-debug.apk` (if signatures clash: `& $adb uninstall com.blissful.tv.rn` then `install` without `-r`). For a from-scratch native rebuild: `npx expo run:android`.

- **Typecheck (run before trusting changes):** `npx tsc --noEmit -p tsconfig.json` from `apps/blissful-tv-rn`.
- **Release APK:** `npm run build:release` → standalone universal `app-release.apk` (debug-keystore signed, cleartext-traffic patched) — runs on emulator + real TV. Tee the build log, don't rely on bg output.
- **Hot reload on the real TV:** debug APK + `adb reverse tcp:8081 tcp:8081` (Metro Fast Refresh on the TV). Real TV = Philips 65PUS7354 @ `192.168.1.2:5555` (adb-wifi, Android 12, armeabi-v7a); scrcpy to view.
- **Verify TV interactions by DRIVING the app:** `adb shell input keyevent <code>` then `screencap`/pull and read the screenshot after each step. Never claim a screen works from one static shot — focus/nav/avatar bugs are invisible otherwise. adb is at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`.

### Hard rules (the full focus model lives in FEATURES.md)
- **Focus:** `useTvFocusable({atRowStart, autoFocus, onPress, ...})` → `{ focused, focusProps }` spread on a `Pressable`. Native geometry handles interior D-pad moves — `nextFocus*` overrides ONLY at a row's LEFT EDGE (`atRowStart`). Fix focus bugs at the shared layer (`useTvFocusable` / `FocusTrap` / `focusBus` / `railStore` / `overlayStore` / `contentFocus`), never per-control. Modals get a `FocusTrap`; modals with TextInputs also make the background content inert.
- **Metrics:** `useMetrics()` → `m.s(px)` scales 1920-design px to dp (TV canvas ~960×540 dp @ density 2×).
- **Accent:** `colors.accent` is a SINGLE solid hex (default lavender `#95a2ff`) for focus rings, fills, progress, active icon/text. **Keep it solid** — the gradient-accent experiment was built and fully REVERTED; do not reintroduce it.
- Rail open/close, the `isTVSelectable` cascade, `longSelect` hold-OK, tvos Modal quirks: the *Cross-cutting: D-pad focus* + *NavRail* records in [FEATURES.md](apps/blissful-tv-rn/docs/FEATURES.md).

### Screens & components
`App.tsx` wires the providers (Theme > Auth > Toast > UserSocket), the stack navigator + `navigationRef`, the global `PartyInviteListener`, `usePresenceHeartbeat`, BootSplash. Everything else — Home (immersive), Detail, Player (+ subtitles, episodes drawer), Discover, Library, Search, Settings, Addons, NavRail, login (a modal — there is NO LoginScreen), watch party, friends/profiles — has a record in [FEATURES.md](apps/blissful-tv-rn/docs/FEATURES.md); read it instead of rediscovering the component tree.

### Watch Party / Trakt / presence
Ported from the **Windows app** (NOT OpenCode — it lacks `useWatchPartyMpv`). Protocol, file map, sync guards and open items: the *Watch Party* and *Friends, presence & profiles* records in FEATURES.md (+ memory note `project_tv_rn_watch_party`). Trakt is INERT until creds are filled in `lib/traktConfig.ts`.

### Conventions
- **1:1 with the windows/web app** — read the reference component + `index.css`, replicate exact visuals: Fraunces (headings) / Spectral (immersive-home display) / IBM Plex Sans (body); glass surfaces; lavender accent `#95a2ff`; brand teal `#19f7d2`; IMDb-badged cards.
- TypeScript strict, 2-space indent. No emojis in code/commits. Commit messages end with the `Co-Authored-By` line.
- Lean agent fan-out: verify findings in batch (1–2 agents); keep multi-agent workflows in the low tens of agents.

## Build & Dev Commands

### Native shell (Rust)

```powershell
# Dev: runs with the spike0a feature flag (the production entry point).
# Picks up libmpv-2.dll from resources/mpv-x64/ (stage manually for dev).
cd apps\blissful-shell
cargo run --features spike0a

# Release build (driven by installer/build.ps1, no need to run directly):
cargo build --release --features spike0a

# Unit tests (20 in-tree tests under `cargo test`):
cargo test --features spike0a --bins
```

**Note on `spike0a`:** Despite the legacy name, this feature flag gates the **production** entry point. Without it, `main.rs` prints a help message and exits with code 2 — the installed app would silently fail to launch. The installer pipeline passes it; ad-hoc release builds must too.

### React UI

```powershell
# Dev server (port 5173). Hot-reloads in the shell when it's running.
npm --prefix apps\blissful-mvs install
npm --prefix apps\blissful-mvs run dev

# Type-check (strict; what CI runs):
npx --prefix apps\blissful-mvs tsc -b

# Lint:
npm --prefix apps\blissful-mvs run lint

# Production build (outputs to apps/blissful-mvs/dist/):
npm --prefix apps\blissful-mvs run build

# Unit tests (vitest, ~9 tests today):
npm --prefix apps\blissful-mvs test
```

**Important:** `tsc --noEmit` ≠ `tsc -b`. The build-mode invocation reads `tsconfig.app.json` which has `noUnusedLocals: true`. Local validation should always use `tsc -b` (or `npm run build`) — `tsc --noEmit` will miss dead-identifier errors that fail CI.

### Installer (WiX 3.x + Burn bundle)

The canonical release path is the CI workflow (see [Releases](#releases) below). For local installer builds:

```powershell
# End-to-end pipeline: builds UI + Rust shell + WiX MSI + Burn bundle EXE.
# Output: apps/blissful-shell/installer/dist/BlissfulSetup-<ver>.exe
$env:Path = "C:\path\to\wix314;C:\Users\<you>\.cargo\bin;" + $env:Path
apps\blissful-shell\installer\build.ps1 -SkipSign
```

Prereqs (one-time):
- Rust toolchain (rustup + MSVC build tools)
- Node + npm
- WiX 3.x binaries on PATH (`heat.exe`, `candle.exe`, `light.exe`) — download from https://github.com/wixtoolset/wix3/releases
- Vendored binaries staged under `apps/blissful-shell/resources/` — `mpv-x64/libmpv-2.dll` + `mpv.lib`, `ffmpeg-dlls/*.dll`, `stremio-service.zip`, `vcruntime/*.dll`. For CI the release workflow fetches these from the `vendor-binaries-v1` GitHub release.

## Blissful Shell Architecture (apps/blissful-shell/)

**Stack:** Rust + `native-windows-gui` 1.0 (high-dpi) + `webview2` 0.1.4 + `libmpv2` 5.0 + `hyper` 1 (HTTP server) + `reqwest` (HTTP client) + `tokio` (async) + `flume` (cross-thread channels) + `sha2` (installer integrity).

The shell ships 1:1 with Stremio Desktop playback quality: in-process libmpv with HW decode, every codec, embedded subs via libass, HDR detection.

### Core files

- `src/main.rs` — entry. Sets up tracing (rotates `shell.log` → `shell.log.1` on launch), installs a Rust panic hook that logs thread/location/payload through tracing before death, locates `libmpv-2.dll`, dispatches to `run_spike` (the production path, gated on `spike0a` feature).
- `src/main_window.rs` — owns the NWG parent window. Creates libmpv + WebView2 as sibling children, wires up IPC, the system tray, the delayed-show splash, and the on-ready handoff. Owns the outgoing-event channel + NWG `Notice` that funnels async events from worker threads to the UI thread.
- `src/webview.rs` — WebView2 host. Persists user data in `%APPDATA%\Blissful\WebView2\`. Registers `add_navigation_starting` + `add_new_window_requested` to pin all navigation to `http://127.0.0.1:<bound-port>`; off-origin http/https links are cancelled and handed to the OS default browser, anything else (`javascript:`, `data:`, `file:`, custom schemes) is dropped.
- `src/ui_server.rs` — same-origin local HTTP server on `:5175` (port-scan fallback 5175..5190). Serves the React app + proxies `/addon-proxy`, `/storage/*`, `/stremio/*`. The renderer thinks it's on a single origin so CORS never trips. Forwards `x-stremio-auth` etc. to the storage upstream. `classify_addon_proxy_target()` does the host/path validation as a pure function (typed `url::Host` variants, not string matching — closes an IPv6-loopback leak caught by a unit test) and is unit-tested.
- `src/streaming_server.rs` — extracts `stremio-service.zip` to `%APPDATA%\Blissful\stremio-service\` on first run, copies bundled ffmpeg DLLs alongside, spawns `stremio-runtime.exe` and **retains the `Child` handle** for `try_wait()`-based crash detection + clean `kill()` on shutdown (replaces the historical taskkill-by-PID supervision which could kill an unrelated process if Windows recycled the PID). Writes an aggressive `server-settings.json` (cacheSize, BT caps) so 4K HEVC streams aren't throttled. Reuses an existing Stremio-Desktop streaming server if port 11470 is already bound. `copy_ffmpeg_dlls` returns a hard error if any required DLL is still missing after every source has been tried — silent failures here used to manifest as "the player just doesn't start" with nothing in the log.
- `src/player/mpv.rs` — `libmpv2` wrapper. The renderer's `NativeMpvPlayer` issues `loadfile`, `set_property`, etc. via IPC; this module dispatches them on the libmpv handle. **libmpv2 5.0.3 cannot read `MPV_FORMAT_NODE` properties** (the crate's `PropertyData::from_raw` panics with `unimplemented!()` on Node format). Workaround pattern, used for `track-list` and `chapter-list`: read the count first as `Int64`, then loop `<prop>/N/<field>` sub-properties one at a time using only `Int64`/`Double`/`String` formats. See `get_tracks()` and `get_chapters()`.
- `src/player/mpv_events.rs` — list of mpv properties the shell observes and forwards to the renderer (time-pos, pause, video-params/gamma for HDR, dwidth/dheight for 4K, `chapter` for Skip Intro detection, etc.). Add a property here when the renderer needs to react to a new mpv state — but only if the property is `Int64`/`Double`/`Flag`/`String`. Node properties can't be observed by libmpv2 5.0 (see above).
- `src/ipc/commands.rs` — typed command dispatch over JSON `postMessage`. The `mpv.command` IPC has an **allowlist** (`ALLOWED_MPV_COMMANDS`) so a compromised renderer can't spawn arbitrary processes via mpv's `run` / `subprocess` / `load-script`. Pause/play, properties, and seek go through dedicated dispatch arms that don't pass through the allowlist.
- `src/updater.rs` — polls `GITHUB_REPO = "SilentGTX/Blissful"` on a 2-second initial delay + 30-minute polling interval. Hits `/releases/latest`, finds the installer asset, **finds the `<installer>.sha256` sidecar asset** published by CI, fetches the sidecar before the installer, streams the installer to a `.tmp` file, verifies SHA-256 against the sidecar, and only promotes to the final filename + fires `update-downloaded` on match. Refuses to install on hash mismatch or when no sidecar is published. Surfaces `update-available` / `update-downloaded` / `update-download-failed` events to the renderer via the channel-based outgoing path (works reliably from a worker thread, unlike the historical thread_local sink).
- `src/tray.rs` — system tray icon + show/hide/quit menu.
- `src/state.rs` — three things:
  - `ShellState` (Player handle, main HWND, fullscreen geometry, log file, resize callback) accessed from UI-thread IPC handlers via `thread_local!`.
  - `OUTGOING_TX` (`flume::Sender<Outgoing>`) + `OUTGOING_NOTICE` (`nwg::NoticeSender`) — global channel that any thread can push events through. The UI thread drains and posts via WebView2. This replaced the historical thread_local `event_sink` that silently dropped events fired from worker threads (the bug behind the slow auto-updater toast on beta.1).
  - `WEBVIEW_READY` (`AtomicBool`) — gates the drain so events queued before WebView2 finishes initializing aren't posted into the void.
- `src/ipc/`, `src/player/`, `src/installer/` — typed protocol + libmpv glue + WiX scaffolding (see Installer below).

### Security surface

Live as of `v0.1.0-beta.4`. None of this is theoretical — each item was a real review finding.

- **CI vendor-binary integrity** — `.github/workflows/release.yml` fetches the four vendor zips (libmpv, ffmpeg, stremio-service, vcruntime) and `Get-FileHash`-verifies each against a SHA-256 stored in a mandatory repo variable (`LIBMPV_ZIP_SHA256`, `FFMPEG_ZIP_SHA256`, `STREMIO_SERVICE_ZIP_SHA256`, `VCRUNTIME_ZIP_SHA256`). A hijacked vendor URL can't ship malicious DLLs without also flipping the matching variable.
- **Auto-update integrity** — every release publishes `BlissfulSetup-<ver>.exe.sha256` alongside the installer. The updater fetches it BEFORE downloading the installer, streams the installer to a `.tmp` file, recomputes SHA-256, refuses to install on mismatch. Closes the auto-update RCE path without waiting for Authenticode signing.
- **mpv command allowlist** — `src/ipc/commands.rs::ALLOWED_MPV_COMMANDS` restricts the `mpv.command` IPC to a small set (`loadfile`, `seek`, `set`, `cycle`, sub-*/audio-*, screenshot, …). Rejects `run`, `quit`, `subprocess`, `load-script` etc. with a `command-not-allowed` IPC error. Even if the WebView2 frame gets script-injected, the renderer cannot escape to arbitrary process spawn.
- **WebView2 navigation pinning** — `webview.rs` registers `add_navigation_starting` (cancels non-`http://127.0.0.1:<bound-port>` navigation) and `add_new_window_requested` (blocks `window.open`/`target="_blank"` popups, routes legitimate http/https links to the OS default browser via `cmd /c start`). Without this an addon-supplied banner could navigate the whole WebView off-origin and inherit the same-origin trust the storage proxy relies on.
- **Shell.log rotation + panic hook** — every launch rotates `shell.log` → `shell.log.1`, so a startup crash that triggers a relaunch doesn't wipe the log explaining the crash. A `std::panic::set_hook` writes thread/location/payload through tracing before the default abort handler runs.

### Install layout pitfall (important)

WiX MSI stages all bundled files **flat** at `[ProgramFiles64Folder]Blissful\` (the install root) — there's no `resources/` subfolder in installed builds. Every path lookup in the shell must check the flat layout first, then fall back to the dev `resources/<...>` paths:

- `main.rs::locate_libmpv_dir` — checks `exe_dir/libmpv-2.dll` before `exe_dir/resources/mpv-x64/`
- `streaming_server.rs::locate_zip` — checks `exe_dir/stremio-service.zip` before `exe_dir/resources/stremio-service.zip`
- `streaming_server.rs::copy_ffmpeg_dlls` — checks `exe_dir` itself before `exe_dir/resources/ffmpeg-dlls/`
- `ui_server.rs::detect_static_root` — checks `exe_dir/blissful-ui` before `exe_dir/resources/blissful-ui`

If any of these fall through to None, the shell exits before any window can be drawn — and because `windows_subsystem = "windows"` closes stderr, **the only diagnostic is `%APPDATA%\Blissful\shell.log`** (which now rotates so the previous session's failure is still readable). Always test installed builds end-to-end, not just `cargo run`.

### Installer (installer/)

- `blissful.wxs` — MSI definition. `heat.exe` harvests `staging/` into `staging-files.wxs` at build time. WebView2 evergreen bootstrapper runs at `InstallExecuteSequence` time (no-ops if WebView2 is already present).
- `bundle.wxs` — Burn bundle wrapping the MSI into `BlissfulSetup-<ver>.exe`. Uses `WixStandardBootstrapperApplication.HyperlinkLicense` with a custom theme.
- `theme.xml` + `theme.wxl` — custom Burn theme. **ASCII-only** in `theme.wxl` — PowerShell 5.1's `Get-Content` defaults to CP1252 and mojibakes non-ASCII bytes when the file was saved as UTF-8. The build script reads/writes with `[System.IO.File]::ReadAllText/WriteAllText` + explicit UTF-8 no-BOM to avoid this, but the file content stays ASCII as defense in depth.
- `bundle-logo.png` (350x200), `installer-banner.bmp`, `installer-dialog.bmp` — branded artwork.
- `build.ps1` — end-to-end pipeline. Reads version from `Cargo.toml`, templates `@VERSION@` into `theme.wxl`, runs `npm run build` + `cargo build --release --features spike0a`, stages payload, runs `heat -> candle -> light` twice (MSI, then bundle EXE). Restores the templated `theme.wxl` in a `finally` block so the working tree stays template-shaped. **ASCII-only** — same CP1252 mojibake hazard.

### Stremio cache (gotcha)

The shell writes `server-settings.json` to `%APPDATA%\stremio\stremio-server\` with `cacheSize: 107374182400` (100 GB). The runtime fills this cache as users stream. On long-running installs this can grow to tens of GB. Safe to wipe at `%APPDATA%\stremio\stremio-server\stremio-cache\` while Blissful + Stremio are both closed.

## Blissful UI Architecture (apps/blissful-mvs/)

**Stack:** React 19 + TypeScript 5.9 (strict) + Vite 7 + HeroUI + Tailwind CSS + React Router 7 + Framer Motion + Vitest.

### Data flow

1. **Stremio Core API** (`lib/stremioApi.ts`) — auth, library sync, addon management. Endpoint `https://api.strem.io/api/*`.
2. **Addon protocol** (`lib/stremioAddon.ts`) — fetches manifest/catalog/meta/stream/subtitles from addon URLs. All requests go through `/addon-proxy` for CORS. 5-minute in-memory cache per resource type. `normalizeAddonBaseUrl()` is unit-tested.
3. **Storage server** (`lib/storageApi.ts`) — persists user prefs (player settings, home row order, theme, etc.) to a remote MongoDB-backed `blissful-storage` server. The shell proxies these calls through `/storage/*` so the renderer treats them as same-origin. The storage service is hosted separately and out of scope for this repo.
4. **Local state** — watch progress (`progressStore.ts`), stream history (`streamHistory.ts`), library bookmarks (`libraryStore.ts`) all use `localStorage` under `bliss*` key prefixes.

### Provider architecture

The deprecated `AppContext` mega-facade has been **deleted**. Global state lives in focused providers under `src/context/`, composed via `ProvidersGlue.tsx`:

- `AuthProvider` — `authKey`, `user`, `savedAccounts`, login/logout/switchAccount/removeAccount, `updateSavedAccountProfile`.
- `UIProvider` — `uiStyle` (classic vs netflix), `isDark`, gradient keys, `homeEditMode`, `query`. Theme toggle side-effects live here.
- `StorageProvider` — `storageState`, `storageHydrated`, `homeRowPrefs`, `playerSettings`, `savePlayerSettings` (also forwards streaming-server cache-size changes to the running service), `userProfile`, `updateUserProfile`, `persistStorageState`.
- `AddonsProvider` — `addons`, `addonsLoading`, `addonsError`, `installAddon`, `uninstallAddon`.
- `ModalsProvider` — every modal slot (account, login + forced-error + prefill-email, profile prompt, who's-watching, add-addon + URL draft, home-settings, iOS play prompt, resume modal item, stream-unavailable item, pending-continue overlay) with `open*` / `close*` callbacks. `openLoginWith({forcedError, prefillEmail})` and `openAddAddonWith(url)` exist alongside the no-arg openers so HeroUI `onPress` handlers can pass them straight without the press event leaking through as `forcedError`.
- `HomeCatalogProvider` — Cinemeta movies/series catalog (fetched once on mount via `useHomeCatalog`), `homeRowOptions`, `saveHomeRowPrefs`.
- `ContinueWatchingProvider` — list + actions, the resume-modal flow, the black-veil "pending navigation" overlay timing.

`AppShell.tsx` is now ~815 lines, mostly layout JSX. Side-effect hooks pulled out into `layout/app-shell/hooks/`: `useGradientBackdrop`, `useTorrentioCloneSync`, `useHomeCatalog`, plus the pre-existing `useContinueWatching` / `useContinueWatchingActions` / `useSearchMenu`.

### Cancellation idiom

Async effects use `let cancelled = false` + cleanup `() => { cancelled = true }` to prevent state updates after unmount. Standard across `lib/*` consumers and feature hooks.

### Stream routing

Stream clicks build a player URL from `deepLinks.ts` and navigate to `/player?url={encoded}`. Local stremio-server URLs (`http://127.0.0.1:11470/...`) are passed through; the shell's UI server allow-lists them at `/addon-proxy` (only the bundled stremio-service on port 11470 with paths `/local-addon/*`, `/subtitles.vtt`, `/opensubHash`).

### Native vs SimplePlayer

The player page renders `NativeMpvPlayer` inside the desktop shell (detected via `isNativeShell()` in `lib/desktop.ts`). A `SimplePlayer` (`<video>` element) fallback exists for browser context but is not the primary focus.

### Two UI modes

`classic` (sidebar + glass) and `netflix` (top bar + hero). Toggled by `uiStyle` in `UIProvider`.

### TV mode (legacy, gated — added for the Tauri TV shell)

Still in the shared UI, all additive and **gated so desktop/browser builds are unaffected**. `lib/platform.ts` is the contract: `isTauri()`, `isAndroidTv()`, `forceTv()` (the **`?tv=1`** browser escape hatch, persisted to `localStorage['bliss:forceTv']`), and `isTvMode()` — the single switch for the TV interaction layer (test in a normal browser at `http://localhost:5173/?tv=1`). `src/spatial/` is the D-pad layer on `@noriginmedia/norigin-spatial-navigation` — Norigin sets `data-focused` (it does NOT call native `focus()`), so focus-ring CSS keys off `[data-focused="true"]`; the TV CSS lives under `html[data-tv]` in `index.css`. `lib/tauriBridge.ts` installs `window.blissfulDesktop` over Tauri invoke/listen; `lib/proxyBase.ts` exports `PROXY_BASE`/`proxyUrl()`. Shared pages carry `isTvMode()`/`isAndroidTv()` branches. When editing shared UI, keep these branches gated.

### Trakt integration (`lib/trakt*`)

Usable on any build, **INERT until credentials are filled** in `lib/traktConfig.ts` — `isTraktConfigured()` gates every code path, so empty creds mean no network calls and no throws. Pieces: `traktApi.ts` (TV-friendly device-code OAuth, token storage/refresh, scrobble start/pause/stop, watchlist), `useTraktScrobble.ts` (player progress → Trakt), `watchedBitfield.ts` (+ its vitest file), `components/SettingsTraktPanel.tsx`. On the Tauri Android build it routes through `${PROXY_BASE}/trakt` (needs the backend `/trakt` route).

### Desktop bridge (`lib/desktop.ts`)

`window.blissfulDesktop` is injected by the Rust shell's WebView2 init script as a JS shim defined in `apps/blissful-shell/src/ipc/mod.rs::JS_SHIM`. The renderer talks to the shell via:

- **Generic mpv:** `desktop.mpv.command(name, ...args)` (subject to the allowlist), `desktop.mpv.setProperty(name, value)`, `desktop.mpv.getTracks()`, `desktop.mpv.getChapters()`.
- **Dedicated player ops:** `desktop.play()`, `desktop.pause()`, `desktop.seek(seconds, mode)` (the shell's seek IPC appends `+exact` so absolute seeks land on the precise frame, not the prior keyframe).
- **Streaming server:** `desktop.ensureStreamingServer()` — guarantees `127.0.0.1:11470` is bound before playback.
- **Updater:** `desktop.getUpdateStatus()`, `desktop.downloadUpdate()`, `desktop.installUpdate()`. Renderer-side hook is `hooks/useDesktopUpdater.ts`.
- **Lifecycle:** `desktop.getAppVersion()`, `desktop.toggleFullscreen()`, `desktop.isFullscreen()`, `desktop.onMpvEvent(cb)` (`FileLoaded`, `Seek`, `EndFile`, `Shutdown` etc.), `desktop.onMpvPropChange(cb)`.

Use `isNativeShell()` to gate desktop-only UI (the `NativeMpvPlayer`, the version badge, the chapter-skip button, etc.). The bridge is absent in the browser fallback.

### NativeMpvPlayer decomposition

`src/components/NativeMpvPlayer.tsx` is still large (~2,400 lines — the player has irreducible feature richness: subtitle styling pipeline, mpv event state machine, controls auto-hide, addon-fetched subs, resume modal, …) but the visible JSX is now extracted into `src/components/NativeMpvPlayer/`:

- `playbackClock.ts` — module-level external store carrying mpv's `time-pos` at full ~10 Hz tick rate. The component-level `timePos` state is throttled to ~5 Hz so the heavy render tree isn't re-rendered on every mpv tick; the scrub bar's slider subscribes to the live store directly via `useSyncExternalStore` so the slider stays smooth.
- `ScrubBar.tsx` — memoised, reads the playback clock independently of the parent.
- `PlayerControlsBar.tsx` — memoised play/volume/audio-menu/subs-menu/fullscreen strip. Hosts `ScrubBar`. Re-renders only on pause/volume/track-menu changes.
- `AudioMenuPopover.tsx` — memoised audio-track picker.
- `SubtitleMenuPopover.tsx` — memoised 3-column subtitle picker (Languages / Variants / Settings).
- `PlayerHdrBadges.tsx` — memoised HDR / 4K / RD pill cluster top-right.
- `SkipChapterButton.tsx` — memoised floating Skip Intro / Skip Recap / Skip Credits button (see below).
- `useChapterSkip.ts` — chapter-list cache + classification + skip-action callback.
- `subtitleHelpers.ts` — `subtitleLangLabel()` shared between the popover and the parent.

### Skip Intro / Recap / Credits

Driven by **mpv chapter markers**, no addon dependency.

1. `Player::get_chapters()` reads `chapter-list/count` then loops `chapter-list/N/{time,title}` sub-properties (the libmpv2 5.0 Node-format workaround applies — `chapter-list` cannot be read as a whole).
2. `("chapter", Int64)` is in the observed-properties list, so the renderer hears every chapter-index change.
3. `useChapterSkip(duration)` caches the chapter list once on `FileLoaded`, classifies the current chapter's title against three regexes (intro, recap, outro — defaults derived from Jellyfin's intro-skipper plugin plus a scene survey of anime BD / Western TV WEB-DL conventions: `OP`/`Opening`/`ED`/`Ending`/`Preview` for anime, `Cold Open`/`Recap`/`Previously On`/`Main Titles` for Western TV, `Vorspann`/`Abspann` for German anime BDs). Per-chapter dismiss memoisation prevents a stray prop-change during the skip seek from re-showing the button.
4. `<SkipChapterButton>` floats bottom-right above the controls strip. Click → `desktop.seek(chapters[idx+1].time, 'absolute')`.

Coverage from the research: anime BD ~70-85%, anime simulcasts ~10-25%, Western TV WEB-DL ~20-40%, films negligible. For files without chapter markers the next-step v2 fallback is the [AniSkip v2 API](https://api.aniskip.com/v2) (public, no auth) keyed by MAL ID — the hook is shaped to accept a second source.

### Key files

- `src/components/AppShell.tsx` — root layout + JSX, hook composition. State now lives in providers above.
- `src/components/NativeMpvPlayer.tsx` + `NativeMpvPlayer/` — libmpv-backed player.
- `src/components/SimplePlayer.tsx` — `<video>`-element player fallback for non-native (browser) context.
- `src/pages/{HomePage,DiscoverPage,DetailPage,PlayerPage}.tsx` — main routes.
- `src/lib/{stremioApi,stremioAddon,streamHistory,storageApi,desktop,progress,playerSettings}.ts`.

### Testing

- **Rust:** `#[cfg(test)] mod tests` inside the relevant source files. Currently covers `updater::pick_update`, `updater::parse_sidecar`, and `ui_server::classify_addon_proxy_target`. Run with `cargo test --features spike0a --bins`.
- **TypeScript:** `vitest` runs `*.test.ts` files (`lib/stremioAddon.normalizeAddonBaseUrl`, `watchedBitfield`). Run with `npm test`.
- **React Native TV app:** no unit tests — verification is `npx tsc --noEmit` + driving the app (keyevent + screenshot per step; see the RN section's build/run and the *Verify* lines in FEATURES.md).

When you add a behaviour that could be a regression magnet (security validation, semver comparison, URL normalisation), add a test next to the code rather than relying on manual end-to-end checks.

## Blissful TV (Android, Tauri) — `apps/blissful-tv-shell/` — SUPERSEDED

The prior Android TV approach: a Tauri v2 shell (frozen **`android-tv`** branch) running the shared `apps/blissful-mvs` UI on TV, with a Rust port of the desktop proxy on `127.0.0.1:11471` and a notify-only updater. **Superseded by the React Native app (`apps/blissful-tv-rn`) — do not extend it.** If you ever need it, its own docs are the source of truth: [`SPEC.md`](apps/blissful-tv-shell/SPEC.md), [`docs/PORT-MAP.md`](apps/blissful-tv-shell/docs/PORT-MAP.md), `docs/BUILD-RUNBOOK.md`. The TV-awareness and Trakt code it introduced into the shared UI remain there — see "TV mode (legacy, gated)" and "Trakt integration" in the UI architecture section above.

## Releases

The canonical release pipeline is [.github/workflows/release.yml](.github/workflows/release.yml):

1. Bump `version` in `apps/blissful-shell/Cargo.toml`.
2. Commit, tag `v<version>`, push tag (`git push origin v<version>`).
3. CI runs on `windows-latest`: fetches and **SHA-256-verifies** vendored binaries from the `vendor-binaries-v1` GitHub release, builds the UI, builds the Rust shell, runs the WiX/Burn pipeline, computes a `<installer>.sha256` sidecar against the built installer, publishes a regular (non-prerelease) GitHub release with **both** the installer EXE and the sidecar attached, marks it `make_latest: true` so the in-app updater sees it on the next poll.
4. After publish, the workflow's **Prune old releases** step deletes every Blissful release that isn't (a) the new Latest, (b) the immediately-prior version, or (c) the manually-pinned Stable release (read from the `STABLE_RELEASE_TAG` repo variable). `vendor-binaries-*` releases are filtered out and always preserved.

The workflow runs unsigned by default; the SignPath signing step is wired but commented out. To enable: configure `SIGNPATH_API_TOKEN` (secret) and `SIGNPATH_ORGANIZATION_ID` (variable) under repo settings, then uncomment the "Submit to SignPath" block. When signing is enabled the `.sha256` sidecar must be recomputed against the signed EXE (signing rewrites the file).

### Release retention policy

- **Latest** + **Latest-1** auto-kept by the workflow's prune step.
- **Stable** = whatever the `STABLE_RELEASE_TAG` repo variable points at. Currently `v0.1.0-beta.3`. The release's title is suffixed `— Stable` in the GitHub UI for visual clarity (the tag itself stays plain).
- Empty `STABLE_RELEASE_TAG` = no pin (rule degrades to just "latest 2").
- Moving the Stable pin: change the repo variable, then re-title the new pin's release with ` — Stable` and re-title the old one back to bare `<tag>`.

### Vendored binaries

Runtime DLLs (`libmpv-2.dll`, ffmpeg, MSVC runtime) and `stremio-service.zip` are not committed to this repo. They live as release assets under the `vendor-binaries-v1` prerelease on this repo. The release workflow downloads them at build time via **eight** repository variables:

- `LIBMPV_ZIP_URL` + `LIBMPV_ZIP_SHA256` (currently the LGPL build `libmpv-lgpl.zip`, ~39 MB compressed)
- `FFMPEG_ZIP_URL` + `FFMPEG_ZIP_SHA256`
- `STREMIO_SERVICE_ZIP_URL` + `STREMIO_SERVICE_ZIP_SHA256`
- `VCRUNTIME_ZIP_URL` + `VCRUNTIME_ZIP_SHA256`

The `*_SHA256` vars are mandatory; the workflow refuses to build without them. Rotate by recomputing on a trusted machine via `Get-FileHash <zip> -Algorithm SHA256` and pasting into the repo variables UI.

Bump to `vendor-binaries-v2` etc. when one of those bundled components changes structurally; for additive changes (new variant of an existing component, e.g. the LGPL libmpv alongside the original GPL libmpv) just add a new asset to v1 and point the relevant URL variable at it.

### libmpv build swap (LGPL ↔ GPL)

The current libmpv is the [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) `mpv-dev-lgpl-x86_64-*.7z` build, repacked as `libmpv-lgpl.zip` on `vendor-binaries-v1`. zhongfly's archive only ships the MinGW-style `libmpv.dll.a` import library; the project links against MSVC-style `mpv.lib`, so the repack regenerates `mpv.lib` from the DLL's exports:

```powershell
# 1. extract the 7z (needs 7zr.exe or 7-Zip)
7zr.exe x mpv-dev-lgpl-x86_64-*.7z -oextracted -y

# 2. dump exports → custom .def
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133\bin\Hostx64\x64\dumpbin.exe' /exports extracted\libmpv-2.dll > exports.txt
$exports = Get-Content exports.txt | Select-String '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(mpv_\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }
@('LIBRARY libmpv-2', 'EXPORTS', $exports) | Out-File mpv.def -Encoding ascii

# 3. lib.exe builds the import library
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133\bin\Hostx64\x64\lib.exe' /def:mpv.def /machine:x64 /out:mpv.lib /name:libmpv-2.dll

# 4. zip libmpv-2.dll + mpv.lib together → upload to vendor-binaries-v1
```

To swap back to a GPL build (or test a different version): upload as a different filename under `vendor-binaries-v1`, point `LIBMPV_ZIP_URL` + `LIBMPV_ZIP_SHA256` at it, tag a release. The auto-update path picks up the new build for existing users. The `libmpv.zip` (original shinchiro GPL build) is still on `vendor-binaries-v1` as a rollback option.

## Code signing

Currently **unsigned** — releases ship without an Authenticode signature, so users see SmartScreen on first install and must click "More info → Run anyway". SignPath Foundation OSS sponsorship has been applied for; approval typically takes 1–4 weeks. Once approved, the workflow's commented-out SignPath step is enabled and subsequent releases are signed transparently in CI.

The auto-updater's SHA-256 sidecar check is the integrity guarantee in the meantime — every release's installer is verified against a hash published by the same CI job that built it.

## Licensing

- The source code in this repo is **MIT** (see [LICENSE](LICENSE)).
- The shipped installer EXE bundles an **LGPLv2.1+** `libmpv-2.dll` (currently the [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) `mpv-dev-lgpl-x86_64` build, uploaded as `libmpv-lgpl.zip` on the `vendor-binaries-v1` release). The combined installer is therefore **LGPL-governed on redistribution** — libmpv source must be available (zhongfly's repo satisfies this) and users must be able to swap in their own build. Blissful loads `libmpv-2.dll` dynamically from `%ProgramFiles%\Blissful\`, so the swap is trivial. The root [README](README.md) license section documents the situation in detail.
- Source code can be forked and modified under MIT; the installer's LGPL obligations only apply when *redistributing* the prebuilt installer.
- Historical note: pre–`libmpv-lgpl.zip` (≤ v0.1.0-beta.2) the project bundled the GPL shinchiro build, which made the combined installer GPL-governed and the bundled DLL ~118 MB. The LGPL build is ~96 MB (~20 MB on-disk savings, ~6 MB compressed savings).

## Code Style

- **TypeScript:** `strict: true`, 2-space indent, ES6 imports, `catch (err: unknown)` then narrow.
- **Rust:** standard `rustfmt`, `cargo clippy` clean. Tracing for logs (no `println!`).
- **Naming:** camelCase vars/functions, PascalCase classes/React components, UPPER_SNAKE_CASE constants.
- **Blissful styling:** glass effect via `solid-surface bg-white/6 backdrop-blur`, large corners `rounded-[28px]`, brand color `--bliss-teal: #19f7d2`, fonts Fraunces (headings) + IBM Plex Sans (body).
- **No emojis in code or commit messages** unless the user asks for them.

## Key references

- [.github/workflows/release.yml](.github/workflows/release.yml) — CI release pipeline (build → SHA-verify vendor → WiX/Burn → SHA sidecar → publish + Latest → prune).
- [apps/blissful-mvs/AGENTS.md](apps/blissful-mvs/AGENTS.md) — UI-specific patterns and conventions (incl. the TV-awareness gating contract).
- [apps/blissful-tv-rn/docs/FEATURES.md](apps/blissful-tv-rn/docs/FEATURES.md) — the RN TV app's feature registry (read before touching a feature; update after).
- [apps/blissful-tv-shell/SPEC.md](apps/blissful-tv-shell/SPEC.md) + [docs/PORT-MAP.md](apps/blissful-tv-shell/docs/PORT-MAP.md) — the SUPERSEDED Tauri TV port's spec + architecture docs (frozen `android-tv` branch).
- [LICENSE](LICENSE) + root README license section — licensing details.
- [intro-skipper PluginConfiguration.cs](https://github.com/intro-skipper/intro-skipper/blob/main/IntroSkipper/Configuration/PluginConfiguration.cs) — upstream reference for the chapter-title regex catalogue used in `useChapterSkip.ts`.
- [AniSkip v2 API docs](https://api.aniskip.com/api-docs) — the v2 fallback data source for files without chapter markers (anime).
- Per-session feedback / project state lives under `C:\Users\origi\.claude\projects\d--JS-Blissful\memory\` — including the release retention policy and the "consult stremio-shell-ng / stremio-core for prior art" reminder.
