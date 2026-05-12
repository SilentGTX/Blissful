// Shell-wide state shared with the IPC dispatcher. Lives in a thread_local
// because all current commands are dispatched on the UI thread (where the
// WebView2 callback fires). When we add Tokio for I/O-heavy work, the
// pattern shifts to channel-passing: worker threads send `Outgoing`
// payloads through flume + NWG Notice, the UI thread drains and posts.
//
// What lives here:
//   - Player handle for play/pause/seek mpv commands
//   - Main window HWND for fullscreen toggle (we resize child HWNDs from here)
//   - Fullscreen state + saved style/rect for restoring from fullscreen
//   - Outgoing event sink — a closure that posts an Outgoing back to JS,
//     captured from the WebView2 controller callback. Commands use this
//     to push Events (e.g. fullscreen-changed) back to the renderer.

use std::cell::RefCell;
use std::fs::File;
use std::sync::{Arc, Mutex};
use windows::Win32::Foundation::HWND;

use crate::ipc::protocol::Outgoing;
use crate::player::Player;

#[derive(Default)]
pub struct WindowGeometry {
    pub style: u32,
    pub ex_style: u32,
    pub rect: (i32, i32, i32, i32),
}

pub struct ShellState {
    pub player: Option<Player>,
    pub main_hwnd: Option<HWND>,
    pub fullscreen: bool,
    pub pre_fullscreen: Option<WindowGeometry>,
    pub log_file: Option<Arc<Mutex<File>>>,
    pub event_sink: Option<Box<dyn Fn(&Outgoing)>>,
    /// Resize callback the IPC commands can invoke after operations that
    /// change the parent client area programmatically (fullscreen toggle).
    /// Takes (x, y, w, h) in parent client coords. Calls into the
    /// webview2 controller's put_bounds on the UI thread.
    pub resize_webview: Option<Box<dyn Fn(i32, i32, i32, i32)>>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            player: None,
            main_hwnd: None,
            fullscreen: false,
            pre_fullscreen: None,
            log_file: None,
            event_sink: None,
            resize_webview: None,
        }
    }
}

thread_local! {
    pub static SHELL: RefCell<ShellState> = RefCell::new(ShellState::default());
}

/// Convenience: post an Outgoing to JS via the sink registered after the
/// WebView2 controller is ready. No-op if the sink isn't installed yet
/// (the renderer can't have called anything before that anyway).
pub fn post_outgoing(payload: &Outgoing) {
    SHELL.with(|s| {
        if let Some(sink) = s.borrow().event_sink.as_ref() {
            sink(payload);
        }
    });
}
