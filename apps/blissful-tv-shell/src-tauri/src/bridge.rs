// The single Tauri command behind `window.blissfulDesktop.call(command, args)`.
//
// The React UI talks to the shell through exactly two primitives:
//   desktop.call(command, args) -> Promise<result>
//   desktop.on(event, cb)       -> unsubscribe
// (see apps/blissful-mvs/src/lib/desktop.ts). On Windows those ride a
// WebView2 postMessage shim; here `call` maps to this `invoke('bridge', …)`
// and `on` maps to Tauri's event listener (see apps/blissful-mvs/src/lib/
// tauriBridge.ts). Tauri's invoke already correlates request↔response, so the
// {id,…} framing the WebView2 shim needed is unnecessary.
//
// STATUS: Phase 0 scaffold. Lifecycle/version/log/update commands are real.
// Player + streaming-server commands are deliberate stubs that DEGRADE
// GRACEFULLY (no throw) so the UI renders and non-player flows work before the
// native player (Phase 2) lands. See SPEC.md §"Phased plan".

use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub async fn bridge(app: AppHandle, command: String, args: Option<Value>) -> Result<Value, String> {
    match command.as_str() {
        // ---- core / lifecycle (real) ----
        "getAppVersion" => Ok(json!(app.package_info().version.to_string())),
        "log" => {
            let line = args
                .as_ref()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| args.map(|v| v.to_string()).unwrap_or_default());
            log::info!("[renderer] {line}");
            Ok(Value::Null)
        }

        // ---- streaming server ----
        // RD-only v1: return `true` (ready). The UI awaits this before EVERY
        // load (NativeMpvPlayer.tsx:1109), so returning `false` would block RD
        // playback too — and RD streams are direct HTTPS that don't need a
        // server. The magnet/torrent branch builds 127.0.0.1:11470 URLs and
        // must be routed to a friendly "Real-Debrid required / torrents coming
        // later" state in Phase 2 (it must not throw). See docs/PHASE2-PLAN.md.
        "ensureStreamingServer" => Ok(json!(true)),

        // ---- player controls → native libmpv-android plugin (see mpv.rs) ----
        // On Android these forward to the Kotlin MPVLib plugin; on desktop they
        // no-op. The allowlist + seek `+exact` live in mpv.rs.
        "play" => crate::mpv::play(&app),
        "pause" => crate::mpv::pause(&app),
        "seek" => crate::mpv::seek(&app, args),
        "mpv.command" => crate::mpv::command(&app, args),
        "mpv.setProperty" => crate::mpv::set_property(&app, args),
        "mpv.getTracks" => crate::mpv::get_tracks(&app),
        "mpv.getChapters" => crate::mpv::get_chapters(&app),
        "openPlayer" => Ok(Value::Null),

        // ---- window / fullscreen: always-immersive on TV ----
        "toggleFullscreen" | "isFullscreen" => Ok(json!(true)),

        // ---- updates: notify-only (no download/install on Android) ----
        "getUpdateStatus" => crate::updater::get_status(&app).await,
        "downloadUpdate" | "installUpdate" => {
            Err("update-install-not-supported-on-android".to_string())
        }

        other => Err(format!("unknown-command: {other}")),
    }
}
