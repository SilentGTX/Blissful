// Watch Party v2 Layer B — host relay tunnel.
//
// A desktop host can't be reached from a guest's browser (NAT/CGNAT +
// mixed-content), so we dial an OUTBOUND WebSocket into the Mac
// (addon-proxy `/party-relay-tunnel`) and answer its pull requests by fetching
// our LOCAL stremio-service HLS (127.0.0.1:11470). The Mac caches each segment
// and fans it out to every guest, so N guests cost the host ~one fetch each.
// See docs/WATCH-PARTY-V2.md (Layer B).
//
// Protocol over the tunnel (JSON text frames):
//   Mac  -> host: { "t":"pull", "id":<n>, "path":"<hls path>" }
//   host -> Mac:  { "t":"pulled", "id":<n>, "ok":true, "status":200,
//                   "contentType":"…", "bodyB64":"…" }  | { …,"ok":false }

use crate::ipc::protocol::{Event, Outgoing};
use crate::state::post_outgoing;
use base64::Engine as _;
use once_cell::sync::Lazy;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const STREMIO_LOCAL: &str = "http://127.0.0.1:11470";

// Relay endpoints default to prod (the Mac), but are overridable for local dev
// testing against a locally-run addon-proxy:
//   BLISSFUL_RELAY_WS   = ws://localhost:13000/party-relay-tunnel
//   BLISSFUL_RELAY_HTTP = http://localhost:13000/party-relay
fn relay_ws_base() -> String {
    std::env::var("BLISSFUL_RELAY_WS")
        .unwrap_or_else(|_| "wss://blissful.budinoff.com/party-relay-tunnel".to_string())
}
fn relay_http_base() -> String {
    std::env::var("BLISSFUL_RELAY_HTTP")
        .unwrap_or_else(|_| "https://blissful.budinoff.com/party-relay".to_string())
}

struct RelaySession {
    stop: Arc<AtomicBool>,
}
// One relay at a time — a single transcode job per host (stremio-service runs
// one HLS session). Starting a new relay tears down the previous.
static SESSION: Lazy<Mutex<Option<RelaySession>>> = Lazy::new(|| Mutex::new(None));

fn status(s: &str) {
    post_outgoing(&Outgoing::Event(Event {
        event: "party-relay-status".to_string(),
        data: json!(s),
    }));
}

/// Start relaying. `hls_path` is the path of the LOCAL stremio-service HLS index
/// for the playing content (relative to `127.0.0.1:11470`, e.g.
/// `hlsv2/<session>/master.m3u8`) — the renderer supplies it. Returns the public
/// `…/party-relay/{room}/<index>?k=<key>` URL the host announces as the room
/// `source` for guests to load.
pub fn start(room: String, hls_path: String) -> anyhow::Result<String> {
    if room.is_empty() {
        return Err(anyhow::anyhow!("room required"));
    }
    // The local stremio-service does the HLS transcode — make sure it's up.
    let _ = crate::streaming_server::ensure_started();
    // Tear down any prior relay before starting a new one.
    stop();

    let key = uuid::Uuid::new_v4().simple().to_string();
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut g = SESSION.lock().unwrap();
        *g = Some(RelaySession { stop: stop_flag.clone() });
    }

    let room_task = room.clone();
    let key_task = key.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                tracing::warn!(error = ?e, "host_relay: tokio runtime build failed");
                status("failed");
                return;
            }
        };
        rt.block_on(run_tunnel(room_task, key_task, stop_flag));
    });

    let index = hls_path.trim_start_matches('/');
    // The HLS index path may already carry a query (…master.m3u8?mediaURL=…),
    // so pick the right separator for the relay key instead of a second '?'.
    let sep = if index.contains('?') { '&' } else { '?' };
    Ok(format!("{}/{room}/{index}{sep}k={key}", relay_http_base()))
}

/// Tear down the active relay (stops the tunnel loop; the local HLS session
/// expires on its own in stremio-service).
pub fn stop() {
    let mut g = SESSION.lock().unwrap();
    if let Some(s) = g.take() {
        s.stop.store(true, Ordering::SeqCst);
    }
}

async fn run_tunnel(room: String, key: String, stop_flag: Arc<AtomicBool>) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let url = format!(
        "{}?room={}&key={}",
        relay_ws_base(),
        urlencoding::encode(&room),
        urlencoding::encode(&key),
    );
    let client = reqwest::Client::new();
    status("connecting");

    while !stop_flag.load(Ordering::SeqCst) {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                status("ready");
                // Ping every 30s so the tunnel survives idle gaps. Without it the
                // WS is severed after ~100s of inactivity (Cloudflare / proxy idle
                // timeout) — observed as a clean ~125s up/down churn that 404s any
                // playlist or segment fetch landing in the ~2s reconnect window and
                // stalls the guest. Active segment pulls keep it warm; this covers
                // the lulls (paused, buffered-ahead, between episodes).
                let mut keepalive = tokio::time::interval(Duration::from_secs(30));
                keepalive.tick().await; // drop the immediate first tick
                while !stop_flag.load(Ordering::SeqCst) {
                    let msg = tokio::select! {
                        m = ws.next() => match m {
                            Some(Ok(m)) => m,
                            _ => break, // stream ended / errored → reconnect
                        },
                        _ = keepalive.tick() => {
                            if ws.send(Message::Ping(Vec::new())).await.is_err() {
                                break; // peer gone → reconnect
                            }
                            continue;
                        }
                    };
                    let txt = match msg {
                        Message::Text(t) => t,
                        Message::Ping(_) | Message::Pong(_) => continue,
                        Message::Close(_) => break,
                        _ => continue,
                    };
                    let v: serde_json::Value = match serde_json::from_str(&txt) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if v.get("t").and_then(|x| x.as_str()) != Some("pull") {
                        continue;
                    }
                    let id = match v.get("id").and_then(|x| x.as_i64()) {
                        Some(i) => i,
                        None => continue,
                    };
                    let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let out = match fetch_local(&client, &path).await {
                        Ok((status_code, content_type, body)) => json!({
                            "t": "pulled",
                            "id": id,
                            "ok": true,
                            "status": status_code,
                            "contentType": content_type,
                            "bodyB64": base64::engine::general_purpose::STANDARD.encode(&body),
                        }),
                        Err(e) => {
                            tracing::warn!(error = ?e, path = %path, "host_relay: local fetch failed");
                            json!({ "t": "pulled", "id": id, "ok": false })
                        }
                    };
                    if ws.send(Message::Text(out.to_string())).await.is_err() {
                        break;
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = ?e, "host_relay: tunnel connect failed");
            }
        }
        if stop_flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await; // backoff, then reconnect
    }
    status("stopped");
}

async fn fetch_local(
    client: &reqwest::Client,
    path: &str,
) -> anyhow::Result<(u16, String, Vec<u8>)> {
    if path.is_empty() {
        return Err(anyhow::anyhow!("empty path"));
    }
    let target = format!("{STREMIO_LOCAL}/{}", path.trim_start_matches('/'));
    let resp = client.get(&target).send().await?;
    let status_code = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let body = resp.bytes().await?.to_vec();
    Ok((status_code, content_type, body))
}
