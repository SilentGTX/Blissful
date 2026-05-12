# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Blissful** — a native Windows Stremio client. Two apps:

- `apps/blissful-shell/` — Rust native shell. Hosts a same-origin local HTTP server (`/addon-proxy`, `/storage/*`, `/stremio/*`, `/subtitles.vtt`, `/opensubHash`), spawns + supervises the bundled `stremio-service`, drives playback via in-process `libmpv2`, ships the GitHub-Releases auto-updater.
- `apps/blissful-mvs/` — React UI. Built into `dist/` and served by the shell. Also runs in a browser against `https://blissful.budinoff.com` (the same app — see "Mirror relationship" below).

The shell auto-detects whether a Vite dev server is up on `:5173` and proxies UI requests to it; otherwise it serves the prebuilt `apps/blissful-mvs/dist/`.

## Mirror relationship

This repo is a mirror of the same two apps in `SilentGTX/OpenCode` (private). The two repos diverge on intent:

- **This repo (`SilentGTX/Blissful`, public)** — source of truth for the **Windows desktop app**. Releases live on this repo's GitHub Releases tab; the in-app updater polls here.
- **OpenCode monorepo (private)** — source of truth for the **deployed web app at `blissful.budinoff.com`**. Has Docker compose, Mac-mini infra, MongoDB-backed storage server, Traefik routing, etc. Receives the same `apps/blissful-mvs/` source.

`apps/blissful-mvs/` content should stay byte-identical between the two repos (modulo line endings). When you change UI code, mirror the change to the other repo. There's no automation for this yet — manual `cp` is fine.

## Build & Dev Commands

### Native shell (Rust)

```powershell
# Dev: runs with the spike0a feature flag (the production entry point).
# Picks up libmpv-2.dll from resources/mpv-x64/ — see PREREQUISITES.md.
cd apps\blissful-shell
cargo run --features spike0a

# Release build (used by installer/build.ps1, no need to run directly):
cargo build --release --features spike0a
```

**Note on `spike0a`:** Despite the legacy name, this feature flag gates the **production** entry point. Without it, `main.rs` prints a help message and exits with code 2 — the installed app would silently fail to launch. The installer pipeline passes it; ad-hoc release builds must too.

### React UI

```powershell
# Dev server (port 5173). Hot-reloads in the shell when it's running.
npm --prefix apps\blissful-mvs install
npm --prefix apps\blissful-mvs run dev

# Type-check / lint:
npx --prefix apps\blissful-mvs tsc --noEmit
npm --prefix apps\blissful-mvs run lint

# Production build (outputs to apps/blissful-mvs/dist/):
npm --prefix apps\blissful-mvs run build
```

### Installer (WiX 3.x + Burn bundle)

```powershell
# End-to-end pipeline: builds UI + Rust shell + MSI + bundle EXE.
# Output: apps/blissful-shell/installer/dist/BlissfulSetup-<ver>.exe
$env:Path = "C:\path\to\wix314;C:\Users\<you>\.cargo\bin;" + $env:Path
apps\blissful-shell\installer\build.ps1 -SkipSign
```

Prereqs (one-time):
- Rust toolchain (rustup + MSVC build tools)
- Node + npm
- WiX 3.x binaries on PATH (`heat.exe`, `candle.exe`, `light.exe`) — download from https://github.com/wixtoolset/wix3/releases
- Vendored binaries staged under `resources/` (see PREREQUISITES.md)

## Blissful Shell Architecture (apps/blissful-shell/)

**Stack:** Rust + `native-windows-gui` 1.0 (high-dpi) + `webview2` 0.1.4 + `libmpv2` 5.0 + `hyper` 1 (HTTP server) + `reqwest` (HTTP client) + `tokio` (async).

The shell ships 1:1 with Stremio Desktop playback quality: in-process libmpv with HW decode, every codec, embedded subs via libass, HDR detection.

### Core files

- `src/main.rs` — entry. Sets up tracing, locates `libmpv-2.dll`, dispatches to `run_spike` (the production path, gated on `spike0a` feature).
- `src/main_window.rs` — owns the NWG parent window. Creates libmpv + WebView2 as sibling children, wires up IPC, the system tray, the delayed-show splash, and the on-ready handoff.
- `src/webview.rs` — WebView2 host. Persists user data in `%APPDATA%\Blissful\WebView2\`.
- `src/ui_server.rs` — same-origin local HTTP server on `:5175` (port-scan fallback 5175..5190). Serves the React app + proxies `/addon-proxy`, `/storage/*`, `/stremio/*`. The renderer thinks it's on a single origin so CORS never trips. Forwards `x-stremio-auth` etc. to the storage upstream.
- `src/streaming_server.rs` — extracts `stremio-service.zip` to `%APPDATA%\Blissful\stremio-service\` on first run, copies bundled ffmpeg DLLs alongside, spawns `stremio-runtime.exe` detached, supervises by PID. Writes an aggressive `server-settings.json` (cacheSize, BT caps) so 4K HEVC streams aren't throttled. Reuses an existing Stremio-Desktop streaming server if port 11470 is already bound.
- `src/player/mpv.rs` — `libmpv2` wrapper. The renderer's `NativeMpvPlayer` issues `loadfile`, `set_property`, etc. via IPC; this module dispatches them on the libmpv handle.
- `src/ipc/` — typed protocol between WebView2 renderer and shell main. JSON over `postMessage` + `addScriptToExecuteOnDocumentCreated`. Responses correlated by UUID.
- `src/updater.rs` — polls `GITHUB_REPO = "SilentGTX/Blissful"` every 30 min, surfaces "update available" / "update downloaded" events to the renderer over IPC, spawns the new installer on user confirmation, quits.
- `src/tray.rs` — system tray icon + show/hide/quit menu.
- `src/state.rs` — `ShellState` (main HWND, Player handle) accessed from IPC handlers via `thread_local!`.

### Install layout pitfall (important)

WiX MSI stages all bundled files **flat** at `[ProgramFiles64Folder]Blissful\` (the install root) — there's no `resources/` subfolder in installed builds. Every path lookup in the shell must check the flat layout first, then fall back to the dev `resources/<...>` paths:

- `main.rs::locate_libmpv_dir` — checks `exe_dir/libmpv-2.dll` before `exe_dir/resources/mpv-x64/`
- `streaming_server.rs::locate_zip` — checks `exe_dir/stremio-service.zip` before `exe_dir/resources/stremio-service.zip`
- `streaming_server.rs::copy_ffmpeg_dlls` — checks `exe_dir` itself before `exe_dir/resources/ffmpeg-dlls/`
- `ui_server.rs::detect_static_root` — checks `exe_dir/blissful-ui` before `exe_dir/resources/blissful-ui`

If any of these fall through to None, the shell exits before any window can be drawn — and because `windows_subsystem = "windows"` closes stderr, there's no log to debug from. Always test installed builds end-to-end, not just `cargo run`.

### Installer (installer/)

- `blissful.wxs` — MSI definition. `heat.exe` harvests `staging/` into `staging-files.wxs` at build time. WebView2 evergreen bootstrapper runs at `InstallExecuteSequence` time (no-ops if WebView2 is already present).
- `bundle.wxs` — Burn bundle wrapping the MSI into `BlissfulSetup-<ver>.exe`. Uses `WixStandardBootstrapperApplication.HyperlinkLicense` with a custom theme.
- `theme.xml` + `theme.wxl` — custom Burn theme. **ASCII-only** in `theme.wxl` — PowerShell 5.1's `Get-Content` defaults to CP1252 and mojibakes non-ASCII bytes when the file was saved as UTF-8. The build script reads/writes with `[System.IO.File]::ReadAllText/WriteAllText` + explicit UTF-8 no-BOM to avoid this, but the file content stays ASCII as defense in depth.
- `bundle-logo.png` (350x200), `installer-banner.bmp`, `installer-dialog.bmp` — branded artwork.
- `build.ps1` — end-to-end pipeline. Reads version from `Cargo.toml`, templates `@VERSION@` into `theme.wxl`, runs `npm run build` + `cargo build --release --features spike0a`, stages payload, runs `heat -> candle -> light` twice (MSI, then bundle EXE). Restores the templated `theme.wxl` in a `finally` block so the working tree stays template-shaped. **ASCII-only** — same CP1252 mojibake hazard.

### Release process

1. Bump `version` in `apps/blissful-shell/Cargo.toml`.
2. Run `apps\blissful-shell\installer\build.ps1 -SkipSign` from a shell with WiX + cargo on PATH.
3. Create a GitHub Release with tag `v<version>` on `SilentGTX/Blissful`.
4. Upload `apps/blissful-shell/installer/dist/BlissfulSetup-<version>.exe` to the release.
5. The auto-updater (`src/updater.rs`) detects the new release within 30 min and prompts users to install.

### Stremio cache (gotcha)

The shell writes `server-settings.json` to `%APPDATA%\stremio\stremio-server\` with `cacheSize: 107374182400` (100 GB). The runtime fills this cache as users stream. On long-running installs this can grow to tens of GB. Safe to wipe at `%APPDATA%\stremio\stremio-server\stremio-cache\` while Blissful + Stremio are both closed.

## Blissful UI Architecture (apps/blissful-mvs/)

**Stack:** React 19 + TypeScript 5.9 (strict) + Vite 7 + HeroUI + Tailwind CSS + React Router 7 + Framer Motion.

### Data flow

1. **Stremio Core API** (`lib/stremioApi.ts`) — auth, library sync, addon management. Endpoint `https://api.strem.io/api/*`.
2. **Addon protocol** (`lib/stremioAddon.ts`) — fetches manifest/catalog/meta/stream/subtitles from addon URLs. All requests go through `/addon-proxy` for CORS. 5-minute in-memory cache per resource type.
3. **Storage server** (`lib/storageApi.ts`) — persists user prefs (player settings, home row order, theme, etc.) to MongoDB-backed `blissful-storage`.
4. **Local state** — watch progress (`progressStore.ts`), stream history (`streamHistory.ts`), library bookmarks (`libraryStore.ts`) all use `localStorage` under `bliss*` key prefixes.

### Key patterns

- **AppShell** (`components/AppShell.tsx`) is the root layout. Owns all global state and provides it via `AppContext`. Intentionally a single large component — state lives here so modals/features have cross-cutting access.
- **Feature modules** live in `features/{home,detail,discover}/` with their own `components/`, `hooks/`, and `utils.ts`.
- **Cancellation:** async effects use `let cancelled = false` + cleanup `() => { cancelled = true }` to prevent state updates after unmount.
- **Stream routing:** stream clicks build a player URL from `deepLinks.ts` and navigate to `/player?url={encoded}`. Local stremio-server URLs (`http://127.0.0.1:11470/...`) are passed through; the shell's UI server allow-lists them at `/addon-proxy`.
- **Native vs SimplePlayer:** the player page renders `NativeMpvPlayer` inside the desktop shell (detected via `isNativeShell()` in `lib/desktop.ts`) and `SimplePlayer` (`<video>` element) on the web.
- **Two UI modes:** `classic` (sidebar + glass) and `netflix` (top bar + hero). Toggled by `uiStyle` in AppContext.

### Desktop bridge (`lib/desktop.ts`)

`window.blissfulDesktop` is injected by the Rust shell's WebView2 init script. The renderer talks to libmpv, the streaming server, the updater, and per-process settings via promises:

- `desktop.mpv.loadfile(url)`, `desktop.mpv.set_property(name, value)`, `desktop.mpv.observe_property(name)` etc.
- `desktop.streamingServer.ensure_started()` — guarantees `127.0.0.1:11470` is bound before playback.
- `desktop.updater.check()`, `desktop.updater.download()`, `desktop.updater.install_and_quit()`.
- `desktop.getAppVersion()` — surfaces `CARGO_PKG_VERSION` for the sidebar header.

Use `isNativeShell()` to gate desktop-only UI (the `NativeMpvPlayer`, the version badge, etc.). The bridge is absent in the browser.

### Key files

- `src/components/AppShell.tsx` — root layout, global state, nav, Continue Watching, iOS drawer.
- `src/components/NativeMpvPlayer.tsx` — libmpv-backed player. Issues `loadfile` + property observers via the desktop bridge. Owns the on-screen controls, subtitle picker, audio picker, HDR/RD badges, resume modal, "stream unavailable" modal.
- `src/components/SimplePlayer.tsx` — `<video>`-element player for the web build.
- `src/components/SideNav/DesktopNav.tsx` + `SideNav/GetWindowsAppCard.tsx` — sidebar. The download CTA points at this repo's GitHub Releases page and is hidden inside the native shell.
- `src/pages/{HomePage,DiscoverPage,DetailPage,PlayerPage}.tsx` — main routes.
- `src/lib/{stremioApi,stremioAddon,streamHistory,storageApi,desktop,progress,playerSettings}.ts`.

## Code Style

- **TypeScript:** `strict: true`, 2-space indent, ES6 imports, `catch (err: unknown)` then narrow.
- **Rust:** standard `rustfmt`, `cargo clippy` clean. Tracing for logs (no `println!`).
- **Naming:** camelCase vars/functions, PascalCase classes/React components, UPPER_SNAKE_CASE constants.
- **Blissful styling:** glass effect via `solid-surface bg-white/6 backdrop-blur`, large corners `rounded-[28px]`, brand color `--bliss-teal: #19f7d2`, fonts Fraunces (headings) + IBM Plex Sans (body).
- **No emojis in code or commit messages** unless the user asks for them.

## Key references

- `apps/blissful-shell/plan.md` — phase-by-phase architecture history (0a/0b spike -> phase 7 installer).
- `apps/blissful-shell/PREREQUISITES.md` — how to source the vendored binaries (`libmpv-2.dll`, ffmpeg DLLs, `stremio-service.zip`, vcruntime DLLs) on a fresh dev machine.
- `apps/blissful-shell/TEST_MATRIX.md` — manual QA checklist before cutting a release.
- `apps/blissful-mvs/AGENTS.md` — UI-specific patterns.
