// IPC wire types between the React renderer (apps/blissful-mvs/) and the
// native Rust shell. JSON-encoded, transported over WebView2's
// `postMessage` (JS → Rust) and `post_web_message_as_string` (Rust → JS).
//
// Wire shape:
//
//   Request  { id: string, command: string, args: Value }
//   Response { id: string, ok: bool,
//              result?: Value,        // when ok = true
//              error?:  { code: string, message: string } }
//   Event    { event: string, data: Value }
//
// Requests and responses are matched by `id` (UUID v4 from the renderer).
// Events are unsolicited — Rust pushing data to the renderer (mpv property
// observers, fullscreen state changes, update-available, etc.).
//
// All three top-level types are tagged externally by a `type` field so a
// single JS listener can dispatch correctly without inspecting fields:
//
//   { "type": "response", "id": "...", "ok": true, "result": ... }
//   { "type": "event",    "event": "fullscreen-changed", "data": {...} }

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Outgoing {
    Response(Response),
    Event(Event),
}

#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcError>,
}

impl Response {
    pub fn ok(id: &str, result: Value) -> Self {
        Self {
            id: id.to_string(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            ok: false,
            result: None,
            error: Some(IpcError {
                code: code.to_string(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub event: String,
    pub data: Value,
}
