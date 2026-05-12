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

                    // Register an event sink so commands can push Events
                    // (Outgoing::Event) back to JS without needing direct
                    // access to the WebView. The sink captures the WebView
                    // by clone — webview2::WebView is COM-refcounted so a
                    // clone is cheap and remains valid on the UI thread.
                    let webview_for_sink = webview.clone();
                    let controller_for_resize = controller.clone();
                    crate::state::SHELL.with(|s| {
                        let mut st = s.borrow_mut();
                        st.event_sink = Some(Box::new(move |payload| {
                            let json = ipc::serialize(payload);
                            if let Err(e) = webview_for_sink.post_web_message_as_string(&json) {
                                error!(error = ?e, "event sink post failed");
                            }
                        }));
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
}
