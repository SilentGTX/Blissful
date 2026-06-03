// Phase 2 player router. The `bridge` command (bridge.rs) forwards the player
// verbs here; on Android these call the in-crate Tauri plugin "blissful-mpv"
// (registered below), whose Kotlin side (android-mpv/*.kt) owns libmpv via
// MPVLib and the SurfaceView-under-transparent-WebView compositing. On desktop
// builds every arm is a no-op so `cargo run`/`cargo test` still compile.
//
// Security: the `mpv.command` allowlist is ported verbatim from the Windows
// shell (ipc/commands.rs::ALLOWED_MPV_COMMANDS) so a script-injected renderer
// can't reach mpv's `run`/`subprocess`/`load-script`. setProperty is forwarded
// as {name,value}; the Kotlin side routes Number -> setPropertyString (the
// critic-confirmed simplification over libmpv2's strict typed setters). `seek`
// gets the `+exact` mode suffix on the Kotlin side (frame-accurate, load-bearing
// for Skip-Intro + watch-party drift).
//
// STATUS: pre-spike scaffold. The Kotlin MPVLib signatures and the compositing
// must be validated on real TV hardware first (docs/PHASE2-SPIKE.md).

use serde_json::{json, Value};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};
// `Manager` (for app.manage / app.state) is only used on Android.
#[cfg(target_os = "android")]
use tauri::Manager;

/// Renderer-allowed `mpv.command` verbs. Ported from ipc/commands.rs:192-213.
/// Anything not here (run, subprocess, load-script, quit, …) is rejected.
const ALLOWED_MPV_COMMANDS: &[&str] = &[
    "loadfile",
    "stop",
    "seek",
    "set",
    "cycle",
    "frame-step",
    "frame-back-step",
    "screenshot",
    "screenshot-to-file",
    "sub-add",
    "sub-remove",
    "sub-reload",
    "audio-add",
    "audio-remove",
    "audio-reload",
    "playlist-clear",
    "playlist-next",
    "playlist-prev",
    "show-text",
    "osd-msg",
];

/// Register the in-crate Android plugin. Stores the PluginHandle so the verb
/// functions below can call into Kotlin via `run_mobile_plugin`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("blissful-mpv")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api
                    .register_android_plugin("com.blissful.tv.mpv", "BlissfulMpvPlugin")?;
                _app.manage(MpvHandle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
struct MpvHandle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Forward a call to the Kotlin plugin (Android only). Desktop returns the
/// supplied no-op default so the dev build runs without a player.
#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &AppHandle<R>, cmd: &str, payload: Value) -> Result<Value, String> {
    app.state::<MpvHandle<R>>()
        .0
        .run_mobile_plugin::<Value>(cmd, payload)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &AppHandle<R>, cmd: &str, _payload: Value) -> Result<Value, String> {
    log::debug!("mpv::{cmd} is a no-op on desktop (Android-only player)");
    Ok(Value::Null)
}

pub fn play<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    call(app, "play", Value::Null)
}

pub fn pause<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    call(app, "pause", Value::Null)
}

/// seek args: a bare number (seconds, relative) OR { seconds, mode }.
pub fn seek<R: Runtime>(app: &AppHandle<R>, args: Option<Value>) -> Result<Value, String> {
    let (seconds, mode) = match args {
        Some(Value::Number(n)) => (n.as_f64().unwrap_or(0.0), "relative".to_string()),
        Some(Value::Object(o)) => (
            o.get("seconds").and_then(|v| v.as_f64()).unwrap_or(0.0),
            o.get("mode").and_then(|v| v.as_str()).unwrap_or("relative").to_string(),
        ),
        _ => return Err("seek args: number seconds or {seconds, mode}".into()),
    };
    // Kotlin appends `+exact` to `mode` (frame-accurate).
    call(app, "seek", json!({ "seconds": seconds, "mode": mode }))
}

/// mpv.command args: [name, ...stringifiable args]. Allowlist-gated.
pub fn command<R: Runtime>(app: &AppHandle<R>, args: Option<Value>) -> Result<Value, String> {
    let arr = match args.as_ref().and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return Err("mpv.command args must be a non-empty array [name, ...]".into()),
    };
    let name = arr[0].as_str().ok_or("first arg (mpv command name) must be a string")?;
    if !ALLOWED_MPV_COMMANDS.contains(&name) {
        log::warn!("rejected mpv command not on allowlist: {name}");
        return Err(format!("mpv command '{name}' is not on the shell allowlist"));
    }
    // Stringify the tail to match the Windows shell's String-only command args.
    let rest: Vec<String> = arr[1..]
        .iter()
        .map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect();
    call(app, "mpvCommand", json!({ "name": name, "args": rest }))
}

/// mpv.setProperty args: [name, value]. Kotlin types the value
/// (bool->setPropertyBoolean, number->setPropertyString(toString), string->setPropertyString).
pub fn set_property<R: Runtime>(app: &AppHandle<R>, args: Option<Value>) -> Result<Value, String> {
    let arr = match args.as_ref().and_then(|v| v.as_array()) {
        Some(a) if a.len() >= 2 => a,
        _ => return Err("mpv.setProperty args must be [name, value]".into()),
    };
    let name = arr[0].as_str().ok_or("setProperty name must be a string")?;
    call(app, "mpvSetProperty", json!({ "name": name, "value": arr[1] }))
}

/// Returns MpvTrack[] (serialized by the Kotlin track-list/N walk). The plugin
/// resolves `{ value: [...] }` (Tauri Invoke.resolve takes an object), so unwrap.
pub fn get_tracks<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let v = call(app, "mpvGetTracks", Value::Null)?;
    Ok(v.get("value").cloned().unwrap_or_else(|| json!([])))
}

/// Returns MpvChapter[] (serialized by the Kotlin chapter-list/N walk).
pub fn get_chapters<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let v = call(app, "mpvGetChapters", Value::Null)?;
    Ok(v.get("value").cloned().unwrap_or_else(|| json!([])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_blocks_dangerous_verbs() {
        for bad in ["run", "subprocess", "load-script", "quit"] {
            assert!(!ALLOWED_MPV_COMMANDS.contains(&bad), "{bad} must not be allowed");
        }
        for ok in ["loadfile", "seek", "set", "cycle", "sub-reload"] {
            assert!(ALLOWED_MPV_COMMANDS.contains(&ok), "{ok} should be allowed");
        }
    }
}
