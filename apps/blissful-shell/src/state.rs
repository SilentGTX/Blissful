// Shell-wide state shared with the IPC dispatcher.
//
// Two sub-systems live here:
//
//   * `ShellState` (UI-thread-only): the libmpv Player handle, the main
//     HWND, fullscreen geometry, the renderer log file, and the resize
//     closure WebView2 commands use to refit bounds after fullscreen
//     toggles. Reached via the `SHELL` thread_local — anyone who borrows
//     it MUST be running on the UI thread.
//
//   * Outgoing-event channel (any-thread-safe): a `flume::Sender` paired
//     with an `nwg::NoticeSender` that funnels `Outgoing` events to the
//     UI thread, where a single drain handler in `main_window.rs` posts
//     them via WebView2. Historically this was a `Box<dyn Fn(&Outgoing)>`
//     stored inside the UI thread's `SHELL` — but a closure captured on
//     one thread can't be reached from another, so events fired from the
//     updater's tokio task (or any future async worker) silently dropped.
//     The Notice path is the same one mpv events already use, just
//     promoted to a first-class building block so every component that
//     wants to talk to the renderer goes through one chokepoint.
//
// `post_outgoing` is the single entry point. Callable from any thread.
// If the channel hasn't been wired yet (very early in shell init), the
// call is a no-op — the renderer can't be listening before the WebView
// exists anyway.

use flume::Sender;
use once_cell::sync::OnceCell;
use std::cell::RefCell;
use std::fs::File;
use std::sync::atomic::{AtomicBool, Ordering};
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
            resize_webview: None,
        }
    }
}

thread_local! {
    pub static SHELL: RefCell<ShellState> = RefCell::new(ShellState::default());
}

/// Sender side of the outgoing-event channel. Populated once during
/// shell init (`main_window::run_spike`) and used by `post_outgoing`
/// from any thread thereafter. Cloning the sender is cheap; we hand
/// out clones rather than borrows so the global stays untouched.
static OUTGOING_TX: OnceCell<Sender<Outgoing>> = OnceCell::new();
/// NWG Notice handle paired with the channel above. Pinging it wakes
/// the UI thread which then drains the channel and posts to WebView2.
static OUTGOING_NOTICE: OnceCell<native_windows_gui::NoticeSender> = OnceCell::new();
/// Set true once the WebView2 controller has finished initialising.
/// Drain handlers gate on this so events fired during the short window
/// between channel install and controller ready don't get drained into
/// a no-op `post_message` (which would silently lose them).
static WEBVIEW_READY: AtomicBool = AtomicBool::new(false);

/// One-time setup, called from the UI thread during shell construction
/// after the NWG Notice has been built. The sender side gets cloned
/// internally so callers can drop their copy.
pub fn install_outgoing_channel(
    tx: Sender<Outgoing>,
    notice: native_windows_gui::NoticeSender,
) {
    let _ = OUTGOING_TX.set(tx);
    let _ = OUTGOING_NOTICE.set(notice);
}

/// Flip the gate that lets the drain handler post events through. Should
/// be called by the WebView2 controller-created callback (i.e. once the
/// controller exists and `post_web_message_as_string` is meaningful).
pub fn mark_webview_ready() {
    WEBVIEW_READY.store(true, Ordering::Release);
}

pub fn is_webview_ready() -> bool {
    WEBVIEW_READY.load(Ordering::Acquire)
}

/// Send an `Outgoing` (Event or Response) to the renderer from any
/// thread. Returns true if the message was enqueued, false if the
/// channel isn't wired yet (very early init — the renderer can't be
/// listening anyway, so dropping is harmless).
pub fn post_outgoing(payload: &Outgoing) -> bool {
    let Some(tx) = OUTGOING_TX.get() else {
        return false;
    };
    // Unbounded — `try_send` would never fail. Use `send` and ignore
    // the disconnected case (means the shell is shutting down).
    let _ = tx.send(payload.clone());
    if let Some(notice) = OUTGOING_NOTICE.get() {
        notice.notice();
    }
    true
}
