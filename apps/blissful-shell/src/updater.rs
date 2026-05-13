// Phase 6 — auto-updater. Polls GitHub Releases for newer tags, downloads
// the installer to %TEMP%, fires renderer IPC events so the existing
// useDesktopUpdater toast flow works unchanged.
//
// Architecture:
//   - A dedicated Tokio thread (separate from the UI server's runtime so
//     a stuck HTTP fetch can't block proxy traffic) runs `check_loop`.
//   - Initial check fires shortly after launch (15 s grace so the user
//     doesn't get hit with an update offer the moment the window opens).
//   - Then a 30-minute polling interval; matches the Electron build's
//     cadence (CLAUDE.md notes the existing update path checks on load
//     + every 30 min).
//   - GitHub API returns the latest release JSON; we extract `tag_name`
//     (semver), compare to `env!("CARGO_PKG_VERSION")`, and if newer
//     pick the Windows installer asset (first asset whose name ends in
//     `.exe`). Renderer-bound `update-available` event fires once we
//     know we have something to offer.
//   - On `downloadUpdate` IPC: pull the .exe to `%TEMP%/Blissful-Update.exe`,
//     fire `update-downloaded` when finished.
//   - On `installUpdate` IPC: spawn the installer with /SILENT + quit
//     the shell. Installer takes over from there.
//
// Integrity verification: each release publishes a `<installer>.sha256`
// sidecar asset (single-line `sha256sum`-style: hex hash + two spaces +
// filename). We fetch it alongside the installer URL during the version
// check, then after downloading the installer we recompute the SHA-256
// and refuse to spawn on mismatch. This closes the auto-update RCE path
// even before Authenticode signing lands (the sidecar is published by the
// same CI job that builds the installer, so an attacker who controls the
// release artifact would also need to control the sidecar — at which
// point Authenticode is the next layer).
//
// Authenticode signature verification (Phase 7) is still pending SignPath
// approval; once it ships, `WinVerifyTrust` will run after the SHA check
// as a second integrity gate.

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::ipc::protocol::{Event as IpcEvent, Outgoing};
use crate::state::post_outgoing;

const GITHUB_REPO: &str = "SilentGTX/Blissful";
const USER_AGENT: &str = concat!("blissful-shell/", env!("CARGO_PKG_VERSION"));
/// Brief delay before the first check so the WebView2 host finishes its
/// initial paint before the toast can race in. Anything less than ~1 s
/// risks the toast rendering before the React app has mounted; anything
/// more is wasted latency on a path the user explicitly notices ("why
/// is the update prompt slow to appear?").
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(2);
/// Cadence after the first check. Matches the Electron auto-updater.
const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The release's tag, with the leading "v" stripped — e.g. "0.5.1".
    pub version: String,
    /// Direct URL to the .exe / .msi installer asset on GitHub.
    pub installer_url: String,
    /// Direct URL to the `<installer>.sha256` sidecar asset published by
    /// the release workflow. Used to verify the downloaded installer
    /// before it's spawned. Optional only for backward compatibility
    /// with older releases that predate sidecar publishing; missing
    /// sidecar means we refuse to install (better to leave users on the
    /// old version than to install an unverified installer).
    #[serde(default)]
    pub sha256_url: Option<String>,
}

/// Last known available update (set by the polling task). Used by the
/// `downloadUpdate` IPC handler so it doesn't have to refetch.
static AVAILABLE: Mutex<Option<UpdateInfo>> = Mutex::new(None);
/// Path the installer was downloaded to. Used by `installUpdate` to know
/// what to spawn.
static DOWNLOADED_INSTALLER: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Spawn the polling thread. Returns immediately.
pub fn spawn_in_background() -> Result<()> {
    std::thread::Builder::new()
        .name("auto-updater".into())
        .spawn(|| {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    error!(error = ?e, "auto-updater: failed to build tokio runtime");
                    return;
                }
            };
            rt.block_on(check_loop());
        })
        .context("spawn auto-updater thread")?;
    Ok(())
}

async fn check_loop() {
    tokio::time::sleep(FIRST_CHECK_DELAY).await;
    loop {
        match check_once().await {
            Ok(Some(info)) => {
                info!(version = %info.version, "auto-updater: new release available");
                {
                    let mut guard = AVAILABLE.lock().unwrap();
                    *guard = Some(info.clone());
                }
                post_outgoing(&Outgoing::Event(IpcEvent {
                    event: "update-available".to_string(),
                    data: serde_json::json!(info.version),
                }));
            }
            Ok(None) => info!("auto-updater: already on latest"),
            // Bumped to warn! (was debug!) so silent failures actually land
            // in the player.log file the shell writes. With windows_subsystem
            // = "windows" closing stderr in release builds, debug-level
            // tracing is invisible — a check that consistently fails (DNS,
            // TLS, parse) leaves no trail for diagnosis.
            Err(e) => warn!(error = ?e, "auto-updater: check failed (non-fatal)"),
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

/// Pull-style accessor — returns the last update the background poller
/// found, or None if either no check has run yet or the running version
/// is already latest. The renderer polls this on mount + on a timer to
/// work around the event-only firing of `update-available`, which is
/// lossy if the React app hasn't finished mounting by the 15-second
/// initial-check mark (next poll is 30 minutes out otherwise).
pub fn get_available() -> Option<UpdateInfo> {
    AVAILABLE.lock().unwrap().clone()
}

/// Combined pull-style status — available update info plus whether the
/// installer has finished downloading. Renderer polls this on mount and
/// every 30 seconds so a React app that subscribes after the first
/// event fires can still pick up the state (the events themselves are
/// reliable across threads now that outgoing events go through the
/// state::OUTGOING_TX channel + NWG Notice — see state.rs).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub available: Option<UpdateInfo>,
    pub downloaded: bool,
}

pub fn get_status() -> UpdateStatus {
    UpdateStatus {
        available: AVAILABLE.lock().unwrap().clone(),
        downloaded: DOWNLOADED_INSTALLER.lock().unwrap().is_some(),
    }
}

/// One-shot check. Returns Some(info) only if a newer tag exists with a
/// downloadable .exe asset.
pub async fn check_once() -> Result<Option<UpdateInfo>> {
    let client = http_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("GitHub releases fetch")?;
    if !resp.status().is_success() {
        return Err(anyhow!("GitHub returned status {}", resp.status()));
    }
    let release: GithubRelease = resp.json().await.context("parse release JSON")?;
    let current = env!("CARGO_PKG_VERSION");
    pick_update(&release, current)
}

/// Pure asset-selection logic split out of `check_once` so unit tests
/// can drive it without going through the network. Returns:
///   - `Ok(None)` if `release.tag_name` is not newer than `current`
///   - `Ok(Some(UpdateInfo))` if a newer tag with a downloadable
///     installer asset exists
///   - `Err` if the tag isn't valid semver or no installer asset is
///     attached to the release
fn pick_update(release: &GithubRelease, current: &str) -> Result<Option<UpdateInfo>> {
    let tag = release.tag_name.trim_start_matches('v').to_string();
    let latest = semver::Version::parse(&tag).context("parse tag semver")?;
    let current = semver::Version::parse(current).context("parse current as semver")?;
    if latest <= current {
        return Ok(None);
    }

    // Pick the first installer asset. WiX-built MSI preferred (Phase 7
    // ships .msi); NSIS .exe accepted as a fallback for the transition.
    let installer = release
        .assets
        .iter()
        .find(|a| {
            let n = a.name.to_ascii_lowercase();
            n.ends_with(".msi") || n.ends_with(".exe")
        })
        .ok_or_else(|| anyhow!("no .msi/.exe asset on release {}", release.tag_name))?;

    // Match the corresponding `<installer>.sha256` sidecar. The release
    // workflow publishes both together; if the sidecar is missing we
    // still surface the update offer so the renderer's status query
    // works, but `download_available` will refuse to proceed without
    // one. The sidecar lookup is name-driven (not "first .sha256") so
    // we don't accidentally bind to a hash for a different asset on
    // releases that ever ship more than one installer flavor.
    let sha_name = format!("{}.sha256", installer.name);
    let sidecar = release.assets.iter().find(|a| a.name == sha_name);

    Ok(Some(UpdateInfo {
        version: tag,
        installer_url: installer.browser_download_url.clone(),
        sha256_url: sidecar.map(|a| a.browser_download_url.clone()),
    }))
}

/// Pure sidecar-parser split out of `fetch_sidecar_hash` for unit
/// testing. The sidecar format is `sha256sum`-compatible: first line,
/// hex digest as the first whitespace-delimited token.
fn parse_sidecar(body: &str) -> Result<String> {
    let first_line = body.lines().next().unwrap_or("").trim();
    let hex = first_line
        .split_whitespace()
        .next()
        .ok_or_else(|| anyhow!("sidecar empty"))?
        .to_ascii_lowercase();
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(anyhow!("sidecar hash not 64 hex chars: {hex}"));
    }
    Ok(hex)
}

/// Fetch the SHA-256 sidecar published by CI and return just the hex
/// hash. Delegates parsing to `parse_sidecar` so the format-handling
/// half is unit-testable without standing up an HTTP server.
async fn fetch_sidecar_hash(client: &Client, url: &str) -> Result<String> {
    let resp = client.get(url).send().await.context("fetch sidecar")?;
    if !resp.status().is_success() {
        return Err(anyhow!("sidecar returned status {}", resp.status()));
    }
    let body = resp.text().await.context("read sidecar body")?;
    parse_sidecar(&body)
}

/// Compute SHA-256 of a file on disk and return the lowercase hex
/// digest. Streams the file rather than reading the whole installer
/// into memory (release artifacts are 100+ MB).
fn hash_file(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .with_context(|| format!("open {} for hashing", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).context("read while hashing")?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Download the cached available update to %TEMP%. Returns path to the
/// downloaded installer. Fires the `update-downloaded` Event on success
/// so the renderer's hook shows the "Update & Restart" toast.
///
/// Integrity flow:
///   1. Refuse to start if the release didn't publish a `.sha256`
///      sidecar — better to keep the user on the current version than
///      to install an unverified installer.
///   2. Fetch the sidecar before the installer (small payload, fast).
///   3. Stream the installer to a temp `.part` file.
///   4. Recompute SHA-256, compare against the sidecar.
///   5. On match: rename to the final path + record + emit
///      `update-downloaded`. On mismatch: delete the partial and emit
///      an error event so the renderer surfaces a clear failure
///      instead of a hung "downloading…" toast.
pub async fn download_available() -> Result<PathBuf> {
    let info = {
        let guard = AVAILABLE.lock().unwrap();
        guard
            .clone()
            .ok_or_else(|| anyhow!("no update available to download"))?
    };

    let sha_url = info.sha256_url.as_deref().ok_or_else(|| {
        anyhow!(
            "release {} has no .sha256 sidecar — refusing to install \
             unverified installer",
            info.version
        )
    })?;

    let client = http_client()?;

    // 1. Pull the sidecar first. If this fails we abort BEFORE writing
    //    any bytes to disk, so a flaky sidecar URL never leaves an
    //    orphan installer in %TEMP%.
    let expected_hash = fetch_sidecar_hash(&client, sha_url)
        .await
        .with_context(|| format!("fetch SHA-256 sidecar {sha_url}"))?;

    // 2. Stream the installer to a `.part` file. Renaming to the final
    //    name only on hash success means a partial download never
    //    becomes a candidate for `installUpdate`.
    let mut resp = client
        .get(&info.installer_url)
        .send()
        .await
        .context("installer fetch")?;
    if !resp.status().is_success() {
        return Err(anyhow!(
            "installer download returned status {}",
            resp.status()
        ));
    }

    let dir = std::env::temp_dir();
    let ext = if info.installer_url.to_ascii_lowercase().ends_with(".msi") {
        "msi"
    } else {
        "exe"
    };
    let target = dir.join(format!("Blissful-Update-{}.{}", info.version, ext));
    let part = target.with_extension(format!("{ext}.part"));
    let mut file = tokio::fs::File::create(&part)
        .await
        .with_context(|| format!("create installer part {}", part.display()))?;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await.context("read chunk")? {
        file.write_all(&chunk).await.context("write chunk")?;
    }
    file.flush().await.ok();
    drop(file);

    // 3. Verify the hash before promoting `.part` to the final name.
    let actual = hash_file(&part).context("hash downloaded installer")?;
    if actual != expected_hash {
        // Best-effort cleanup; the worst case is a stale .part that
        // gets overwritten on the next attempt.
        let _ = std::fs::remove_file(&part);
        return Err(anyhow!(
            "installer SHA-256 mismatch: expected {expected_hash}, got {actual}"
        ));
    }
    std::fs::rename(&part, &target).with_context(|| {
        format!("promote {} to {}", part.display(), target.display())
    })?;

    info!(
        path = %target.display(),
        version = %info.version,
        sha256 = %actual,
        "installer downloaded and verified",
    );
    {
        let mut guard = DOWNLOADED_INSTALLER.lock().unwrap();
        *guard = Some(target.clone());
    }
    post_outgoing(&Outgoing::Event(IpcEvent {
        event: "update-downloaded".to_string(),
        data: serde_json::Value::Null,
    }));
    Ok(target)
}

/// Spawn the downloaded installer with /SILENT, quit the shell so it can
/// replace blissful-shell.exe. Caller is responsible for the actual
/// process exit after the installer is spawned (we call
/// `nwg::stop_thread_dispatch()` from main_window's IPC handler).
pub fn spawn_installer_and_quit() -> Result<()> {
    let path = {
        let guard = DOWNLOADED_INSTALLER.lock().unwrap();
        guard
            .clone()
            .ok_or_else(|| anyhow!("installUpdate called but no installer downloaded yet"))?
    };
    info!(path = %path.display(), "spawning installer + quitting shell");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "msi" {
        // MSI: dispatched through Windows Installer.
        std::process::Command::new("msiexec")
            .args(["/i", path.to_string_lossy().as_ref(), "/quiet", "/norestart"])
            .spawn()
            .with_context(|| format!("spawn msiexec for {}", path.display()))?;
    } else {
        // WiX Burn bundle. Two problems being solved:
        //
        // 1. The flag — Burn uses /passive (brief progress UI, no
        //    user interaction) or /quiet (no UI at all). /SILENT is
        //    Inno Setup's convention; Burn silently ignores it.
        //
        // 2. Auto-relaunch — Burn's /passive does NOT trigger the
        //    bootstrapper's "Launch when finished" action, so without
        //    a chained relaunch the user ends up staring at a closed
        //    window after a successful install. We chain in a
        //    generated temp .bat: run the installer, then `start` the
        //    freshly-installed blissful-shell.exe. Single `&` (not
        //    `&&`) so the relaunch fires even on no-op installs and
        //    the user always gets their app back.
        //
        // Why a .bat file rather than `cmd /C <chain>`: Rust's
        // Command::arg escapes quotes with backslash-quote (Win32
        // convention), but cmd's /C parser interprets `\"` as a
        // literal backslash followed by a quote — mangling the chain
        // into garbage like `'\"installer-path\"'`. Writing the
        // chain to a .bat and spawning that sidesteps the escaping
        // problem entirely; cmd reads the file content directly with
        // its normal parser.
        let installer = path.to_string_lossy();
        let program_files = std::env::var("ProgramFiles")
            .unwrap_or_else(|_| "C:\\Program Files".into());
        let shell_exe = format!("{program_files}\\Blissful\\blissful-shell.exe");
        let bat_content = format!(
            "@echo off\r\n\"{installer}\" /passive /norestart\r\nstart \"\" \"{shell_exe}\"\r\n"
        );
        let bat_path = std::env::temp_dir().join("blissful-update.bat");
        std::fs::write(&bat_path, bat_content)
            .with_context(|| format!("write update launcher {}", bat_path.display()))?;
        // Windows CreateProcess resolves the .bat extension to cmd.exe
        // automatically. CREATE_NO_WINDOW (0x08000000) suppresses the
        // console window cmd would otherwise pop while running the
        // .bat — without it the user sees a black terminal flash
        // between clicking "Update & Restart" and the new Blissful
        // appearing. The installer's own /passive progress UI is a
        // separate window, unaffected.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new(&bat_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .with_context(|| format!("spawn update launcher {}", bat_path.display()))?;
    }
    Ok(())
}

fn http_client() -> Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        // `connect_timeout` only — no total request timeout. The
        // 30-second total timeout was killing installer downloads
        // mid-stream around the 95 MB mark on ~25 Mbps connections
        // (99.8 MB / 3.3 MB/s = 30s — anything slower than that and
        // reqwest would tear down the response before completion,
        // leaving the renderer waiting forever for an
        // `update-downloaded` event that never fired). The connect
        // timeout still guards against DNS/TLS hangs on a dead host.
        .connect_timeout(Duration::from_secs(15))
        .build()
        .context("build updater HTTP client")
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_asset(name: &str) -> GithubAsset {
        GithubAsset {
            name: name.to_string(),
            browser_download_url: format!("https://example/{name}"),
        }
    }

    fn mk_release(tag: &str, assets: Vec<GithubAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            assets,
        }
    }

    #[test]
    fn pick_update_returns_none_when_already_latest() {
        let release = mk_release(
            "v1.0.0",
            vec![mk_asset("BlissfulSetup-1.0.0.exe"), mk_asset("BlissfulSetup-1.0.0.exe.sha256")],
        );
        let result = pick_update(&release, "1.0.0").unwrap();
        assert!(result.is_none(), "same version should not be an update");
    }

    #[test]
    fn pick_update_returns_none_when_running_newer() {
        let release = mk_release("v1.0.0", vec![mk_asset("BlissfulSetup-1.0.0.exe")]);
        let result = pick_update(&release, "1.1.0").unwrap();
        assert!(result.is_none(), "running 1.1 should not update to 1.0");
    }

    #[test]
    fn pick_update_strips_v_prefix() {
        let release = mk_release("v2.0.0", vec![mk_asset("BlissfulSetup-2.0.0.exe")]);
        let info = pick_update(&release, "1.0.0").unwrap().unwrap();
        assert_eq!(info.version, "2.0.0", "leading v must be stripped");
    }

    #[test]
    fn pick_update_returns_info_for_newer_tag() {
        let release = mk_release(
            "v2.0.0",
            vec![
                mk_asset("BlissfulSetup-2.0.0.exe"),
                mk_asset("BlissfulSetup-2.0.0.exe.sha256"),
            ],
        );
        let info = pick_update(&release, "1.0.0").unwrap().unwrap();
        assert_eq!(info.version, "2.0.0");
        assert!(info.installer_url.ends_with("BlissfulSetup-2.0.0.exe"));
        assert!(info.sha256_url.is_some(), "sidecar must be picked up");
    }

    #[test]
    fn pick_update_prefers_msi_over_exe_for_assets_but_keeps_first_found() {
        // Both .msi and .exe present; first-asset-wins semantics — we
        // don't have an explicit preference today, this guards the
        // tie-break behavior so a renderer redesign doesn't silently
        // change which file gets downloaded.
        let release = mk_release(
            "v2.0.0",
            vec![
                mk_asset("BlissfulSetup-2.0.0.msi"),
                mk_asset("BlissfulSetup-2.0.0.exe"),
            ],
        );
        let info = pick_update(&release, "1.0.0").unwrap().unwrap();
        assert!(info.installer_url.ends_with(".msi"));
    }

    #[test]
    fn pick_update_sidecar_must_match_installer_name() {
        // If the sidecar's name doesn't match `<installer>.sha256`,
        // we must NOT bind to it — that would point the updater at a
        // hash for the wrong file.
        let release = mk_release(
            "v2.0.0",
            vec![
                mk_asset("BlissfulSetup-2.0.0.exe"),
                mk_asset("SomethingElse.sha256"),
            ],
        );
        let info = pick_update(&release, "1.0.0").unwrap().unwrap();
        assert!(info.sha256_url.is_none());
    }

    #[test]
    fn pick_update_errors_when_no_installer_asset() {
        let release = mk_release(
            "v2.0.0",
            vec![mk_asset("source-code.zip"), mk_asset("notes.txt")],
        );
        assert!(pick_update(&release, "1.0.0").is_err());
    }

    #[test]
    fn pick_update_errors_on_invalid_tag_semver() {
        let release = mk_release("not-a-version", vec![mk_asset("foo.exe")]);
        assert!(pick_update(&release, "1.0.0").is_err());
    }

    #[test]
    fn parse_sidecar_accepts_sha256sum_format() {
        let body = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  BlissfulSetup-1.0.0.exe\n";
        let hash = parse_sidecar(body).unwrap();
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn parse_sidecar_accepts_uppercase_hex_and_normalises() {
        let body = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789  Foo.exe";
        let hash = parse_sidecar(body).unwrap();
        assert_eq!(hash, hash.to_lowercase(), "must return lowercase");
    }

    #[test]
    fn parse_sidecar_rejects_short_hash() {
        let body = "abcdef  Foo.exe";
        assert!(parse_sidecar(body).is_err());
    }

    #[test]
    fn parse_sidecar_rejects_non_hex() {
        let body = "ZZZdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  Foo.exe";
        assert!(parse_sidecar(body).is_err());
    }

    #[test]
    fn parse_sidecar_rejects_empty() {
        assert!(parse_sidecar("").is_err());
        assert!(parse_sidecar("\n\n").is_err());
    }
}
