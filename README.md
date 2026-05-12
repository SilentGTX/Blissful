# Blissful

A native Windows Stremio client.

- **UI**: React 19 + TypeScript 5.9 + Vite 7 + HeroUI + Tailwind, served by the local shell on `127.0.0.1`.
- **Player**: libmpv in-process via `libmpv2` — matches Stremio Desktop's playback quality (HW decode, every codec, embedded subs via libass, HDR detection).
- **Shell**: Rust + WebView2 + `native-windows-gui` + bundled `stremio-service` for torrent streaming.

## Repo layout

- `apps/blissful-shell/` — Rust + WebView2 shell. Hosts the local HTTP server (`/addon-proxy`, `/storage/*`, `/stremio/*`, `/subtitles.vtt`, `/opensubHash`), spawns + supervises the bundled streaming server, drives libmpv, ships the auto-updater.
- `apps/blissful-mvs/` — React UI. Built into `dist/` and served by the shell at startup. Runs against the standalone Vite dev server on `:5173` when developing.

## Dev quickstart

```powershell
# UI (port 5173)
npm --prefix apps\blissful-mvs install
npm --prefix apps\blissful-mvs run dev

# Shell (port 5175+)
cd apps\blissful-shell
cargo run --features spike0a
```

The shell auto-detects whether a Vite dev server is up on 5173 and proxies UI requests to it; otherwise it serves the prebuilt `apps/blissful-mvs/dist/`.

## Prerequisites

Runtime DLLs (libmpv, ffmpeg) and the bundled `stremio-service.zip` are NOT committed — they're downloaded by `apps/blissful-shell/scripts/setup-resources.ps1` (TODO: wire). See `apps/blissful-shell/PREREQUISITES.md`.

## Releasing

`apps/blissful-shell/installer/` contains the WiX scaffolding. The GitHub Actions release workflow builds the MSI on tag push and publishes it to the **Releases** tab of this repo. The auto-updater in the shell polls `api.github.com/repos/SilentGTX/Blissful/releases/latest`.

## License

The Blissful source code in this repository is licensed under the **MIT
License** — see [LICENSE](LICENSE). You are free to use, modify, and
redistribute the source under MIT terms.

The **distributed installer** (`BlissfulSetup-*.exe`) bundles a copy of
`libmpv-2.dll` built from the upstream [mpv](https://github.com/mpv-player/mpv)
project's GPL configuration (currently the [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake)
prebuilt). As a result the **combined installer binary is governed by GPL
terms on redistribution**, even though the Blissful source itself remains
MIT. If you redistribute the installer you inherit the GPL obligations
(make the corresponding source available, license the redistribution
under GPL-compatible terms, etc.). The source of libmpv is publicly
available at the link above; Blissful's own source is on this repository.

This dual situation is normal for OSS projects that link against
GPL-licensed media libraries (libmpv, GPL FFmpeg builds, etc.) and does
not affect your ability to fork, modify, or self-build the Blissful
source under MIT.
