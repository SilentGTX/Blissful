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

Runtime DLLs (libmpv, ffmpeg) and the bundled `stremio-service.zip` are gitignored — for local dev you stage them yourself under `apps/blissful-shell/resources/`. For CI builds the release workflow fetches them from the `vendor-binaries-v1` GitHub release at build time.

## Releasing

`apps/blissful-shell/installer/` contains the WiX scaffolding. The GitHub Actions release workflow builds the MSI on tag push and publishes it to the **Releases** tab of this repo. The auto-updater in the shell polls `api.github.com/repos/SilentGTX/Blissful/releases/latest`.

## License

The Blissful source code in this repository is licensed under the **MIT
License** — see [LICENSE](LICENSE). You are free to use, modify, and
redistribute the source under MIT terms.

The **distributed installer** (`BlissfulSetup-*.exe`) bundles a copy of
`libmpv-2.dll` built from the upstream [mpv](https://github.com/mpv-player/mpv)
project's **LGPLv2.1+ configuration** (currently the
[zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) LGPL
prebuilt — `mpv-dev-lgpl-x86_64-*.7z`). As a result the **combined
installer binary is governed by LGPL terms on redistribution**, while
the Blissful source itself remains MIT. The practical LGPL obligations
when redistributing the installer are:

- Make the libmpv source available (zhongfly's repo above + the
  Blissful release the binary came from satisfies this).
- Don't statically link libmpv into the shell — Blissful loads
  `libmpv-2.dll` dynamically at runtime, so this is already true.
- Allow users to replace the bundled `libmpv-2.dll` with their own
  LGPL-compatible build. They already can: the file lives next to
  `blissful-shell.exe` in `%ProgramFiles%\Blissful\`.

Switching from the historical GPL build (shinchiro) to this LGPL build
also shrinks the installer (~20 MB savings — the LGPL build omits GPL
codecs like x264/x265 encoders that Blissful doesn't use for playback
anyway).

This dual MIT-source / LGPL-bundle situation is normal for OSS
projects that dynamically link against LGPL media libraries and does
not affect your ability to fork, modify, or self-build the Blissful
source under MIT.
