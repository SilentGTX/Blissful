# Installer (Phase 7)

Produces a signed MSI that installs Blissful to `%ProgramFiles%\Blissful`,
bundling everything the shell needs at runtime:

- `blissful-shell.exe` (the Rust shell, release build)
- `libmpv-2.dll` + ffmpeg DLLs
- `stremio-service.zip` (extracted on first run by the shell)
- `blissful-ui/` (the Vite React build output)
- WebView2 evergreen bootstrapper (no-op if already installed)

## Prerequisites

One-time, on the machine that builds installers:

1. **Rust + MSVC** — same as dev (rustup + Visual Studio Build Tools with C++).
2. **Node + npm** — for the React build.
3. **WiX Toolset 3.x** — https://github.com/wixtoolset/wix3/releases.
   Add `bin/` to PATH so `heat.exe`, `candle.exe`, `light.exe` resolve.
4. **Windows 10/11 SDK** — provides `signtool.exe`. The build script
   auto-discovers it under `Program Files (x86)\Windows Kits\10\bin\`.
5. **Authenticode cert** — `.pfx` file + password. Not in the repo; live in
   a password manager. Pass via:
   - `-CertPath C:\certs\blissful.pfx -CertPassword '...'` flags, OR
   - `BLISSFUL_CERT_PATH` + `BLISSFUL_CERT_PASSWORD` env vars

Plus the dev-only resources already required to compile + run the shell:
- `../resources/mpv-x64/libmpv-2.dll` (currently shinchiro GPL build — see root README license section)
- `../resources/stremio-service.zip`
- `../resources/ffmpeg-dlls/*`
- `../resources/icon.ico`

## Build

From `apps/blissful-shell/installer/`:

```powershell
./build.ps1                                    # unsigned build
./build.ps1 -CertPath ... -CertPassword ...    # signed
$env:BLISSFUL_CERT_PATH = 'C:\certs\blissful.pfx'
$env:BLISSFUL_CERT_PASSWORD = 'hunter2'
./build.ps1                                    # signed via env vars
```

Output lands in `installer/dist/Blissful-Setup-X.Y.Z.msi`.

## What the build script does

1. `npm ci` + `npm run build` in `apps/blissful-mvs/` → React `dist/`
2. `cargo build --release --features spike0a` in `apps/blissful-shell/`
3. (optional) Sign the exe before bundling
4. Stage everything under `installer/staging/`
5. `heat.exe` harvests `staging/` → `staging-files.wxs` (auto-generated)
6. `candle.exe` compiles `blissful.wxs` + `staging-files.wxs` → `.wixobj`
7. `light.exe` links → `dist/Blissful-Setup-X.Y.Z.msi`
8. (optional) Sign the MSI

## Signing

The Authenticode cert proves to Windows SmartScreen that this installer
came from Smart Code OOD. Without it, users get a "Windows protected your
PC" warning on first install and have to click "More info" → "Run anyway".

EV-class certs bypass SmartScreen entirely after a brief reputation
warm-up; OV-class certs warm up over time. The cert .pfx + password live
in your password manager / GitHub Actions secrets.

## Tag → release

`gh release create v0.4.0 ./installer/dist/Blissful-Setup-0.4.0.msi`
publishes the MSI as a GitHub Release asset. The shell's auto-updater
(`src/updater.rs`) polls
`https://api.github.com/repos/SilentGTX/OpenCode/releases/latest`,
compares `tag_name` to `env!("CARGO_PKG_VERSION")`, and downloads + spawns
the MSI when newer. The auto-updater path expects a `.exe` asset; for MSI
publication we'd either rename to `.exe` or extend the updater's asset
picker to accept `.msi`.

## CI

`.github/workflows/release.yml` (drafted alongside this Phase 7 work)
runs the same `build.ps1` on a Windows runner, sources the cert from
the repo's secrets, and uploads the signed MSI to the GitHub Release
that triggered the workflow.
