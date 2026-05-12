// Parent NWG window hosting mpv and WebView2 as SIBLING children of the
// SAME parent HWND (matches stremio-shell-ng's proven architecture). Both
// the libmpv render window (class "mpv") and WebView2's hosting HWND are
// created directly under this parent. No intermediate video_host wrapper —
// that was an over-engineered design from our first attempt that ended up
// putting an extra HWND between the WebView2 and mpv and confusing the
// composition.
//
// Layout:
//   - mpv child (created when we pass `wid = parent_hwnd` to libmpv)
//   - WebView2 host (created by webview2::create_controller(parent_hwnd))
// The `webview2` crate handles whatever internal magic is required to get
// the WebView2 to composite over mpv's d3d11 surface — that's the entire
// reason we switched off webview2-com.

use anyhow::{Context, Result};
use native_windows_gui as nwg;
use std::cell::RefCell;
use std::ffi::c_void;
use std::rc::Rc;
use tracing::info;
use windows::Win32::Foundation::{COLORREF, HWND, RECT};
use windows::Win32::Graphics::Gdi::CreateSolidBrush;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, SetClassLongPtrW, GCLP_HBRBACKGROUND,
};

use crate::ipc::protocol::{Event as IpcEvent, Outgoing};
use crate::player::{OwnedMpvEvent, Player};
use crate::state::{post_outgoing, SHELL};
use crate::tray::Tray;
use crate::webview::{NavTarget, WebView};

pub struct SpikeWindow {
    pub window: nwg::Window,
    webview: RefCell<Option<WebView>>,
    player: RefCell<Option<Player>>,
    /// NWG Notice the mpv event thread pings to wake the UI thread.
    mpv_notice: nwg::Notice,
    /// Drained on the UI thread inside the OnNotice handler. Sender lives
    /// inside the event thread (captured by the dispatcher closure).
    mpv_event_rx: flume::Receiver<OwnedMpvEvent>,
    /// Phase 5: system tray icon with show/hide + quit menu.
    tray: Tray,
    /// One-shot Notice that fires when the WebView2 finishes initial
    /// navigation. Used to un-hide the main window after the page paints
    /// (delayed-show splash pattern).
    ready_notice: nwg::Notice,
}

pub fn run_spike(test_file: &str) -> Result<()> {
    // Phase 3b: spin up the local UI server FIRST so the WebView's
    // initial navigation can resolve through it. Server lives in a
    // dedicated Tokio thread; this call returns immediately after
    // binding the TCP socket.
    crate::ui_server::spawn_in_background().context("ui_server spawn")?;

    // Phase 6: kick off the GitHub Releases poller. Runs on its own
    // tokio thread; first check fires after a 15s grace period.
    crate::updater::spawn_in_background().context("updater spawn")?;

    nwg::init().context("nwg init failed")?;
    #[allow(deprecated)]
    unsafe {
        nwg::set_dpi_awareness();
    }
    nwg::enable_visual_styles();

    // Load the embedded app icon for the window (title bar + taskbar +
    // Alt-Tab thumbnail). Same bytes the tray uses.
    let mut window_icon = nwg::Icon::default();
    nwg::Icon::builder()
        .source_bin(Some(include_bytes!("../resources/icon.ico")))
        .strict(true)
        .build(&mut window_icon)
        .context("window icon build")?;

    let mut window = nwg::Window::default();
    // Phase 5: start hidden so the empty NWG client area doesn't flash
    // for the half-second before WebView2 paints. The webview's
    // NavigationCompleted handler un-hides via on_ready.
    use nwg::WindowFlags;
    nwg::Window::builder()
        .size((1280, 720))
        .position((100, 100))
        .title("Blissful")
        .icon(Some(&window_icon))
        .flags(WindowFlags::MAIN_WINDOW | WindowFlags::WINDOW)
        .build(&mut window)
        .context("window build")?;
    window.set_visible(false);

    let nwg_hwnd_ptr = window.handle.hwnd().context("no hwnd")?;
    let parent_hwnd = HWND(nwg_hwnd_ptr as *mut c_void);
    info!(parent_hwnd = ?parent_hwnd.0, "spike parent window created");

    // Swap the window class's background brush from the default
    // COLOR_WINDOW (system white) to a dark color matching the Blissful
    // UI. Otherwise, WHENEVER the WebView2 isn't fully covering the parent
    // (initial paint, resize transitions, the gap between fullscreen
    // toggle and the put_bounds call) the user sees a white flash.
    //
    // COLORREF is 0x00BBGGRR. #0a0a0f → RGB(10,10,15) → 0x000F0A0A.
    unsafe {
        let brush = CreateSolidBrush(COLORREF(0x000F_0A0A));
        SetClassLongPtrW(parent_hwnd, GCLP_HBRBACKGROUND, brush.0 as isize);
    }

    // Register main HWND + open the renderer log file under %APPDATA%.
    SHELL.with(|s| {
        s.borrow_mut().main_hwnd = Some(parent_hwnd);
    });
    if let Some(appdata) = std::env::var("APPDATA").ok() {
        let log_dir = std::path::PathBuf::from(&appdata).join("Blissful");
        std::fs::create_dir_all(&log_dir).ok();
        let log_path = log_dir.join("player.log");
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            Ok(f) => {
                SHELL.with(|s| {
                    s.borrow_mut().log_file =
                        Some(std::sync::Arc::new(std::sync::Mutex::new(f)));
                });
                info!(path = %log_path.display(), "renderer log file open");
            }
            Err(e) => tracing::warn!(error = ?e, path = %log_path.display(), "could not open renderer log file"),
        }
    }

    // Set up the mpv event channel + NWG Notice BEFORE creating the Player,
    // because Player::init spawns the event thread and the dispatcher
    // closure needs both the flume sender and the notice sender.
    let mut mpv_notice = nwg::Notice::default();
    nwg::Notice::builder()
        .parent(&window)
        .build(&mut mpv_notice)
        .context("mpv Notice build")?;
    let (mpv_event_tx, mpv_event_rx) = flume::unbounded::<OwnedMpvEvent>();
    let notice_sender = mpv_notice.sender();

    // Init libmpv pointing at the PARENT window (stremio-shell-ng pattern).
    // libmpv creates its render child window directly under parent, as a
    // sibling of the WebView2 we add next. No video_host intermediate.
    let player = Player::init(parent_hwnd, move |evt| {
        // Runs on the mpv event thread. Push the owned event through
        // flume and ping the Notice so the UI thread drains it from the
        // OnNotice handler (where we can safely call into WebView2).
        if mpv_event_tx.send(evt).is_err() {
            // Receiver dropped — main window closed, event thread can stop.
            return;
        }
        notice_sender.notice();
    })
    .context("libmpv init")?;
    info!("libmpv initialized");
    // Phase 4: don't auto-load anything at startup anymore. mpv stays
    // idle (idle=yes + keep-open=yes) until NativeMpvPlayer issues a
    // loadfile via IPC for the route the renderer landed on. The test
    // clip auto-load was Phase 0a's spike fodder; with a real player
    // wired up it just leaks audio/video behind the home page.
    // BLISSFUL_SPIKE_AUTOLOAD=1 restores the old behavior for debugging.
    if std::env::var("BLISSFUL_SPIKE_AUTOLOAD").is_ok() {
        match player.load_file(test_file) {
            Ok(()) => info!(file = test_file, "BLISSFUL_SPIKE_AUTOLOAD: test file loaded"),
            Err(e) => tracing::warn!(file = test_file, error = ?e, "BLISSFUL_SPIKE_AUTOLOAD: load failed"),
        }
    } else {
        let _ = test_file;
    }

    // WebView2 as sibling of mpv's child. The webview2 crate handles the
    // compositing semantics so a transparent WebView2 overlays mpv correctly.
    // Phase 0b: navigate to the React app's spike route running on Vite.
    // BLISSFUL_SPIKE_URL env var overrides; default is the standard Vite port
    // serving apps/blissful-mvs/. Set BLISSFUL_SPIKE_URL="inline" to fall
    // back to the Phase 0a hardcoded HTML.
    let nav = match std::env::var("BLISSFUL_SPIKE_URL")
        .ok()
        .as_deref()
    {
        Some("inline") => NavTarget::InlineHtml,
        Some(url) if !url.is_empty() => NavTarget::Url(url.to_string()),
        // Default points at our local UI server (Phase 3b). It serves the
        // React app (proxied to Vite in dev, from disk in prod) and all
        // the relative routes the renderer expects on the same origin.
        _ => NavTarget::Url(format!("{}/", crate::ui_server::ui_server_url())),
    };
    info!(?nav, "webview navigation target");

    // Use a one-shot NWG Notice to dispatch the "WebView ready, show window"
    // signal back to the UI thread. The on_ready callback may fire from
    // inside WebView2's own COM callback chain; we want to do the actual
    // window.set_visible(true) from a clean event-loop tick.
    let mut ready_notice = nwg::Notice::default();
    nwg::Notice::builder()
        .parent(&window)
        .build(&mut ready_notice)
        .context("ready Notice build")?;
    let ready_sender = ready_notice.sender();
    let on_ready = move || {
        ready_sender.notice();
    };

    let webview = WebView::create(parent_hwnd, nav, |cmd| {
        // WebView2 postMessage delivers JSON-encoded values; a JS string
        // arrives as `"play"` (literal quotes). Parse it as a JSON value
        // first so the match sees the bare string.
        let parsed: serde_json::Value = serde_json::from_str(&cmd)
            .unwrap_or_else(|_| serde_json::Value::String(cmd.clone()));
        let s = parsed.as_str().unwrap_or(&cmd);
        match s {
            "pause" => crate::player::PLAYER.with(|p| {
                if let Some(p) = p.borrow().as_ref() {
                    let _ = p.set_pause(true);
                }
            }),
            "play" => crate::player::PLAYER.with(|p| {
                if let Some(p) = p.borrow().as_ref() {
                    let _ = p.set_pause(false);
                }
            }),
            other => tracing::warn!(cmd = %other, "unknown webview command"),
        }
    }, on_ready)
    .context("webview create")?;
    info!("webview2 host created");

    crate::player::PLAYER.with(|p| *p.borrow_mut() = Some(player.clone()));
    // Register Player in ShellState so the IPC dispatcher's play/pause
    // commands can find it.
    SHELL.with(|s| s.borrow_mut().player = Some(player.clone()));

    // Phase 5: build the system tray (icon + popup menu). Has to happen
    // BEFORE we move `window` into the SpikeWindow Rc.
    let tray = Tray::build(&window).context("tray build")?;

    let spike = Rc::new(SpikeWindow {
        window,
        webview: RefCell::new(Some(webview)),
        player: RefCell::new(Some(player)),
        mpv_notice,
        mpv_event_rx,
        tray,
        ready_notice,
    });

    let spike_for_evt = Rc::clone(&spike);
    let _handler = nwg::full_bind_event_handler(&spike.window.handle, move |evt, _evt_data, handle| {
        use nwg::Event;
        match evt {
            Event::OnWindowClose if handle == spike_for_evt.window.handle => {
                nwg::stop_thread_dispatch();
            }
            // Refit the WebView2 to the current client area. We listen on
            // both OnResize/OnResizeEnd (covers user-driven resizes) AND
            // OnPaint (Stremio's stremio-shell-ng pattern — fires on
            // maximize/restore where WM_SIZE-driven NWG events sometimes
            // race the actual size). GetClientRect is authoritative; NWG's
            // window.size() can lag during maximize transitions.
            Event::OnResize | Event::OnResizeEnd | Event::OnPaint
                if handle == spike_for_evt.window.handle =>
            {
                let hwnd_ptr = spike_for_evt.window.handle.hwnd();
                if let Some(ptr) = hwnd_ptr {
                    let hwnd = HWND(ptr as *mut c_void);
                    let mut client = RECT::default();
                    let ok = unsafe { GetClientRect(hwnd, &mut client).is_ok() };
                    if ok {
                        let cw = client.right - client.left;
                        let ch = client.bottom - client.top;
                        if let Some(wv) = spike_for_evt.webview.borrow().as_ref() {
                            wv.resize(0, 0, cw, ch);
                        }
                    }
                }
            }
            // Phase 5 splash: WebView2 finished its first navigation —
            // show the main window now that the page has painted.
            Event::OnNotice if handle == spike_for_evt.ready_notice.handle => {
                if !spike_for_evt.window.visible() {
                    spike_for_evt.window.set_visible(true);
                    spike_for_evt.window.set_focus();
                    info!("main window shown after WebView2 NavigationCompleted");
                }
            }
            Event::OnNotice if handle == spike_for_evt.mpv_notice.handle => {
                // Don't drain until the WebView2 event sink is registered,
                // otherwise the initial property dump (duration, volume,
                // etc. emitted on observe_property at libmpv init time)
                // arrives in the channel before the sink exists, gets
                // drained, and is silently dropped. Leaving them buffered
                // means the next Notice (e.g. when time-pos ticks after
                // sink registration) drains the backlog plus the new event.
                let sink_ready = SHELL.with(|s| s.borrow().event_sink.is_some());
                if !sink_ready {
                    return;
                }
                while let Ok(mpv_evt) = spike_for_evt.mpv_event_rx.try_recv() {
                    let (event_name, data) = mpv_evt.to_renderer();
                    post_outgoing(&Outgoing::Event(IpcEvent {
                        event: event_name.to_string(),
                        data,
                    }));
                }
            }

            // Tray icon: left-click → bring window to front. Matches
            // Stremio (no hide behavior — the icon is just a shortcut
            // to refocus, not a toggle).
            Event::OnMousePress(nwg::MousePressEvent::MousePressLeftUp)
                if handle == spike_for_evt.tray.tray.handle =>
            {
                bring_window_to_front(&spike_for_evt.window);
            }
            // Tray icon: right-click → popup menu at cursor.
            Event::OnContextMenu if handle == spike_for_evt.tray.tray.handle => {
                spike_for_evt.tray.popup_menu();
            }
            Event::OnMenuItemSelected
                if handle == spike_for_evt.tray.item_quit.handle =>
            {
                nwg::stop_thread_dispatch();
            }
            _ => {}
        }
    });

    info!("entering message loop");
    nwg::dispatch_thread_events();

    *spike.webview.borrow_mut() = None;
    *spike.player.borrow_mut() = None;
    // Tear down the streaming server if we spawned one — no-op when the
    // shell reused an already-running stremio-service.
    crate::streaming_server::kill_owned_process();

    Ok(())
}

/// Bring the main window to the foreground. Wired from the tray icon
/// left-click. We never hide the window from the tray (no Show/Hide
/// menu item either) — matches Stremio's tray behavior, the icon is
/// just a refocus shortcut.
fn bring_window_to_front(window: &nwg::Window) {
    if !window.visible() {
        window.set_visible(true);
    }
    window.set_focus();
}
