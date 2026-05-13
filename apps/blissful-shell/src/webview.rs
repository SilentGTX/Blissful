// WebView2 host via the `webview2` crate (the same one stremio-shell-ng
// ships in production). Created as a sibling of mpv under the same parent
// HWND. The crate's `create_controller(hwnd, cb)` does whatever internal
// dance is needed to make WebView2 composite correctly over libmpv's d3d11
// surface — we don't have to handle z-order, composition controllers, or
// DComp visual trees explicitly. That detail is the whole reason we
// switched off webview2-com 0.36.
//
// HWND type bridging: the `webview2` crate uses `winapi::HWND` (*mut
// HWND__). Our app uses `windows::Win32::Foundation::HWND` (*mut c_void).
// Same pointer value, different pointee type — bridge with a raw cast.
//
// Error handling: callbacks inside `webview2::EnvironmentBuilder::build`
// and `create_controller` return `Result<_, webview2::Error>`, not
// anyhow::Result. We can't use anyhow's `.context()?` there. We log and
// continue on failure inside the callback; outer scope uses anyhow.

use anyhow::{anyhow, Result};
use std::cell::RefCell;
use std::rc::Rc;
use tracing::{debug, error, info};
use webview2::Controller;
use windows::Win32::Foundation::HWND;

use crate::ipc;

const PHASE_0A_HTML: &str = include_str!("phase_0a_spike.html");

/// What the WebView should load on startup.
#[derive(Clone, Debug)]
pub enum NavTarget {
    /// Phase 0a — hardcoded HTML string baked into the shell binary.
    InlineHtml,
    /// Phase 0b — point at a running Vite dev server or local UI server.
    Url(String),
}

pub struct WebView {
    controller: Rc<RefCell<Option<Controller>>>,
}

impl WebView {
    /// Build the WebView. `on_message` runs for every JS postMessage that
    /// isn't a typed IPC Request. `on_ready` fires once when the initial
    /// page navigation completes — used by main_window to show the parent
    /// window only after the page has rendered (Phase 5 splash via
    /// delayed visibility).
    pub fn create<F, R>(
        parent: HWND,
        nav: NavTarget,
        on_message: F,
        on_ready: R,
    ) -> Result<Self>
    where
        F: Fn(String) + 'static,
        R: Fn() + 'static,
    {
        let on_message: Rc<dyn Fn(String)> = Rc::new(on_message);
        // on_ready may be called multiple times if the user navigates
        // around — wrap in a Cell so we can fire it ONCE then drop it,
        // matching the "splash on first paint" intent.
        let on_ready_cell: Rc<RefCell<Option<Box<dyn Fn()>>>> =
            Rc::new(RefCell::new(Some(Box::new(on_ready))));
        let controller_cell: Rc<RefCell<Option<Controller>>> = Rc::new(RefCell::new(None));
        let controller_for_cb = Rc::clone(&controller_cell);

        let user_data_folder = std::env::var("APPDATA")
            .ok()
            .map(|d| format!(r"{d}\Blissful\WebView2"))
            .unwrap_or_else(|| String::from(r"C:\BlissfulWebView2"));
        std::fs::create_dir_all(&user_data_folder).ok();

        // Bridge windows::HWND -> winapi::HWND. Same pointer value.
        let hwnd_winapi: winapi::shared::windef::HWND = parent.0 as *mut _;

        let on_message_for_cb = Rc::clone(&on_message);
        let nav_outer = nav.clone();
        let result = webview2::EnvironmentBuilder::new()
            .with_user_data_folder(std::path::Path::new(&user_data_folder))
            .build(move |env_res| {
                let env = match env_res {
                    Ok(e) => e,
                    Err(e) => {
                        error!("WebView2 env create failed: {e:?}");
                        return Ok(());
                    }
                };
                let on_message_for_ctrl = Rc::clone(&on_message_for_cb);
                let on_ready_for_ctrl = Rc::clone(&on_ready_cell);
                let controller_for_inner = Rc::clone(&controller_for_cb);
                let nav_for_inner = nav_outer.clone();
                env.create_controller(hwnd_winapi, move |ctrl_res| {
                    let controller = match ctrl_res {
                        Ok(c) => c,
                        Err(e) => {
                            error!("WebView2 controller create failed: {e:?}");
                            return Ok(());
                        }
                    };
                    debug!("WebView2 controller created");

                    // Transparent background — alpha=0 lets mpv's render
                    // composite through. Same value stremio-shell-ng uses.
                    if let Ok(controller2) = controller.get_controller2() {
                        let _ = controller2.put_default_background_color(
                            webview2_sys::Color { r: 0, g: 0, b: 0, a: 0 },
                        );
                        debug!("DefaultBackgroundColor set transparent");
                    }

                    let webview = match controller.get_webview() {
                        Ok(w) => w,
                        Err(e) => {
                            error!("get_webview failed: {e:?}");
                            return Ok(());
                        }
                    };

                    // Settings.
                    if let Ok(settings) = webview.get_settings() {
                        let _ = settings.put_is_status_bar_enabled(false);
                        let _ = settings.put_are_dev_tools_enabled(cfg!(debug_assertions));
                        let _ = settings.put_is_zoom_control_enabled(false);
                        let _ = settings.put_are_default_context_menus_enabled(cfg!(debug_assertions));
                    }

                    // Bounds sync.
                    unsafe {
                        let mut rect: winapi::shared::windef::RECT = std::mem::zeroed();
                        winapi::um::winuser::GetClientRect(hwnd_winapi, &mut rect);
                        let _ = controller.put_bounds(rect);
                    }

                    // Inject the blissfulDesktop JS shim BEFORE any page
                    // loads — runs on every NavigationCompleted'd document.
                    let _ = webview.add_script_to_execute_on_document_created(
                        ipc::JS_SHIM,
                        |_| Ok(()),
                    );

                    // Register the resize closure so fullscreen toggles
                    // can refit the WebView from the IPC dispatcher (UI
                    // thread). Outgoing events go through the channel
                    // installed by main_window — no per-controller sink
                    // is registered here anymore. Flip the WEBVIEW_READY
                    // gate so the channel drain handler starts posting.
                    let controller_for_resize = controller.clone();
                    crate::state::SHELL.with(|s| {
                        let mut st = s.borrow_mut();
                        st.resize_webview = Some(Box::new(move |x, y, w, h| {
                            let rect = winapi::shared::windef::RECT {
                                left: x,
                                top: y,
                                right: x + w,
                                bottom: y + h,
                            };
                            let _ = controller_for_resize.put_bounds(rect);
                        }));
                    });
                    crate::state::mark_webview_ready();

                    // Origin lock-down: every legitimate page navigation
                    // lands on http://127.0.0.1:<ui-server port>. Any
                    // other origin — a malicious href, a hijacked addon
                    // banner, an open-redirect on the storage upstream
                    // — would otherwise replace our same-origin React
                    // app with attacker-controlled content while leaving
                    // the auth token in localStorage and the
                    // `blissfulDesktop` IPC bridge alive on the new
                    // document. We cancel the navigation and shell out
                    // to the OS default browser for legitimate external
                    // links (http/https), drop anything else (javascript:,
                    // data:, file:, custom schemes) silently — those
                    // have no business inside the shell.
                    let _ = webview.add_navigation_starting(move |_w, args| {
                        let uri = args.get_uri().unwrap_or_default();
                        if is_allowed_internal_uri(&uri) {
                            return Ok(());
                        }
                        error!(uri = %uri, "blocked navigation off-origin");
                        let _ = args.put_cancel(true);
                        open_in_default_browser(&uri);
                        Ok(())
                    });

                    // Block `window.open()` / target="_blank" from
                    // spawning a second WebView. We don't want a popup
                    // surface to live inside the shell — that creates
                    // a second origin that doesn't inherit our
                    // navigation lock-down. Route http/https to the OS
                    // default browser and drop everything else.
                    let _ = webview.add_new_window_requested(move |_w, args| {
                        let _ = args.put_handled(true);
                        let uri = args.get_uri().unwrap_or_default();
                        open_in_default_browser(&uri);
                        Ok(())
                    });

                    // Phase 5 splash: fire on_ready once when the initial
                    // page navigation finishes. main_window uses that to
                    // un-hide the parent window after the page has
                    // rendered, hiding the empty-NWG-window flash.
                    let on_ready_for_nav = Rc::clone(&on_ready_for_ctrl);
                    let _ = webview.add_navigation_completed(move |_w, _args| {
                        if let Some(cb) = on_ready_for_nav.borrow_mut().take() {
                            cb();
                        }
                        Ok(())
                    });

                    // Wire postMessage handler. New IPC path (typed
                    // Request → Response over add_web_message_received +
                    // post_web_message_as_string) coexists with the legacy
                    // raw-string on_message callback so Phase 0 buttons
                    // keep working while we migrate.
                    let on_message_for_handler = Rc::clone(&on_message_for_ctrl);
                    let _ = webview.add_web_message_received(move |w, args| {
                        let Ok(s) = args.try_get_web_message_as_string() else {
                            return Ok(());
                        };
                        match ipc::dispatch(&s) {
                            Some(payload) => {
                                let json = ipc::serialize(&payload);
                                if let Err(e) = w.post_web_message_as_string(&json) {
                                    error!(error = ?e, "post_web_message_as_string failed");
                                }
                            }
                            None => {
                                // Legacy path: not a typed Request — pass
                                // the raw string to the on_message closure
                                // so existing Phase 0a/0b buttons still work.
                                on_message_for_handler(s);
                            }
                        }
                        Ok(())
                    });

                    // Navigate. Phase 0a baked HTML into the binary; Phase 0b
                    // points at a running Vite dev server (or any URL).
                    match &nav_for_inner {
                        NavTarget::InlineHtml => {
                            if let Err(e) = webview.navigate_to_string(PHASE_0A_HTML) {
                                error!("navigate_to_string failed: {e:?}");
                            }
                        }
                        NavTarget::Url(url) => {
                            if let Err(e) = webview.navigate(url) {
                                error!(url = %url, "navigate URL failed: {e:?}");
                            } else {
                                info!(url = %url, "navigating WebView to URL");
                            }
                        }
                    }

                    let _ = controller.put_is_visible(true);
                    *controller_for_inner.borrow_mut() = Some(controller);
                    info!("WebView2 controller ready");
                    Ok(())
                })
            });

        if let Err(e) = result {
            return Err(anyhow!("WebView2 env build: {e:?}"));
        }

        Ok(Self {
            controller: controller_cell,
        })
    }

    pub fn resize(&self, x: i32, y: i32, w: i32, h: i32) {
        let Some(controller) = self.controller.borrow().as_ref().cloned() else {
            return;
        };
        let rect = winapi::shared::windef::RECT {
            left: x,
            top: y,
            right: x + w,
            bottom: y + h,
        };
        let _ = controller.put_bounds(rect);
    }

    /// Post a single JSON payload to the renderer via WebView2's
    /// `post_web_message_as_string`. Must be called on the UI thread —
    /// the WebView2 host is STA and WebView calls from a worker thread
    /// fail with HRESULT_FROM_WIN32(RPC_E_WRONG_THREAD). The shell's
    /// outgoing-event drain handler in main_window invokes this from
    /// inside the NWG event loop, satisfying that constraint by
    /// construction.
    pub fn post_message(&self, json: &str) {
        let Some(controller) = self.controller.borrow().as_ref().cloned() else {
            return;
        };
        let webview = match controller.get_webview() {
            Ok(w) => w,
            Err(e) => {
                error!(error = ?e, "post_message: get_webview failed");
                return;
            }
        };
        if let Err(e) = webview.post_web_message_as_string(json) {
            error!(error = ?e, "post_message: post_web_message_as_string failed");
        }
    }
}

/// True if the URI is one the shell allows to load inside the WebView2
/// frame. Everything else is routed to the OS default browser (or
/// dropped). The match is on (scheme, host, port) — `127.0.0.1` on the
/// UI server's bound port is the only legitimate document origin; we
/// also keep WebView2's own internal `about:blank` so DevTools and the
/// initial empty document are allowed through.
fn is_allowed_internal_uri(uri: &str) -> bool {
    if uri.is_empty() || uri == "about:blank" {
        return true;
    }
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };
    if parsed.scheme() != "http" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if host != "127.0.0.1" {
        return false;
    }
    let bound = crate::ui_server::ui_server_port();
    parsed.port() == Some(bound)
}

/// Hand off http/https URIs to the OS default browser via the same
/// `cmd /c start` trick the updater uses (CREATE_NO_WINDOW suppresses
/// the console flash). Anything else — javascript:, data:, file:, custom
/// schemes — is silently ignored: there is no legitimate flow from
/// inside the shell that wants those handled by an external app.
fn open_in_default_browser(uri: &str) {
    let lower = uri.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return;
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", uri])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Err(e) = result {
        error!(uri = %uri, error = ?e, "failed to launch external URI");
    }
}
