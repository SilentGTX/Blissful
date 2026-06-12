# Blissful Desktop (`apps/desktop-blissful`) — the Rust native Windows shell

**Stack:** Rust + `native-windows-gui` 1.0 (high-dpi) + `webview2` 0.1.4 + `libmpv2` 5.0 +
`hyper` 1 (HTTP server) + `reqwest` + `tokio` + `flume` + `sha2`.

The shell ships 1:1 with Stremio Desktop playback quality: in-process libmpv with HW decode,
every codec, embedded subs via libass, HDR detection. It hosts the **web UI**
(`apps/web-blissful` — see that app's [DOCUMENTATION.md](../web-blissful/DOCUMENTATION.md) for
the thin-shell model: release builds load `https://blissful.budinoff.com`, so UI changes ship
via web deploy, not desktop releases).

## Build & dev commands

```powershell
# Dev: runs with the spike0a feature flag (the production entry point).
# Picks up libmpv-2.dll from resources/mpv-x64/ (stage manually for dev).
cd apps\desktop-blissful
cargo run --features spike0a

# Release build (driven by installer/build.ps1, no need to run directly):
cargo build --release --features spike0a

# Unit tests (in-tree tests under `cargo test`):
cargo test --features spike0a --bins
```

**Note on `spike0a`:** despite the legacy name, this feature flag gates the **production**
entry point. Without it, `main.rs` prints a help message and exits with code 2 — the installed
app would silently fail to launch. The installer pipeline passes it; ad-hoc release builds must
too.

### Installer (WiX 3.x + Burn bundle)

The canonical release path is the CI workflow (see Releases below). For local installer builds:

```powershell
# End-to-end pipeline: builds UI + Rust shell + WiX MSI + Burn bundle EXE.
# Output: apps/desktop-blissful/installer/dist/BlissfulSetup-<ver>.exe
$env:Path = "C:\path\to\wix314;C:\Users\<you>\.cargo\bin;" + $env:Path
apps\desktop-blissful\installer\build.ps1 -SkipSign
```

Prereqs (one-time): Rust toolchain (rustup + MSVC build tools), Node + npm, WiX 3.x binaries on
PATH (`heat.exe`, `candle.exe`, `light.exe`), and vendored binaries staged under `resources/` —
`mpv-x64/libmpv-2.dll` + `mpv.lib`, `ffmpeg-dlls/*.dll`, `stremio-service.zip`,
`vcruntime/*.dll`. CI fetches these from the `vendor-binaries-v1` GitHub release.

## Architecture — core files

- `src/main.rs` — entry. Sets up tracing (rotates `shell.log` → `shell.log.1` on launch),
  installs a panic hook that logs thread/location/payload before death, locates `libmpv-2.dll`,
  dispatches to `run_spike` (the production path, gated on `spike0a`).
- `src/main_window.rs` — owns the NWG parent window. Creates libmpv + WebView2 as sibling
  children, wires IPC, the tray, the delayed-show splash, the on-ready handoff. Owns the
  outgoing-event channel + NWG `Notice` funnelling async events to the UI thread. **Resolves
  the WebView2 nav target** (`BLISSFUL_UI_URL` override → dev-local → release `REMOTE_UI_URL`).
- `src/webview.rs` — WebView2 host. Persists user data in `%APPDATA%\Blissful\WebView2\`.
  `is_allowed_internal_uri()` pins navigation to **two** origins — the local UI server and the
  configured remote — for the thin shell; off-origin http/https links are cancelled and handed
  to the OS default browser, anything else (`javascript:`, `data:`, `file:`, custom schemes) is
  dropped. On a failed initial remote nav, falls back once to the bundled local UI.
- `src/ui_server.rs` — same-origin local HTTP server on `:5175` (port-scan fallback 5175..5190).
  Serves the React app (bundled fallback / dev) + proxies `/addon-proxy`, `/storage/*`,
  `/stremio/*`, and forwards `/tmdb-season-info`, `/rd-fallback`, `/imdb-rating`, `/resolve-url`
  to the backend. `classify_addon_proxy_target()` does host/path validation as a pure,
  unit-tested function (typed `url::Host` variants — closes an IPv6-loopback leak). Dev:
  prefers a running Vite on `:5173` over any on-disk build.
- `src/streaming_server.rs` — extracts `stremio-service.zip` to
  `%APPDATA%\Blissful\stremio-service\` on first run, copies bundled ffmpeg DLLs alongside,
  spawns `stremio-runtime.exe` and **retains the `Child` handle** for `try_wait()` crash
  detection + clean `kill()` on shutdown. Writes an aggressive `server-settings.json`
  (cacheSize, BT caps) so 4K HEVC streams aren't throttled. Reuses an existing Stremio-Desktop
  streaming server if port 11470 is already bound. `copy_ffmpeg_dlls` hard-errors if any
  required DLL is missing after every source was tried.
- `src/player/mpv.rs` — `libmpv2` wrapper. **libmpv2 5.0.3 cannot read `MPV_FORMAT_NODE`
  properties** (the crate panics with `unimplemented!()`). Workaround, used for `track-list` and
  `chapter-list`: read the count as `Int64`, then loop `<prop>/N/<field>` sub-properties using
  only `Int64`/`Double`/`String`. See `get_tracks()` / `get_chapters()`.
- `src/player/mpv_events.rs` — observed mpv properties forwarded to the renderer (time-pos,
  pause, video-params/gamma for HDR, dwidth/dheight, `chapter`, …). Add a property here when the
  renderer needs a new mpv state — but only `Int64`/`Double`/`Flag`/`String` (Node can't be
  observed; see above).
- `src/ipc/commands.rs` — typed command dispatch over JSON `postMessage`. The `mpv.command` IPC
  has an **allowlist** (`ALLOWED_MPV_COMMANDS`) so a compromised renderer can't spawn processes
  via mpv's `run`/`subprocess`/`load-script`.
- `src/updater.rs` — polls `GITHUB_REPO = "SilentGTX/Blissful"` (2 s initial delay, 30 min
  interval). Fetches the `<installer>.sha256` sidecar BEFORE the installer, streams the
  installer to `.tmp`, verifies SHA-256, only then promotes + fires `update-downloaded`.
  Refuses to install on mismatch or when no sidecar is published.
- `src/state.rs` — `ShellState` (thread_local for UI-thread IPC handlers); `OUTGOING_TX` +
  `OUTGOING_NOTICE` (global channel any thread can push events through; replaced the
  thread_local sink that silently dropped worker-thread events); `WEBVIEW_READY` (AtomicBool
  gating the drain).
- `src/tray.rs` — tray icon + show/hide/quit.

## Security surface

None of this is theoretical — each item was a real review finding.

- **CI vendor-binary integrity** — the release workflow `Get-FileHash`-verifies the four vendor
  zips against SHA-256s stored in mandatory repo variables (`LIBMPV_ZIP_SHA256`,
  `FFMPEG_ZIP_SHA256`, `STREMIO_SERVICE_ZIP_SHA256`, `VCRUNTIME_ZIP_SHA256`).
- **Auto-update integrity** — every release publishes `BlissfulSetup-<ver>.exe.sha256`; the
  updater verifies before installing. Closes the auto-update RCE path pre-Authenticode.
- **mpv command allowlist** — `ALLOWED_MPV_COMMANDS` restricts `mpv.command` to a small set;
  rejects `run`, `quit`, `subprocess`, `load-script` with `command-not-allowed`.
- **WebView2 navigation pinning** — `add_navigation_starting` + `add_new_window_requested`
  (blocks popups, routes legit links to the OS browser).
- **Shell.log rotation + panic hook** — a startup crash that triggers a relaunch doesn't wipe
  the log explaining the crash.

## Install layout pitfall (important)

WiX MSI stages all bundled files **flat** at `[ProgramFiles64Folder]Blissful\` — there's no
`resources/` subfolder in installed builds. Every path lookup must check the flat layout first,
then fall back to dev `resources/<...>`: `main.rs::locate_libmpv_dir`,
`streaming_server.rs::locate_zip`, `streaming_server.rs::copy_ffmpeg_dlls`,
`ui_server.rs::detect_static_root`. If any fall through to None the shell exits before drawing
a window — and `windows_subsystem = "windows"` closes stderr, so **the only diagnostic is
`%APPDATA%\Blissful\shell.log`**. Always test installed builds end-to-end, not just `cargo run`.

## Installer files (`installer/`)

- `blissful.wxs` — MSI definition; `heat.exe` harvests `staging/` at build time. WebView2
  evergreen bootstrapper runs at `InstallExecuteSequence` (no-op if present).
- `bundle.wxs` — Burn bundle wrapping the MSI into `BlissfulSetup-<ver>.exe`
  (`WixStandardBootstrapperApplication.HyperlinkLicense`, custom theme).
- `theme.xml` + `theme.wxl` — **ASCII-only** in `theme.wxl` (PowerShell 5.1 CP1252 mojibake
  hazard; build script round-trips with explicit UTF-8 no-BOM as defence in depth).
- `build.ps1` — end-to-end pipeline (reads version from `Cargo.toml`, templates `@VERSION@`
  into `theme.wxl` and restores it in a `finally`). **ASCII-only** — same hazard.

## Releases

The canonical pipeline is [.github/workflows/release.yml](../../.github/workflows/release.yml):

1. Bump `version` in `apps/desktop-blissful/Cargo.toml`.
2. Commit, tag `v<version>`, push the tag.
3. CI (windows-latest): fetches + **SHA-256-verifies** vendored binaries from the
   `vendor-binaries-v1` GitHub release, builds the UI, builds the shell, runs WiX/Burn, computes
   the `<installer>.sha256` sidecar, publishes a release with **both** assets, marks it
   `make_latest: true`.
4. The **Prune old releases** step deletes every release that isn't (a) the new Latest, (b) the
   immediately-prior version, or (c) the Stable pin (`STABLE_RELEASE_TAG` repo variable).
   `vendor-binaries-*` releases are always preserved.

**Releases ship the SHELL, not the UI** (thin-shell model): tag a release only for Rust/shell
changes. The installer still bundles a `dist/` as the offline/remote-down fallback, so CI still
builds the UI.

### Release retention

**Latest** + **Latest-1** auto-kept; **Stable** = whatever `STABLE_RELEASE_TAG` points at
(release title suffixed ` — Stable` in the UI for clarity; the tag stays plain). Empty var = no
pin.

### Vendored binaries

Runtime DLLs (`libmpv-2.dll`, ffmpeg, MSVC runtime) and `stremio-service.zip` live as assets on
the `vendor-binaries-v1` prerelease, fetched at build time via eight repo variables
(`*_ZIP_URL` + `*_ZIP_SHA256`, all SHA vars mandatory). The current libmpv is the
zhongfly/mpv-winbuild **LGPL** build repacked as `libmpv-lgpl.zip` (the repack regenerates the
MSVC `mpv.lib` from the DLL's exports via `dumpbin`/`lib.exe` — runbook in git history of the
root CLAUDE.md and the README licensing section). Swap builds by uploading a new asset and
pointing the URL+SHA variables at it.

## Code signing & licensing

Currently **unsigned** — users see SmartScreen on first install (SignPath Foundation OSS
sponsorship applied for; the workflow's SignPath step is wired but commented out — when enabled,
recompute the `.sha256` sidecar against the signed EXE). The updater's SHA-256 sidecar check is
the integrity guarantee meanwhile.

Source is **MIT**; the shipped installer bundles an **LGPLv2.1+** `libmpv-2.dll`, so the
combined installer is LGPL-governed on redistribution (libmpv loads dynamically from
`%ProgramFiles%\Blissful\`, so user swap is trivial). Details in the root [README](../../README.md).

## Stremio cache (gotcha)

The shell writes `server-settings.json` to `%APPDATA%\stremio\stremio-server\` with
`cacheSize: 107374182400` (100 GB); the runtime fills it as users stream. Safe to wipe at
`%APPDATA%\stremio\stremio-server\stremio-cache\` while Blissful + Stremio are both closed.
