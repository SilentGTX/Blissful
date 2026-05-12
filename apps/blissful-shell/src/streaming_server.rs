// Streaming server: bundles, extracts, spawns, and supervises the
// stremio-service.exe that the React app talks to for HLS transcoding,
// torrent peer discovery, etc.
//
// This is a Rust port of `ensureStreamingServer` + `startStreamingServer`
// from apps/blissful-desktop/main.cjs. Key behaviors preserved:
//
//   - On first run, extract `resources/stremio-service.zip` to
//     `%APPDATA%/Blissful/stremio-service/`. A `.ready` marker file
//     skips re-extraction on subsequent launches.
//   - Locate the binary by BFS: any `*service*.exe` under the extracted
//     tree. The zip layout has changed before; don't hardcode the path.
//   - Copy required ffmpeg DLLs alongside the service binary. They come
//     from `resources/ffmpeg-dlls/` (bundled), or fall back to an
//     existing Stremio Desktop install on the user's machine.
//   - Before spawning, HEAD-probe `127.0.0.1:11470` — if something is
//     already listening (e.g. Stremio Desktop is running), reuse it
//     instead of spawning a duplicate.
//   - Spawn detached, redirect stdout/stderr to `stremio-service.log`
//     under `%APPDATA%/Blissful/`. CREATE_NO_WINDOW so no console pops.
//
// Supervision (auto-restart on crash) is intentionally deferred to a
// later cut — Phase 1's IPC stub always returns true, so the renderer
// happily proceeds even when the spawn fails. Failures are logged.
//
// Returning quickly is important: the renderer calls
// ensureStreamingServer() right before issuing playback, and a slow path
// here directly slows time-to-first-frame. We probe the port first,
// extract only if needed (cached), and only spawn if not already alive.

use anyhow::{anyhow, Context, Result};
use std::fs;
use std::io;
use std::net::{Shutdown, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tracing::{debug, info, warn};

/// FFmpeg DLLs the stremio-service.exe links against at runtime. Must be
/// in the same directory as the binary (PATH search precedence).
const REQUIRED_FFMPEG_DLLS: &[&str] = &[
    "avcodec-58.dll",
    "avdevice-58.dll",
    "avfilter-7.dll",
    "avformat-58.dll",
    "avutil-56.dll",
    "postproc-55.dll",
    "swresample-3.dll",
    "swscale-5.dll",
];

/// PID of the spawned service (if we own it), for kill-on-shell-exit.
/// Stored as Option so a missing service is gracefully a no-op on drop.
static SERVICE_PID: Mutex<Option<u32>> = Mutex::new(None);

/// Public entry: idempotent. Returns Ok(true) if the service is reachable
/// on port 11470 by the time we return.
pub fn ensure_started() -> Result<bool> {
    if is_alive() {
        debug!("streaming server already alive on 127.0.0.1:11470 — reusing");
        return Ok(true);
    }

    let exe = ensure_extracted_and_locate_binary()
        .context("ensure_extracted_and_locate_binary")?;
    let log_path = log_file_path()?;
    info!(exe = %exe.display(), log = %log_path.display(), "spawning stremio-service");

    // Stremio ships server-settings.json with very conservative BT limits:
    // 55 connections, 3.5 MB/s hard cap, 2GB cache. On a 4K HEVC stream at
    // ~25 Mbps with 700 seeders, the 3.5 MB/s cap is below playback rate
    // and produces the relentless play-1s/buffer-10s cycle. We overwrite
    // the file with aggressive defaults before spawn — the runtime reads
    // this at startup, so the new caps take effect on next spawn.
    if let Err(e) = write_optimal_server_settings() {
        warn!(error = ?e, "could not write optimal server-settings.json — runtime will use defaults");
    }

    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("open service log {}", log_path.display()))?;
    let log_clone = log_file
        .try_clone()
        .with_context(|| "clone log file handle")?;

    // CREATE_NO_WINDOW = 0x08000000 — keeps the service from popping a
    // console. DETACHED_PROCESS would also work but breaks stdout pipe.
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    // `stremio-runtime.exe` is a packaged Node.js — it needs the script
    // path (`server.js`) as argv[1] and the working dir set to the dir
    // containing server.js + the ffmpeg DLLs. Without these args it
    // silently exits and 11470 never binds. The legacy launcher wrapper
    // (`stremio-service.exe`) did this for us but also ran an auto-updater
    // we don't want.
    let exe_dir = exe
        .parent()
        .ok_or_else(|| anyhow!("service exe has no parent dir"))?;
    let is_runtime = exe
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("stremio-runtime.exe"))
        .unwrap_or(false);
    let mut cmd = Command::new(&exe);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_clone))
        .env("RUST_LOG", "info")
        .current_dir(exe_dir)
        .creation_flags(CREATE_NO_WINDOW);
    if is_runtime {
        cmd.arg("server.js");
    }
    let child = cmd
        .spawn()
        .with_context(|| format!("spawn {}", exe.display()))?;

    let pid = child.id();
    {
        let mut guard = SERVICE_PID.lock().unwrap();
        *guard = Some(pid);
    }
    // Don't .wait() — fire-and-forget. The Child handle drops here but
    // the OS process continues running; we kill by PID later if needed.
    std::mem::forget(child);

    info!(pid, "stremio-service spawned, waiting for it to bind 11470");
    wait_for_listening(Duration::from_secs(15))
}

/// Forcefully kill the spawned service via taskkill /T /F. Called on
/// shell shutdown. No-op if we never spawned one (e.g. we reused an
/// existing Stremio Desktop's service).
pub fn kill_owned_process() {
    let pid_opt = SERVICE_PID.lock().unwrap().take();
    if let Some(pid) = pid_opt {
        info!(pid, "killing owned stremio-service");
        // CREATE_NO_WINDOW for the taskkill itself too.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn ensure_extracted_and_locate_binary() -> Result<PathBuf> {
    let zip_path = locate_zip()?;
    let target_dir = appdata_blissful()?.join("stremio-service");
    fs::create_dir_all(&target_dir).with_context(|| format!("create {}", target_dir.display()))?;

    let marker = target_dir.join(".ready");
    if !marker.exists() {
        info!(zip = %zip_path.display(), target = %target_dir.display(), "extracting stremio-service.zip");
        extract_zip(&zip_path, &target_dir)?;
        fs::write(
            &marker,
            chrono_like_now_iso()
                .unwrap_or_else(|| "extracted".to_string())
                .as_bytes(),
        )
        .ok();
    } else {
        debug!(target = %target_dir.display(), "stremio-service already extracted");
    }

    copy_ffmpeg_dlls(&target_dir).ok(); // non-fatal — service may not need them all
    let exe = find_service_binary(&target_dir)
        .ok_or_else(|| anyhow!("no *service*.exe found under {}", target_dir.display()))?;
    Ok(exe)
}

/// Locate the bundled zip. Dev: `<crate_root>/resources/stremio-service.zip`.
/// Production: same path relative to the installed exe.
fn locate_zip() -> Result<PathBuf> {
    let exe_dir = std::env::current_exe()?
        .parent()
        .map(|p| p.to_path_buf())
        .context("exe parent")?;
    let candidates = [
        // Flat install layout (MSI ships everything directly next to the
        // exe, so installed builds find the zip here).
        exe_dir.join("stremio-service.zip"),
        // Dev / source-tree layout: resources/ subfolder.
        exe_dir.join("resources").join("stremio-service.zip"),
        exe_dir.join("../../resources/stremio-service.zip"),
        exe_dir.join("../../../resources/stremio-service.zip"),
    ];
    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }
    Err(anyhow!("stremio-service.zip not found; looked at {:?}", candidates))
}

fn appdata_blissful() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").context("APPDATA env")?;
    let dir = PathBuf::from(appdata).join("Blissful");
    fs::create_dir_all(&dir).ok();
    Ok(dir)
}

/// Overwrite stremio-server's `server-settings.json` with aggressive BT
/// limits so 4K HEVC streams aren't throttled by the 3.5 MB/s default cap.
/// The runtime reads this file on startup (it's the same path Stremio
/// Desktop uses, %APPDATA%/stremio/stremio-server/). If Stremio Desktop is
/// installed on the same machine it will overwrite our values when it
/// runs; that's fine — we re-write before every Blissful runtime spawn.
fn write_optimal_server_settings() -> Result<()> {
    let appdata = std::env::var("APPDATA").context("APPDATA env")?;
    let server_dir = PathBuf::from(&appdata).join("stremio").join("stremio-server");
    fs::create_dir_all(&server_dir).ok();
    let settings_path = server_dir.join("server-settings.json");
    let app_path = server_dir.to_string_lossy().replace('\\', "\\\\");
    let body = format!(
        r#"{{
    "serverVersion": "4.20.16",
    "appPath": "{app}",
    "cacheRoot": "{app}",
    "cacheSize": 107374182400,
    "btMaxConnections": 200,
    "btHandshakeTimeout": 20000,
    "btRequestTimeout": 4000,
    "btDownloadSpeedSoftLimit": 104857600,
    "btDownloadSpeedHardLimit": 209715200,
    "btMinPeersForStable": 2,
    "remoteHttps": "",
    "localAddonEnabled": false,
    "transcodeHorsepower": 0.75,
    "transcodeMaxBitRate": 0,
    "transcodeConcurrency": 1,
    "transcodeTrackConcurrency": 1,
    "transcodeHardwareAccel": true,
    "transcodeProfile": null,
    "allTranscodeProfiles": ["nvenc-win", "amf"],
    "transcodeMaxWidth": 1920,
    "proxyStreamsEnabled": false
}}
"#,
        app = app_path
    );
    fs::write(&settings_path, body)
        .with_context(|| format!("write {}", settings_path.display()))?;
    info!(path = %settings_path.display(), "wrote optimal server-settings.json");
    Ok(())
}

fn log_file_path() -> Result<PathBuf> {
    Ok(appdata_blissful()?.join("stremio-service.log"))
}

fn extract_zip(zip_path: &Path, target_dir: &Path) -> Result<()> {
    let f = fs::File::open(zip_path)
        .with_context(|| format!("open zip {}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(f).context("read zip archive")?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("zip entry")?;
        let outpath = match entry.enclosed_name() {
            Some(p) => target_dir.join(p),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&outpath).ok();
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).ok();
        }
        let mut out = fs::File::create(&outpath)
            .with_context(|| format!("create {}", outpath.display()))?;
        io::copy(&mut entry, &mut out).context("zip extract copy")?;
    }
    Ok(())
}

fn find_service_binary(root: &Path) -> Option<PathBuf> {
    // Prefer `stremio-runtime.exe` (the actual streaming server) over
    // `stremio-service.exe` (a launcher wrapper that includes an auto-
    // updater). The updater downloads new versions over the network and
    // hands off control to whichever binary it finds — in practice that's
    // Stremio Desktop's installed `stremio-runtime.exe` if present, which
    // makes our streaming server's behavior depend on whether Stremio
    // Desktop is installed. Spawning the runtime directly keeps us on
    // the version we shipped in the bundled zip.
    let mut queue: Vec<PathBuf> = vec![root.to_path_buf()];
    let mut runtime: Option<PathBuf> = None;
    let mut service: Option<PathBuf> = None;
    while let Some(current) = queue.pop() {
        let Ok(entries) = fs::read_dir(&current) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                queue.push(path);
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower == "stremio-runtime.exe" {
                    runtime = Some(path);
                } else if lower.ends_with(".exe")
                    && lower.contains("stremio")
                    && lower.contains("service")
                {
                    service = Some(path);
                }
            }
        }
    }
    runtime.or(service)
}

fn copy_ffmpeg_dlls(target_dir: &Path) -> Result<()> {
    let missing: Vec<&&str> = REQUIRED_FFMPEG_DLLS
        .iter()
        .filter(|dll| !target_dir.join(dll).exists())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    debug!(count = missing.len(), "copying ffmpeg DLLs into stremio-service dir");

    let mut sources: Vec<PathBuf> = vec![];
    if let Ok(crate_dir) = std::env::current_exe().and_then(|p| {
        p.parent()
            .map(|x| x.to_path_buf())
            .ok_or_else(|| io::Error::other("no parent"))
    }) {
        // Flat install layout: WiX MSI stages the ffmpeg DLLs directly
        // alongside blissful-shell.exe (no ffmpeg-dlls/ subfolder).
        sources.push(crate_dir.clone());
        sources.push(crate_dir.join("resources").join("ffmpeg-dlls"));
        sources.push(crate_dir.join("../../resources/ffmpeg-dlls"));
    }
    // Fall back to existing Stremio Desktop install — works for users who
    // already have it installed.
    if let Some(stremio) = find_stremio_desktop_dir() {
        sources.push(stremio);
    }

    for src_dir in &sources {
        if !src_dir.is_dir() {
            continue;
        }
        for dll in &missing {
            let src = src_dir.join(dll);
            let dst = target_dir.join(dll);
            if !src.exists() || dst.exists() {
                continue;
            }
            if let Err(e) = fs::copy(&src, &dst) {
                warn!(dll = %dll, error = ?e, "ffmpeg DLL copy failed");
            }
        }
    }
    Ok(())
}

fn find_stremio_desktop_dir() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("STREMIO_DESKTOP_DIR") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Some(p);
        }
    }
    let local_appdata = std::env::var("LOCALAPPDATA").ok()?;
    let candidates = [
        PathBuf::from(&local_appdata).join("Programs/LNV/Stremio-4"),
        PathBuf::from(&local_appdata).join("Programs/Stremio"),
        PathBuf::from(&local_appdata).join("Programs/Stremio-4"),
    ];
    candidates.into_iter().find(|c| c.exists())
}

/// Quick TCP probe — connect with a tight timeout.
pub fn is_alive() -> bool {
    let addr = "127.0.0.1:11470".parse().unwrap();
    match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => {
            let _ = stream.shutdown(Shutdown::Both);
            true
        }
        Err(_) => false,
    }
}

fn wait_for_listening(timeout: Duration) -> Result<bool> {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if is_alive() {
            info!("stremio-service is listening on 11470");
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(350));
    }
    warn!("stremio-service did not bind 11470 within timeout");
    Ok(false)
}

/// Simple ISO-ish timestamp for the .ready marker — avoids chrono dep.
fn chrono_like_now_iso() -> Option<String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(format!("{}", now.as_secs()))
}
