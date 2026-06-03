// Blissful TV — Tauri v2 shell entry point.
//
// On Android/iOS the generated project calls `run()` through the
// `mobile_entry_point` macro; on desktop `main.rs` calls it directly. Keep all
// real setup here so both paths share it.
//
// What this wires up:
//   - the `bridge` command behind window.blissfulDesktop.call (see bridge.rs)
//   - the same-origin localhost proxy on 127.0.0.1:11471 (see proxy.rs) so the
//     React UI's relative /addon-proxy, /storage/*, /stremio/*, /resolve-url,
//     /tmdb-season-info calls resolve once the UI's proxy base points at it
//   - a notify-only GitHub release check on launch (see updater.rs)
//
// NOT here yet (see SPEC.md): the native player + Surface-under-transparent-
// WebView compositing (Phase 2) and the embedded torrent streaming server
// (Phase 5). Those require a native Android plugin and are the largest
// remaining work.

mod bridge;
mod mpv;
mod proxy;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Native libmpv-android player plugin (no-op registration on desktop;
        // registers the Kotlin BlissfulMpvPlugin on Android). See mpv.rs.
        .plugin(mpv::init())
        .invoke_handler(tauri::generate_handler![bridge::bridge])
        .setup(|app| {
            // 1) Same-origin proxy (faithful port of the Windows ui_server.rs).
            //    Failure here means catalogs/login/streams won't load, so log
            //    loudly — but don't abort the app (the UI still renders).
            if let Err(e) = proxy::spawn() {
                log::error!("blissful proxy failed to start: {e:#}");
            }

            // 2) Notify-only update check (no auto-download/install on Android).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                updater::spawn_check(&handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running blissful-tv");
}
