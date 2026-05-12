// IPC dispatcher. Parses incoming JSON requests from the WebView, routes by
// command name to a handler, returns a Response. Synchronous on the UI
// thread for Phase 1 — fast commands only. Long-running work (HTTP, file
// IO, libmpv event observation) will move to Tokio + a flume Notice
// channel back to the UI thread in Phase 1.5.

pub mod commands;
pub mod protocol;

use protocol::{Outgoing, Request};
use tracing::{debug, error};

/// Parse a raw JSON string from `add_web_message_received` and dispatch.
/// Returns the response payload that the caller should serialize and post
/// back to the WebView via `post_web_message_as_string`. Returns None when
/// the raw message couldn't be parsed as a Request (caller treats those as
/// legacy/unstructured messages — see webview.rs fallback).
pub fn dispatch(raw: &str) -> Option<Outgoing> {
    let req: Request = match serde_json::from_str(raw) {
        Ok(r) => r,
        Err(e) => {
            debug!(error = %e, raw = %raw, "ipc: message is not a typed Request (treating as legacy)");
            return None;
        }
    };
    debug!(id = %req.id, command = %req.command, "ipc: dispatching");
    let resp = commands::dispatch(&req);
    Some(Outgoing::Response(resp))
}

/// Serialize an Outgoing payload to JSON for posting through WebView2.
pub fn serialize(payload: &Outgoing) -> String {
    match serde_json::to_string(payload) {
        Ok(s) => s,
        Err(e) => {
            error!(error = %e, "ipc: failed to serialize outgoing — sending error fallback");
            String::from(r#"{"type":"event","event":"_ipc-error","data":"serialization failed"}"#)
        }
    }
}

/// JS shim injected via `add_script_to_execute_on_document_created`. Exposes
/// `window.blissfulDesktop.{call(command, args), on(event, cb)}` plus a
/// `runtime: 'native'` sentinel so the renderer can detect it's running
/// inside the Rust shell and not the browser.
///
/// The shim:
///   - generates a UUID v4 for each call() to match request → response
///   - resolves the Promise when a matching response arrives
///   - lets renderers subscribe to events via on()
///   - uses window.chrome.webview.postMessage / addEventListener (the
///     WebView2 built-in JS messaging bridge — same as Phase 0 spike)
pub const JS_SHIM: &str = r#"
(function () {
  if (window.blissfulDesktop) return;
  const pending = new Map();           // id -> { resolve, reject }
  const eventHandlers = new Map();     // event name -> [callback, ...]
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  window.chrome.webview.addEventListener('message', (ev) => {
    let msg;
    try { msg = (typeof ev.data === 'string') ? JSON.parse(ev.data) : ev.data; }
    catch (e) { console.error('blissfulDesktop: bad message', ev.data); return; }
    if (msg && msg.type === 'response' && msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) resolve(msg.result);
      else reject(new Error((msg.error && msg.error.message) || 'IPC error'));
    } else if (msg && msg.type === 'event' && msg.event) {
      const handlers = eventHandlers.get(msg.event) || [];
      for (const cb of handlers) {
        try { cb(msg.data); } catch (e) { console.error('event handler threw', e); }
      }
    }
  });
  function call(command, args) {
    const id = uuid();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.chrome.webview.postMessage(JSON.stringify({ id, command, args: args == null ? null : args }));
    });
  }
  function on(eventName, callback) {
    let arr = eventHandlers.get(eventName);
    if (!arr) { arr = []; eventHandlers.set(eventName, arr); }
    arr.push(callback);
    return () => {
      const i = arr.indexOf(callback);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  window.blissfulDesktop = { runtime: 'native', call, on };
  console.log('blissfulDesktop shim installed');
})();
"#;
