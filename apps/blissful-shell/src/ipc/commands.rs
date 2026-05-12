// Command dispatch. One function per IPC command name. Lookups are done by
// string match on req.command. Adding a command: add a match arm here +
// a method in apps/blissful-mvs/src/lib/desktop.ts.
//
// Threading: every command currently runs on the UI thread (where the
// WebView2 message handler fires). When we add a command that needs I/O
// or long compute, it will move to Tokio and bounce results back via
// flume + NWG Notice. Adding that infrastructure later is non-blocking
// for the commands here, which are all fast / stateful work.

use super::protocol::{Event, Outgoing, Request, Response};
use crate::state::{post_outgoing, SHELL};
use serde_json::json;
use std::io::Write;
use std::thread;
use tracing::{info, warn};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowLongW, GetWindowRect, SetWindowLongW, SetWindowPos, GWL_EXSTYLE,
    GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, WS_CAPTION,
    WS_THICKFRAME,
};

pub fn dispatch(req: &Request) -> Response {
    // In dev builds, log which OS thread the dispatch ran on — the plan.md
    // exit criteria specifically calls for this to verify WebView2's STA
    // threading rule. Should always be the UI thread.
    #[cfg(debug_assertions)]
    tracing::trace!(thread = ?thread::current().id(), command = %req.command, "dispatch (debug)");

    match req.command.as_str() {
        // ---- core / lifecycle ----
        "getAppVersion" => Response::ok(&req.id, json!(env!("CARGO_PKG_VERSION"))),

        "log" => log_command(req),

        "ensureStreamingServer" => {
            // Phase 3: extract + spawn + supervise the bundled
            // stremio-service.exe. Returns whether 127.0.0.1:11470 is
            // reachable by the time we finish.
            match crate::streaming_server::ensure_started() {
                Ok(alive) => Response::ok(&req.id, json!(alive)),
                Err(e) => {
                    warn!(error = ?e, "ensureStreamingServer failed");
                    Response::err(&req.id, "streaming-server-error", e.to_string())
                }
            }
        }

        // ---- player controls (mpv) ----
        "play" => {
            let r = SHELL.with(|s| {
                s.borrow()
                    .player
                    .as_ref()
                    .map(|p| p.set_pause(false))
                    .unwrap_or_else(|| Err(anyhow::anyhow!("no player")))
            });
            match r {
                Ok(()) => Response::ok(&req.id, json!(null)),
                Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
            }
        }
        "pause" => {
            let r = SHELL.with(|s| {
                s.borrow()
                    .player
                    .as_ref()
                    .map(|p| p.set_pause(true))
                    .unwrap_or_else(|| Err(anyhow::anyhow!("no player")))
            });
            match r {
                Ok(()) => Response::ok(&req.id, json!(null)),
                Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
            }
        }

        // ---- mpv generic bridge ----
        // Matches the shape stremio-shell-ng's renderer expects:
        //   mpv.command:     args = [name, ...stringified args]
        //   mpv.setProperty: args = [name, value] (value can be bool/i64/f64/string)
        "mpv.command" => mpv_command(req),
        "mpv.setProperty" => mpv_set_property(req),
        "mpv.getTracks" => mpv_get_tracks(req),
        "seek" => mpv_seek(req),

        // ---- window / fullscreen ----
        "toggleFullscreen" => toggle_fullscreen(req),
        "isFullscreen" => {
            let fs = SHELL.with(|s| s.borrow().fullscreen);
            Response::ok(&req.id, json!(fs))
        }

        // ---- navigation ----
        "openPlayer" => {
            // The renderer calls this to request the shell open the player
            // route with given options. Phase 1: just acknowledge — real
            // navigation is the renderer's responsibility today, the shell
            // doesn't manage the React router.
            Response::ok(&req.id, json!(null))
        }

        // ---- auto-updater (Phase 6) ----
        "getUpdateStatus" => {
            // Pull-style query for the renderer. Returns the last update
            // the background poller found, or null. Lets the renderer
            // recover from missing the one-shot `update-available` event
            // (race against React mount completing by the 15s initial
            // check) by polling on a timer instead.
            match crate::updater::get_available() {
                Some(info) => Response::ok(&req.id, serde_json::to_value(&info).unwrap_or(json!(null))),
                None => Response::ok(&req.id, json!(null)),
            }
        }
        "downloadUpdate" => {
            // Fire-and-forget — the renderer doesn't await the actual
            // download, it waits for the `update-downloaded` Event the
            // updater fires from the tokio runtime when finished.
            std::thread::spawn(|| {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(e) => {
                        warn!(error = ?e, "downloadUpdate: tokio runtime build failed");
                        return;
                    }
                };
                if let Err(e) = rt.block_on(crate::updater::download_available()) {
                    warn!(error = ?e, "downloadUpdate failed");
                }
            });
            Response::ok(&req.id, json!(null))
        }
        "installUpdate" => {
            // Spawn the installer first; only stop the message loop after
            // the spawn returns successfully so a failure leaves the
            // running app in a usable state.
            match crate::updater::spawn_installer_and_quit() {
                Ok(()) => {
                    use native_windows_gui as nwg;
                    nwg::stop_thread_dispatch();
                    Response::ok(&req.id, json!(null))
                }
                Err(e) => Response::err(&req.id, "updater-error", e.to_string()),
            }
        }

        other => Response::err(&req.id, "unknown-command", format!("no handler for '{other}'")),
    }
}

fn mpv_command(req: &Request) -> Response {
    // args: [name, arg1, arg2, ...]. Anything non-string is stringified.
    let arr = match req.args.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => return Response::err(&req.id, "bad-args", "mpv.command args must be a non-empty array [name, ...]"),
    };
    let name = arr[0].as_str().map(|s| s.to_string());
    let name = match name {
        Some(n) => n,
        None => return Response::err(&req.id, "bad-args", "first arg (mpv command name) must be a string"),
    };
    let rest: Vec<String> = arr[1..]
        .iter()
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect();
    let rest_refs: Vec<&str> = rest.iter().map(|s| s.as_str()).collect();
    let r = SHELL.with(|s| {
        s.borrow()
            .player
            .as_ref()
            .map(|p| p.command(&name, &rest_refs))
            .unwrap_or_else(|| Err(anyhow::anyhow!("no player")))
    });
    match r {
        Ok(()) => Response::ok(&req.id, json!(null)),
        Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
    }
}

fn mpv_set_property(req: &Request) -> Response {
    let arr = match req.args.as_array() {
        Some(a) if a.len() >= 2 => a,
        _ => return Response::err(&req.id, "bad-args", "mpv.setProperty args must be [name, value]"),
    };
    let name = match arr[0].as_str() {
        Some(n) => n.to_string(),
        None => return Response::err(&req.id, "bad-args", "name must be a string"),
    };
    let value = &arr[1];
    let r = SHELL.with(|s| {
        let st = s.borrow();
        let player = match st.player.as_ref() {
            Some(p) => p,
            None => return Err(anyhow::anyhow!("no player")),
        };
        match value {
            serde_json::Value::Bool(b) => player.set_property_bool(&name, *b),
            serde_json::Value::Number(n) => {
                // libmpv2 5.0's set_property is STRICT about types: an
                // INT64 sent to a DOUBLE property fails silently, and
                // vice-versa. We don't know the property's internal
                // type here, so try in order: int → double → string.
                // mpv_set_property_string parses to whatever type the
                // property actually wants, so STRING is the universal
                // fallback. JS sends `1` as i64 (int props match),
                // `1.5` as f64 (float props match), and `28` for
                // `sub-font-size` lands on string after int+double fail
                // (sub-font-size's internal format may differ between
                // mpv versions).
                let i_opt = n.as_i64().or_else(|| n.as_u64().map(|u| u as i64));
                let f_opt = n.as_f64();
                let is_pure_float = n.is_f64() && !n.is_i64() && !n.is_u64();
                let mut result: anyhow::Result<()> = Err(anyhow::anyhow!("no attempt run"));
                if is_pure_float {
                    if let Some(f) = f_opt {
                        result = player.set_property_double(&name, f);
                    }
                } else if let Some(i) = i_opt {
                    result = player.set_property_int(&name, i);
                }
                if result.is_err() {
                    if is_pure_float {
                        if let Some(i) = i_opt {
                            result = player.set_property_int(&name, i);
                        }
                    } else if let Some(f) = f_opt {
                        result = player.set_property_double(&name, f);
                    }
                }
                if result.is_err() {
                    result = player.set_property_string(&name, &n.to_string());
                }
                result
            }
            serde_json::Value::String(s) => player.set_property_string(&name, s),
            other => player.set_property_string(&name, &other.to_string()),
        }
    });
    match r {
        Ok(()) => Response::ok(&req.id, json!(null)),
        Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
    }
}

fn mpv_get_tracks(req: &Request) -> Response {
    let r = SHELL.with(|s| {
        s.borrow()
            .player
            .as_ref()
            .map(|p| p.get_tracks())
            .unwrap_or_else(|| Err(anyhow::anyhow!("no player")))
    });
    match r {
        Ok(tracks) => Response::ok(&req.id, serde_json::to_value(&tracks).unwrap_or(json!([]))),
        Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
    }
}

fn mpv_seek(req: &Request) -> Response {
    // Args: number (seconds, relative) OR { seconds: number, mode: "relative"|"absolute" }
    let (seconds, mode) = match &req.args {
        serde_json::Value::Number(n) => (n.as_f64().unwrap_or(0.0), "relative".to_string()),
        serde_json::Value::Object(o) => (
            o.get("seconds").and_then(|v| v.as_f64()).unwrap_or(0.0),
            o.get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("relative")
                .to_string(),
        ),
        _ => return Response::err(&req.id, "bad-args", "seek args: number seconds or {seconds, mode}"),
    };
    let r = SHELL.with(|s| {
        s.borrow()
            .player
            .as_ref()
            .map(|p| {
                let sec_str = seconds.to_string();
                p.command("seek", &[sec_str.as_str(), mode.as_str()])
            })
            .unwrap_or_else(|| Err(anyhow::anyhow!("no player")))
    });
    match r {
        Ok(()) => Response::ok(&req.id, json!(null)),
        Err(e) => Response::err(&req.id, "mpv-error", e.to_string()),
    }
}

fn log_command(req: &Request) -> Response {
    let line = req
        .args
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| req.args.to_string());

    info!(target: "renderer", "{}", line);

    SHELL.with(|s| {
        if let Some(file_mu) = s.borrow().log_file.as_ref() {
            if let Ok(mut f) = file_mu.lock() {
                // Plain millisecond Unix timestamp — avoids pulling in chrono
                // just for this. Renderer can format it for display if needed.
                let ts_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let _ = writeln!(*f, "[{ts_ms}] {line}");
            }
        }
    });

    Response::ok(&req.id, json!(null))
}

fn toggle_fullscreen(req: &Request) -> Response {
    let (hwnd_opt, was_fs, saved) = SHELL.with(|s| {
        let st = s.borrow();
        (st.main_hwnd, st.fullscreen, st.pre_fullscreen.is_some())
    });

    let hwnd = match hwnd_opt {
        Some(h) => h,
        None => return Response::err(&req.id, "no-window", "main HWND not registered"),
    };

    if !was_fs {
        // -> fullscreen
        if let Err(e) = enter_fullscreen(hwnd) {
            return Response::err(&req.id, "fullscreen-error", e.to_string());
        }
        SHELL.with(|s| s.borrow_mut().fullscreen = true);
    } else {
        // -> windowed
        if let Err(e) = exit_fullscreen(hwnd) {
            return Response::err(&req.id, "fullscreen-error", e.to_string());
        }
        SHELL.with(|s| s.borrow_mut().fullscreen = false);
    }
    let _ = saved; // future: restore exact rect from pre_fullscreen

    let new_state = !was_fs;
    post_outgoing(&Outgoing::Event(Event {
        event: "fullscreen-changed".to_string(),
        data: json!(new_state),
    }));
    Response::ok(&req.id, json!(new_state))
}

fn enter_fullscreen(hwnd: HWND) -> anyhow::Result<()> {
    unsafe {
        // Save current style + window rect for later restore.
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        SHELL.with(|s| {
            s.borrow_mut().pre_fullscreen = Some(crate::state::WindowGeometry {
                style,
                ex_style,
                rect: (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top),
            });
        });

        // Strip caption + resize border. Keep WS_VISIBLE / WS_CHILD untouched.
        let new_style = style & !(WS_CAPTION.0 | WS_THICKFRAME.0);
        SetWindowLongW(hwnd, GWL_STYLE, new_style as i32);
        // Don't add WS_EX_TOPMOST — it interferes with other windowed
        // apps. Borderless full-screen on the current monitor is enough.
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style as i32);

        // Get the monitor under the window and SetWindowPos directly to
        // its full bounds. Avoid ShowWindow(SW_MAXIMIZE) — that
        // interacts badly with WS_CAPTION stripping (window flashes
        // hidden because Windows treats it as a state change).
        let monitor: HMONITOR = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let _ = GetMonitorInfoW(monitor, &mut mi);
        let m = mi.rcMonitor;
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            m.left,
            m.top,
            m.right - m.left,
            m.bottom - m.top,
            SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE,
        )?;

        // The OS will deliver WM_SIZE to NWG which our OnResize handler
        // will pick up, but NWG's `window.size()` reports the OUTER size
        // and during the transition can lag. Force the webview resize
        // directly from the new client rect for a smooth swap.
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client)?;
        let cw = client.right - client.left;
        let ch = client.bottom - client.top;
        SHELL.with(|s| {
            if let Some(resize) = s.borrow().resize_webview.as_ref() {
                resize(0, 0, cw, ch);
            }
        });
    }
    Ok(())
}

fn exit_fullscreen(hwnd: HWND) -> anyhow::Result<()> {
    let saved = SHELL.with(|s| s.borrow_mut().pre_fullscreen.take());
    unsafe {
        if let Some(g) = saved {
            SetWindowLongW(hwnd, GWL_STYLE, g.style as i32);
            SetWindowLongW(hwnd, GWL_EXSTYLE, g.ex_style as i32);
            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                g.rect.0,
                g.rect.1,
                g.rect.2,
                g.rect.3,
                SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE,
            )?;
            let mut client = RECT::default();
            GetClientRect(hwnd, &mut client)?;
            let cw = client.right - client.left;
            let ch = client.bottom - client.top;
            SHELL.with(|s| {
                if let Some(resize) = s.borrow().resize_webview.as_ref() {
                    resize(0, 0, cw, ch);
                }
            });
        }
    }
    Ok(())
}
