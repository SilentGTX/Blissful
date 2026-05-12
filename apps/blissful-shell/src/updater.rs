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
// Authenticode signature verification is deferred to Phase 7. Without a
// signed installer to test against, sig-check code is theoretical noise.
// Once Phase 7 ships, this module's `download_update` will call
// `WinVerifyTrust` on the downloaded file before firing update-downloaded.

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tracing::{debug, error, info, warn};

use crate::ipc::protocol::{Event as IpcEvent, Outgoing};
use crate::state::post_outgoing;

const GITHUB_REPO: &str = "SilentGTX/Blissful";
const USER_AGENT: &str = concat!("blissful-shell/", env!("CARGO_PKG_VERSION"));
/// Wait before the first check fires so we don't bother the user the
/// instant the window appears.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
/// Cadence after the first check. Matches the Electron auto-updater.
const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct UpdateInfo {
    /// The release's tag, with the leading "v" stripped — e.g. "0.5.1".
    pub version: String,
    /// Direct URL to the .exe installer asset on GitHub.
    pub installer_url: String,
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
            Ok(None) => debug!("auto-updater: already on latest"),
            Err(e) => debug!(error = ?e, "auto-updater: check failed (non-fatal)"),
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
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
    let tag = release.tag_name.trim_start_matches('v').to_string();

    let latest = semver::Version::parse(&tag).context("parse tag semver")?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .context("parse CARGO_PKG_VERSION as semver")?;
    if latest <= current {
        return Ok(None);
    }

    // Pick the first installer asset. WiX-built MSI preferred (Phase 7
    // ships .msi); NSIS .exe accepted as a fallback for the transition.
    let asset = release
        .assets
        .into_iter()
        .find(|a| {
            let n = a.name.to_ascii_lowercase();
            n.ends_with(".msi") || n.ends_with(".exe")
        })
        .ok_or_else(|| anyhow!("no .msi/.exe asset on release {}", release.tag_name))?;

    Ok(Some(UpdateInfo {
        version: tag,
        installer_url: asset.browser_download_url,
    }))
}

/// Download the cached available update to %TEMP%. Returns path to the
/// downloaded installer. Fires the `update-downloaded` Event on success
/// so the renderer's hook shows the "Update & Restart" toast.
pub async fn download_available() -> Result<PathBuf> {
    let info = {
        let guard = AVAILABLE.lock().unwrap();
        guard
            .clone()
            .ok_or_else(|| anyhow!("no update available to download"))?
    };

    let client = http_client()?;
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
    let mut file = tokio::fs::File::create(&target)
        .await
        .with_context(|| format!("create installer file {}", target.display()))?;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await.context("read chunk")? {
        file.write_all(&chunk).await.context("write chunk")?;
    }
    file.flush().await.ok();

    info!(path = %target.display(), version = %info.version, "installer downloaded");
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
        // NSIS / Inno / custom .exe installer — /SILENT is the de-facto
        // standard silent flag both NSIS and Inno honor.
        std::process::Command::new(&path)
            .arg("/SILENT")
            .spawn()
            .with_context(|| format!("spawn installer {}", path.display()))?;
    }
    Ok(())
}

fn http_client() -> Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
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
