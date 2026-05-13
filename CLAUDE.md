# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Blissful** — a native Windows Stremio client. Two apps under one repo:

- `apps/blissful-shell/` — Rust native shell. Hosts a same-origin local HTTP server (`/addon-proxy`, `/storage/*`, `/stremio/*`, `/subtitles.vtt`, `/opensubHash`), spawns + supervises the bundled `stremio-service`, drives playback via in-process `libmpv2`, ships the GitHub-Releases auto-updater.
- `apps/blissful-mvs/` — React UI. Built into `dist/` and served by the shell.

The shell auto-detects whether a Vite dev server is up on `:5173` and proxies UI requests to it; otherwise it serves the prebuilt `apps/blissful-mvs/dist/`.

**Scope of this repo:** Windows desktop client only. The React UI also runs in a browser context (`SimplePlayer` instead of `NativeMpvPlayer`, `isNativeShell()` gating, etc.) — those code paths exist but the web deployment is not maintained from this repo and is not the focus of work here.

## Build & Dev Commands

### Native shell (Rust)

```powershell
# Dev: runs with the spike0a feature flag (the production entry point).
# Picks up libmpv-2.dll from resources/mpv-x64/ (stage manually for dev).
cd apps\blissful-shell
cargo run --features spike0a

# Release build (driven by installer/build.ps1, no need to run directly):
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

**Stack:** Rust + `native-windows-gui` 1.0 (high-dpi) + `webview2` 0.1.4 + `libmpv2` 5.0 + `hyper` 1 (HTTP server) + `reqwest` (HTTP client) + `tokio` (async).

The shell ships 1:1 with Stremio Desktop playback quality: in-process libmpv with HW decode, every codec, embedded subs via libass, HDR detection.

### Core files

- `src/main.rs` — entry. Sets up tracing, locates `libmpv-2.dll`, dispatches to `run_spike` (the production path, gated on `spike0a` feature).
- `src/main_window.rs` — owns the NWG parent window. Creates libmpv + WebView2 as sibling children, wires up IPC, the system tray, the delayed-show splash, and the on-ready handoff.
- `src/webview.rs` — WebView2 host. Persists user data in `%APPDATA%\Blissful\WebView2\`.
- `src/ui_server.rs` — same-origin local HTTP server on `:5175` (port-scan fallback 5175..5190). Serves the React app + proxies `/addon-proxy`, `/storage/*`, `/stremio/*`. The renderer thinks it's on a single origin so CORS never trips. Forwards `x-stremio-auth` etc. to the storage upstream.
- `src/streaming_server.rs` — extracts `stremio-service.zip` to `%APPDATA%\Blissful\stremio-service\` on first run, copies bundled ffmpeg DLLs alongside, spawns `stremio-runtime.exe` detached, supervises by PID. Writes an aggressive `server-settings.json` (cacheSize, BT caps) so 4K HEVC streams aren't throttled. Reuses an existing Stremio-Desktop streaming server if port 11470 is already bound.
- `src/player/mpv.rs` — `libmpv2` wrapper. The renderer's `NativeMpvPlayer` issues `loadfile`, `set_property`, etc. via IPC; this module dispatches them on the libmpv handle.
- `src/player/mpv_events.rs` — list of mpv properties the shell observes and forwards to the renderer (time-pos, pause, video-params/gamma for HDR, dwidth/dheight for 4K, etc.). Add a property here when the renderer needs to react to a new mpv state.
- `src/ipc/` — typed protocol between WebView2 renderer and shell main. JSON over `postMessage` + `addScriptToExecuteOnDocumentCreated`. Responses correlated by UUID.
- `src/updater.rs` — polls `GITHUB_REPO = "SilentGTX/Blissful"` every 30 min, surfaces "update available" / "update downloaded" events to the renderer over IPC, spawns the new installer on user confirmation, quits. Drafts are invisible (the API returns `/releases/latest` only for published, non-draft, non-prerelease entries).
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

### Stremio cache (gotcha)

The shell writes `server-settings.json` to `%APPDATA%\stremio\stremio-server\` with `cacheSize: 107374182400` (100 GB). The runtime fills this cache as users stream. On long-running installs this can grow to tens of GB. Safe to wipe at `%APPDATA%\stremio\stremio-server\stremio-cache\` while Blissful + Stremio are both closed.

## Blissful UI Architecture (apps/blissful-mvs/)

**Stack:** React 19 + TypeScript 5.9 (strict) + Vite 7 + HeroUI + Tailwind CSS + React Router 7 + Framer Motion.

### Data flow

1. **Stremio Core API** (`lib/stremioApi.ts`) — auth, library sync, addon management. Endpoint `https://api.strem.io/api/*`.
2. **Addon protocol** (`lib/stremioAddon.ts`) — fetches manifest/catalog/meta/stream/subtitles from addon URLs. All requests go through `/addon-proxy` for CORS. 5-minute in-memory cache per resource type.
3. **Storage server** (`lib/storageApi.ts`) — persists user prefs (player settings, home row order, theme, etc.) to a remote MongoDB-backed `blissful-storage` server. The shell proxies these calls through `/storage/*` so the renderer treats them as same-origin. The storage service is hosted separately and out of scope for this repo.
4. **Local state** — watch progress (`progressStore.ts`), stream history (`streamHistory.ts`), library bookmarks (`libraryStore.ts`) all use `localStorage` under `bliss*` key prefixes.

### Key patterns

- **AppShell** (`components/AppShell.tsx`) is the root layout. Owns all global state and provides it via `AppContext`. Intentionally a single large component — state lives here so modals/features have cross-cutting access.
- **Feature modules** live in `features/{home,detail,discover}/` with their own `components/`, `hooks/`, and `utils.ts`.
- **Cancellation:** async effects use `let cancelled = false` + cleanup `() => { cancelled = true }` to prevent state updates after unmount.
- **Stream routing:** stream clicks build a player URL from `deepLinks.ts` and navigate to `/player?url={encoded}`. Local stremio-server URLs (`http://127.0.0.1:11470/...`) are passed through; the shell's UI server allow-lists them at `/addon-proxy`.
- **Native vs SimplePlayer:** the player page renders `NativeMpvPlayer` inside the desktop shell (detected via `isNativeShell()` in `lib/desktop.ts`). A `SimplePlayer` (`<video>` element) fallback exists for browser context but is not the primary focus.
- **Two UI modes:** `classic` (sidebar + glass) and `netflix` (top bar + hero). Toggled by `uiStyle` in AppContext.

### Desktop bridge (`lib/desktop.ts`)

`window.blissfulDesktop` is injected by the Rust shell's WebView2 init script. The renderer talks to libmpv, the streaming server, the updater, and per-process settings via promises:

- `desktop.mpv.loadfile(url)`, `desktop.mpv.set_property(name, value)`, `desktop.mpv.observe_property(name)` etc.
- `desktop.streamingServer.ensure_started()` — guarantees `127.0.0.1:11470` is bound before playback.
- `desktop.updater.check()`, `desktop.updater.download()`, `desktop.updater.install_and_quit()`.
- `desktop.getAppVersion()` — surfaces `CARGO_PKG_VERSION` for the sidebar header.

Use `isNativeShell()` to gate desktop-only UI (the `NativeMpvPlayer`, the version badge, etc.). The bridge is absent in the browser fallback.

### Key files

- `src/components/AppShell.tsx` — root layout, global state, nav, Continue Watching, iOS drawer.
- `src/components/NativeMpvPlayer.tsx` — libmpv-backed player. Issues `loadfile` + property observers via the desktop bridge. Owns the on-screen controls, subtitle picker, audio picker, HDR/4K/RD badges, resume modal, "stream unavailable" modal.
- `src/components/SimplePlayer.tsx` — `<video>`-element player fallback for non-native (browser) context.
- `src/pages/{HomePage,DiscoverPage,DetailPage,PlayerPage}.tsx` — main routes.
- `src/lib/{stremioApi,stremioAddon,streamHistory,storageApi,desktop,progress,playerSettings}.ts`.

## Releases

The canonical release pipeline is [.github/workflows/release.yml](.github/workflows/release.yml):

1. Bump `version` in `apps/blissful-shell/Cargo.toml`.
2. Commit, tag `v<version>`, push tag (`git push origin v<version>`).
3. CI runs on `windows-latest`: fetches vendored binaries from the `vendor-binaries-v1` GitHub release, builds the UI, builds the Rust shell, runs the WiX/Burn pipeline, creates a **draft** GitHub release with the `BlissfulSetup-<version>.exe` attached.
4. Manually publish the draft from the GitHub Releases UI when you're happy with it. The in-app updater (`src/updater.rs`) picks up the published release within 30 min.

The workflow runs unsigned by default; the SignPath signing step is wired but commented out. To enable: configure `SIGNPATH_API_TOKEN` (secret) and `SIGNPATH_ORGANIZATION_ID` (variable) under repo settings, then uncomment the "Submit to SignPath" block in the workflow.

### Vendored binaries

Runtime DLLs (`libmpv-2.dll`, ffmpeg, MSVC runtime) and `stremio-service.zip` are not committed to this repo. They live as release assets under the `vendor-binaries-v1` prerelease on this repo. The release workflow downloads them at build time via four repository variables (`LIBMPV_ZIP_URL`, `FFMPEG_ZIP_URL`, `STREMIO_SERVICE_ZIP_URL`, `VCRUNTIME_ZIP_URL`). Bump to `vendor-binaries-v2` etc. when one of those bundled components needs to change.

## Code signing

Currently **unsigned** — releases ship without an Authenticode signature, so users see SmartScreen on first install and must click "More info → Run anyway". SignPath Foundation OSS sponsorship has been applied for; approval typically takes 1–4 weeks. Once approved, the workflow's commented-out SignPath step is enabled and subsequent releases are signed transparently in CI.

## Licensing

- The source code in this repo is **MIT** (see [LICENSE](LICENSE)).
- The shipped installer EXE bundles an **LGPLv2.1+** `libmpv-2.dll` (currently the [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) `mpv-dev-lgpl-x86_64` build, uploaded as `libmpv-lgpl.zip` on the `vendor-binaries-v1` release). The combined installer is therefore **LGPL-governed on redistribution** — libmpv source must be available (zhongfly's repo satisfies this) and users must be able to swap in their own build. Blissful loads `libmpv-2.dll` dynamically from `%ProgramFiles%\Blissful\`, so the swap is trivial. The root [README](README.md) license section documents the situation in detail.
- Source code can be forked and modified under MIT; the installer's LGPL obligations only apply when *redistributing* the prebuilt installer.
- Historical note: pre–vendor-binaries-v1/`libmpv-lgpl.zip` the project bundled the GPL shinchiro build, which made the combined installer GPL-governed and the bundled DLL ~118 MB. The LGPL build is ~96 MB.

## Code Style

- **TypeScript:** `strict: true`, 2-space indent, ES6 imports, `catch (err: unknown)` then narrow.
- **Rust:** standard `rustfmt`, `cargo clippy` clean. Tracing for logs (no `println!`).
- **Naming:** camelCase vars/functions, PascalCase classes/React components, UPPER_SNAKE_CASE constants.
- **Blissful styling:** glass effect via `solid-surface bg-white/6 backdrop-blur`, large corners `rounded-[28px]`, brand color `--bliss-teal: #19f7d2`, fonts Fraunces (headings) + IBM Plex Sans (body).
- **No emojis in code or commit messages** unless the user asks for them.

## Key references

- [.github/workflows/release.yml](.github/workflows/release.yml) — CI release pipeline.
- [apps/blissful-mvs/AGENTS.md](apps/blissful-mvs/AGENTS.md) — UI-specific patterns and conventions.
- [LICENSE](LICENSE) + root README license section — licensing details.
