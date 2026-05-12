# Phase 0 Prerequisites

Three things to source before the Phase 0 spike code can run. None of them are blocking each other — set them up in parallel.

## 1. Rust toolchain (you do not have this installed yet)

PowerShell, verified by `rustup --version`. Currently unrecognized command. Install:

```powershell
# Run in PowerShell (no admin needed)
Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile rustup-init.exe
.\rustup-init.exe -y --default-toolchain stable --profile default
# Restart your shell, then verify:
rustup --version
cargo --version
rustc --version
```

You also need the **MSVC build toolchain**. If you don't have Visual Studio installed:

- Install [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/?q=build+tools) (free)
- During install, check "Desktop development with C++"
- Required components: MSVC v143, Windows 11 SDK, C++ CMake tools

After both are installed, `cargo build` will work from `apps/blissful-shell/`.

## 2. LGPL-built libmpv-2.dll + mpv.lib (cannot use the GPL one we ship today)

You need **two files**, not one. libmpv builds for Windows distribute them together:

- **`libmpv-2.dll`** — the runtime DLL we load with `LoadLibraryW` at startup.
- **`mpv.lib`** — the MSVC **import library** the linker uses at build time. Without it you get `LNK1181: cannot open input file 'mpv.lib'`. The crate `libmpv2-sys` emits `cargo:rustc-link-lib=mpv` but no search path; our [build.rs](build.rs) points the linker at `resources/mpv-x64/`, so dropping `mpv.lib` there is enough.

**If your archive only ships the DLL (shinchiro's runtime archives do), generate `mpv.lib` yourself with MSVC tools** — this is what we did for the Phase 0a spike. PowerShell recipe:

```powershell
$msvc = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133\bin\Hostx64\x64"
$env:PATH = "$msvc;$env:PATH"
Set-Location "D:\JS\OpenCode\apps\blissful-shell\resources\mpv-x64"

# Parse exports from libmpv-2.dll into a .def file
$dump = & dumpbin.exe /EXPORTS "libmpv-2.dll" 2>&1
$names = $dump | ForEach-Object {
    if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\w+)') { $matches[1] }
}
@("LIBRARY libmpv-2.dll", "EXPORTS") + $names | Out-File mpv.def -Encoding ascii

# Generate the import library
& lib.exe /DEF:mpv.def /OUT:mpv.lib /MACHINE:X64
```

shinchiro builds statically link libbluray, libsixel, etc., so the export table has more than just `mpv_*` symbols (~206 total, 54 starting with `mpv_`). Including everything in the .def is harmless.

The Electron build's `apps/blissful-desktop/resources/mpv/mpv.exe` came from [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), which is **GPL-licensed**. Shipping that DLL with a closed-source app is a GPL violation.

Two options to source an LGPL build:

### Option A — use a prebuilt LGPL binary

Look for a `libmpv-2.dll` from a build pipeline that uses `meson -Dgpl=false`. Candidates:
- Check [mpv-player/mpv-build](https://github.com/mpv-player/mpv-build) discussions and CI artifacts
- Some Linux distribution packages (e.g., Debian's `libmpv2`) build LGPL; the Windows equivalent build pipeline is less common
- The `libmpv2` crate's CI may have LGPL artifacts — check [kohsine/libmpv-rs](https://github.com/kohsine/libmpv-rs) releases

**Critical check before using:** the DLL must NOT be linked against GPL-only FFmpeg components like `libpostproc` or `x264`. Use `dumpbin /imports libmpv-2.dll` to inspect, or run a quick smoke test (`mpv --no-config --version` shows the build configuration; even on a DLL, the `mpv_get_property("file-format")` after init exposes capability flags).

### Option B — build it ourselves with `meson`

Follow [mpv compile guide](https://github.com/mpv-player/mpv/blob/master/DOCS/compile-windows.md). Rough steps:

```bash
# Inside MSYS2 / MinGW environment on Windows:
git clone https://github.com/mpv-player/mpv.git
cd mpv
meson setup build -Dgpl=false -Dlibmpv=true -Dprefix=$PWD/out
meson compile -C build
meson install -C build
# Result: out/bin/libmpv-2.dll
```

We'll come back to this when Phase 7 (installer) needs a reproducible build. For Phase 0 development, any LGPL `libmpv-2.dll` we trust will do — we're just proving the architecture works.

### Where to put it

Once sourced, drop both files plus any FFmpeg DLLs the build needs at:

```
apps/blissful-shell/resources/mpv-x64/
  libmpv-2.dll              # runtime
  mpv.lib                   # link-time import lib (MSVC)
  (any required FFmpeg DLLs the build needs)
  LICENSE-libmpv.txt        # LGPL-2.1 text
```

[build.rs](build.rs) auto-points the linker here. Override with `MPV_LIB_DIR=...` for CI.

**Runtime DLL search path rule (important):** Windows resolves implicit DLL imports BEFORE `main()` runs, so the `SetDllDirectoryW` call in `main.rs` is too late on its own. For dev, you need a copy of `libmpv-2.dll` *next to the .exe*:

```powershell
Copy-Item "resources\mpv-x64\libmpv-2.dll" "target\debug\libmpv-2.dll"
```

For release/installer builds, the installer drops it in the same dir as `Blissful.exe`. This is the same convention every native Windows app with native DLLs uses.

Don't check the DLL or generated import lib into git (`.gitignore` covers `resources/mpv-x64/*.dll`, `*.lib`, `*.def`, `*.exp`). For now you'll point at it locally; for CI/release we'll add a download step.

## 3. Test 4K HEVC HDR file

For Phase 0a we hardcode a local file path. You need a real 4K HEVC HDR file on your disk so the spike can verify HW decode is working.

Suggestion: pick any 2160p HEVC `.mkv` you already have. A 5–30 second clip is enough. If you don't have one handy, mediainfo any large remux file and verify it shows `Format: HEVC` + `colour_primaries: BT.2020` (HDR markers).

Set its full path in `apps/blissful-shell/src/main.rs` at the marked `// TODO: Phase 0a hardcoded test file` line before running. Real torrent playback comes online in Phase 2.

## 4. WebView2 Runtime (probably already installed)

Pre-installed on Windows 11. Quick check:

```powershell
# Look in registry for WebView2 install
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
```

If missing, install the [WebView2 Runtime Evergreen](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (the small bootstrapper).

---

## Status before Phase 0a coding starts

- [ ] `rustup --version` returns a version (Rust toolchain installed)
- [ ] `apps/blissful-shell/resources/mpv-x64/libmpv-2.dll` exists and is verified LGPL
- [ ] Local 4K HEVC HDR test file path noted (will be hardcoded into `main.rs`)
- [ ] WebView2 Runtime confirmed installed (Win11 = yes by default)

When all four are done, `cargo run` from `apps/blissful-shell/` should open the spike window. The acceptance checklist in `plan.md` Phase 0a tells you what to verify.
