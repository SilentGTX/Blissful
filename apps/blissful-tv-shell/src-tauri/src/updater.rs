// Notify-only update check. Android cannot silently download + run an
// installer the way the Windows shell's updater.rs does (and shouldn't), so
// this only TELLS the user a newer release exists and links them to it. No
// download, no install, no SHA-256 sidecar dance.
//
// Contract preserved for the existing UI hook (apps/blissful-mvs/src/hooks/
// useDesktopUpdater.ts): `getUpdateStatus` returns
//   { available: { version, installerUrl } | null, downloaded: boolean }
// with `downloaded` always false here. We also emit an `update-available`
// event on launch so the renderer's toast fires without polling.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const GITHUB_LATEST: &str = "https://api.github.com/repos/SilentGTX/Blissful/releases/latest";

/// Build a one-off reqwest client. GitHub's API rejects requests without a
/// User-Agent, so set one.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("blissful-tv-updater")
        .build()
        .expect("build updater reqwest client")
}

/// Fetch the latest release tag + best APK asset URL (falling back to the
/// release page). Returns None on any network/parse failure — the caller
/// treats that as "no update info".
async fn latest_release() -> Option<(String, String)> {
    let resp = client()
        .get(GITHUB_LATEST)
        .header("accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: Value = resp.json().await.ok()?;
    let tag = body.get("tag_name")?.as_str()?.trim_start_matches('v').to_string();

    // Prefer an .apk asset; otherwise the human-facing release page.
    let apk = body
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name")?.as_str()?;
                if name.ends_with(".apk") {
                    asset.get("browser_download_url")?.as_str().map(String::from)
                } else {
                    None
                }
            })
        });
    let url = apk
        .or_else(|| body.get("html_url").and_then(|u| u.as_str()).map(String::from))
        .unwrap_or_else(|| "https://github.com/SilentGTX/Blissful/releases/latest".to_string());

    Some((tag, url))
}

fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Very small "is the remote tag different from ours" check. Notify-only, so a
/// conservative string inequality is acceptable; a false positive at worst
/// shows a dismissible toast. (TODO: real semver compare if pre-release
/// ordering ever matters.)
fn is_newer(current: &str, remote: &str) -> bool {
    !remote.is_empty() && remote != current
}

/// Pull-style status for the `getUpdateStatus` bridge command.
pub async fn get_status(app: &AppHandle) -> Result<Value, String> {
    match latest_release().await {
        Some((version, url)) if is_newer(&current_version(app), &version) => Ok(json!({
            "available": { "version": version, "installerUrl": url },
            "downloaded": false
        })),
        _ => Ok(json!({ "available": null, "downloaded": false })),
    }
}

/// Background check fired once on launch; emits `update-available` (carrying the
/// version string, matching the desktop event payload) if a newer release is
/// found. Safe to call from a spawned task.
pub async fn spawn_check(app: &AppHandle) {
    if let Some((version, _url)) = latest_release().await {
        if is_newer(&current_version(app), &version) {
            let _ = app.emit("update-available", version);
        }
    }
}
