// Blissful Shell — Phase 0a architecture spike.
//
// This is NOT production code. It is the minimum proof that the architecture
// works: native Win32 window + libmpv child HWND + transparent WebView2
// overlay. See apps/blissful-shell/plan.md Phase 0 for the acceptance gate.
//
// Run with:
//   cargo run --features spike0a
//
// Before running, edit `PHASE_0A_TEST_FILE` below to point at a local
// 4K HEVC HDR file. Also ensure `resources/mpv-x64/libmpv-2.dll` exists
// per PREREQUISITES.md.

#![cfg_attr(all(not(test), not(debug_assertions)), windows_subsystem = "windows")]

use anyhow::{Context, Result};
use std::path::PathBuf;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod ipc;
mod main_window;
mod player;
mod state;
mod streaming_server;
mod tray;
mod ui_server;
mod updater;
mod webview;

/// Hardcoded local file path for the Phase 0a spike. Big Buck Bunny 1080p
/// HEVC sample (Creative Commons, ~5MB) — small enough to keep iteration
/// fast, HEVC-encoded so it exercises the same HW decode path Blissful
/// actually uses with Stremio streams. Phase 2 replaces this with real URL
/// handling and removes the hardcoded path entirely.
const PHASE_0A_TEST_FILE: &str = r"D:\JS\OpenCode\apps\blissful-shell\resources\test-media\bbb_full.mp4";

fn main() -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("blissful_shell=debug,info"));

    // In release builds, `windows_subsystem = "windows"` closes stderr,
    // so the default tracing_subscriber writer drops every log line
    // into the void — meaning a user-reported issue like "updater
    // isn't firing" has zero diagnostic surface to work from. Write
    // to %APPDATA%/Blissful/shell.log instead. Truncated per launch
    // so the file reflects "what happened this session" rather than
    // growing unbounded.
    //
    // Debug builds keep stderr — `cargo run` is more useful with live
    // terminal output, and the file would just add noise.
    let log_path = std::env::var_os("APPDATA")
        .map(|appdata| PathBuf::from(appdata).join("Blissful").join("shell.log"));

    #[cfg(debug_assertions)]
    {
        let _ = &log_path; // unused in debug; suppress warning
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .with_thread_ids(true)
            .init();
    }
    #[cfg(not(debug_assertions))]
    {
        if let Some(p) = &log_path {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(file) = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(p)
            {
                tracing_subscriber::fmt()
                    .with_env_filter(filter)
                    .with_target(true)
                    .with_thread_ids(true)
                    .with_ansi(false)
                    .with_writer(std::sync::Mutex::new(file))
                    .init();
            } else {
                // Fall back to default (stderr, which is closed). Better
                // than nothing — and if we ever flip windows_subsystem
                // off for a release diagnostic build, output reappears.
                tracing_subscriber::fmt()
                    .with_env_filter(filter)
                    .with_target(true)
                    .with_thread_ids(true)
                    .init();
            }
        } else {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_target(true)
                .with_thread_ids(true)
                .init();
        }
    }

    info!("Blissful Shell v{} starting", env!("CARGO_PKG_VERSION"));
    if let Some(p) = &log_path {
        info!(path = %p.display(), "shell tracing log file");
    }

    // libmpv-2.dll lookup: must be in resources/mpv-x64/ next to the exe in
    // dev, or in the install dir in release builds.
    let exe_dir = std::env::current_exe()?.parent().context("no exe parent")?.to_path_buf();
    let libmpv_dir = locate_libmpv_dir(&exe_dir).context("libmpv-2.dll not found — see PREREQUISITES.md")?;
    info!(libmpv = %libmpv_dir.display(), "loading libmpv");

    // Add libmpv directory to DLL search path so the loader finds it at runtime.
    // SAFETY: we set this before any libmpv2 calls.
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::System::LibraryLoader::SetDllDirectoryW;
        let s = HSTRING::from(libmpv_dir.to_string_lossy().as_ref());
        // SetDllDirectoryW in windows 0.60 takes P0: Param<PCWSTR>; &HSTRING qualifies.
        SetDllDirectoryW(&s).ok();
    }

    #[cfg(feature = "spike0a")]
    {
        info!("running Phase 0a spike");
        main_window::run_spike(PHASE_0A_TEST_FILE)?;
        Ok(())
    }

    #[cfg(not(feature = "spike0a"))]
    {
        eprintln!();
        eprintln!("This build does not include the Phase 0a spike.");
        eprintln!("Run with: cargo run --features spike0a");
        eprintln!();
        eprintln!("Production entry point is not implemented yet (Phase 1+).");
        std::process::exit(2);
    }
}

/// Look for `libmpv-2.dll` in the standard locations. Returns the directory
/// containing it (which we add to the DLL search path).
fn locate_libmpv_dir(exe_dir: &std::path::Path) -> Option<PathBuf> {
    // In dev: apps/blissful-shell/resources/mpv-x64/
    // In release: <install_dir>/mpv/ (legacy) or <install_dir>/ (flat MSI)
    let candidates = [
        // Flat install layout: WiX MSI stages libmpv-2.dll directly next
        // to blissful-shell.exe. Without this, main() bails on the
        // .context(...)? on locate_libmpv_dir and the process exits with
        // code 1 before any window can be drawn.
        exe_dir.to_path_buf(),
        exe_dir.join("resources").join("mpv-x64"),
        exe_dir.join("..").join("..").join("resources").join("mpv-x64"),
        exe_dir.join("..").join("..").join("..").join("resources").join("mpv-x64"),
        exe_dir.join("mpv"),
    ];
    for c in &candidates {
        let dll = c.join("libmpv-2.dll");
        if dll.exists() {
            return Some(c.clone());
        }
    }
    None
}
