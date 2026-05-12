// Phase 3b — local same-origin HTTP server. The WebView2 loads
// http://127.0.0.1:5174/ instead of talking to Vite directly. Everything
// (the React app + every /addon-proxy, /storage, /stremio, /resolve-url
// call the renderer makes) lives on this single origin.
//
// Why single-origin: the React app uses RELATIVE URLs everywhere
// (`fetch('/addon-proxy?url=...')`, `fetch('/storage/state')`). If those
// land on a different origin than the page itself, CORS breaks and we'd
// need to patch dozens of call sites. Serving everything from 5174 means
// the renderer doesn't have to know it's in the shell.
//
// Dev vs prod: if `resources/blissful-ui/index.html` is present next to
// the exe (or one of a few fallback locations), we serve the built React
// app from disk. Otherwise we proxy / and /assets/* to localhost:5173
// where Vite is running. This auto-detect means no env var fiddling for
// either workflow.
//
// Threading: hyper needs a Tokio runtime. We spawn a dedicated thread
// that owns the runtime and runs the server forever (until the process
// exits). The NWG message loop runs on the main thread untouched.

use anyhow::{Context, Result};
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use once_cell::sync::OnceCell;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Client;
use std::convert::Infallible;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tokio::net::TcpListener;
use tracing::{debug, error, info, warn};

// Port range scanned at startup. We try 5175 first and fall back through
// the range when an earlier shell exits ungracefully and leaves a
// LISTENING socket parked in CLOSE_WAIT for minutes — without the
// fallback the new shell would fail to bind, its WebView2 would never
// load, and the user sees nothing on launch.
const UI_SERVER_PORT_BASE: u16 = 5175;
const UI_SERVER_PORT_TRIES: u16 = 16;

/// The port the UI server actually bound to. Populated once during
/// `spawn_in_background` and read via `ui_server_port()` afterwards.
static BOUND_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

pub fn ui_server_port() -> u16 {
    // The bind is async and runs on the ui-server tokio thread; callers
    // (main_window) read this from the UI thread right after spawning,
    // so the value may not be set yet. Short busy-wait — bind takes
    // <100 ms even when scanning through zombie-held ports.
    for _ in 0..40 {
        if let Some(p) = BOUND_PORT.get() {
            return *p;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    UI_SERVER_PORT_BASE
}

pub fn ui_server_url() -> String {
    format!("http://127.0.0.1:{}", ui_server_port())
}

const VITE_DEV_ORIGIN: &str = "http://localhost:5173";
const ADDON_PROXY_UPSTREAM: &str = "https://blissful.budinoff.com/addon-proxy";
const STORAGE_UPSTREAM: &str = "https://blissful.budinoff.com/storage";
const STREMIO_UPSTREAM: &str = "https://www.strem.io";

static HTTP_CLIENT: OnceCell<Client> = OnceCell::new();
static STATIC_ROOT: OnceCell<Option<PathBuf>> = OnceCell::new();

type BoxBody = http_body_util::combinators::BoxBody<Bytes, std::io::Error>;

/// Spawn the UI server on a dedicated thread. Returns immediately. The
/// thread keeps running until the process exits. Failures bind the
/// log only — the renderer will see connection refused if anything goes
/// wrong, surfacing the issue clearly.
pub fn spawn_in_background() -> Result<()> {
    let static_root = detect_static_root();
    let _ = STATIC_ROOT.set(static_root.clone());
    if let Some(p) = &static_root {
        info!(path = %p.display(), "UI server: serving static React build from disk");
    } else {
        info!(target = %VITE_DEV_ORIGIN, "UI server: proxying static paths to Vite dev server");
    }

    let client = Client::builder()
        .pool_idle_timeout(Duration::from_secs(20))
        .build()
        .context("build reqwest client")?;
    HTTP_CLIENT
        .set(client)
        .map_err(|_| anyhow::anyhow!("HTTP_CLIENT already set"))?;

    thread::Builder::new()
        .name("ui-server".into())
        .spawn(|| {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("build tokio runtime for UI server");
            rt.block_on(async {
                if let Err(e) = run_server().await {
                    error!(error = ?e, "UI server stopped");
                }
            });
        })
        .context("spawn ui-server thread")?;
    Ok(())
}

/// Search for a built React UI next to the exe. Returns the path
/// containing index.html, or None if we should fall back to Vite.
fn detect_static_root() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = [
        // Flat install layout: WiX MSI stages blissful-ui/ directly next
        // to blissful-shell.exe.
        exe_dir.join("blissful-ui"),
        // Dev / source-tree layouts.
        exe_dir.join("resources").join("blissful-ui"),
        exe_dir.join("../../../apps/blissful-mvs/dist"),
        exe_dir.join("../../resources/blissful-ui"),
    ];
    for c in &candidates {
        if c.join("index.html").exists() {
            return Some(c.clone());
        }
    }
    None
}

async fn run_server() -> Result<()> {
    // Try the configured base port first, then scan forward through the
    // range. Each retry fails fast: bind() returns immediately on
    // address-in-use. Stop and record the first port that binds so
    // main_window can navigate the WebView2 to it.
    let mut last_err: Option<anyhow::Error> = None;
    let mut listener: Option<TcpListener> = None;
    let mut chosen_port: u16 = UI_SERVER_PORT_BASE;
    for offset in 0..UI_SERVER_PORT_TRIES {
        let port = UI_SERVER_PORT_BASE + offset;
        let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
        match TcpListener::bind(addr).await {
            Ok(l) => {
                chosen_port = port;
                listener = Some(l);
                break;
            }
            Err(e) => {
                last_err = Some(anyhow::anyhow!("bind {}: {}", addr, e));
                continue;
            }
        }
    }
    let listener = listener.ok_or_else(|| {
        last_err.unwrap_or_else(|| anyhow::anyhow!("no free UI port in 5175..5190"))
    })?;
    let _ = BOUND_PORT.set(chosen_port);
    info!(port = chosen_port, "UI server listening");

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                warn!(error = ?e, "UI server accept failed");
                continue;
            }
        };
        let io = TokioIo::new(stream);
        tokio::spawn(async move {
            let svc = service_fn(handle_request);
            if let Err(e) = http1::Builder::new().serve_connection(io, svc).await {
                debug!(error = ?e, "UI server connection closed with error");
            }
        });
    }
}

async fn handle_request(
    req: Request<Incoming>,
) -> Result<Response<BoxBody>, Infallible> {
    // Own path + method up front so the arms that need to consume `req`
    // (storage/stremio — they read the body) aren't blocked by borrows
    // held by the match scrutinee.
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    let res = match (&method, path.as_str()) {
        // ---- PWA service worker stubs (we don't want SW caching in shell) ----
        (&Method::GET, "/sw.js") | (&Method::GET, "/registerSW.js") => {
            Ok(text_response(StatusCode::OK, "application/javascript", "// shell stub: SW disabled\n"))
        }

        // ---- /addon-proxy?url=<encoded> ----
        (&Method::GET, "/addon-proxy") => addon_proxy(&req).await,

        // ---- /resolve-url?url=<encoded> ----
        (&Method::GET, "/resolve-url") => resolve_url(&req).await,

        // ---- /storage/* ----
        (_, p) if p.starts_with("/storage/") => {
            let suffix = p["/storage".len()..].to_string();
            forward_request(req, STORAGE_UPSTREAM, &suffix).await
        }

        // ---- /stremio/* ----
        (_, p) if p.starts_with("/stremio/") => {
            let suffix = p["/stremio".len()..].to_string();
            forward_request(req, STREMIO_UPSTREAM, &suffix).await
        }

        // ---- everything else: React app (static or Vite proxy) ----
        _ => serve_static_or_vite(&req).await,
    };
    match res {
        Ok(r) => Ok(r),
        Err(e) => {
            error!(error = ?e, path = %path, "UI server handler error");
            Ok(text_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain",
                "Internal server error",
            ))
        }
    }
}

async fn addon_proxy(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let url_param = parse_query(qs)
        .into_iter()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v);
    let target = match url_param {
        Some(u) => u,
        None => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Missing url")),
    };

    let parsed = match url::Url::parse(&target) {
        Ok(u) => u,
        Err(_) => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Invalid url")),
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Unsupported protocol"));
    }
    // Forbid proxying to localhost — except the local stremio-server
    // on port 11470. That server is bundled and supervised by the
    // shell itself, so we can trust it; specific allowed paths are
    //   /local-addon/* (legacy addons baked into stremio-service)
    //   /subtitles.vtt (SRT/SSA -> VTT + encoding normalization)
    //   /opensubHash   (compute OpenSubtitles 8-byte hash for sync)
    let mut bypass_upstream = false;
    if let Some(host) = parsed.host_str() {
        if matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::1") {
            let path = parsed.path();
            let is_streaming_server = parsed.port() == Some(11470)
                && (path.starts_with("/local-addon/")
                    || path == "/subtitles.vtt"
                    || path == "/opensubHash");
            if !is_streaming_server {
                return Ok(text_response(StatusCode::FORBIDDEN, "text/plain", "Forbidden host"));
            }
            // Localhost targets can't be reached by the public upstream
            // addon-proxy; forward DIRECTLY from the shell.
            bypass_upstream = true;
        }
    }

    if bypass_upstream {
        return forward_url(req, &target).await;
    }

    // Proxy through blissful.budinoff.com first so the upstream addon-proxy
    // handles addon authentication/quirks; the React app's existing
    // behavior on the web build uses the same upstream.
    let full = format!("{}?url={}", ADDON_PROXY_UPSTREAM, urlencoding::encode(&target));
    forward_url(req, &full).await
}

async fn resolve_url(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let url_param = parse_query(qs)
        .into_iter()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v);
    let target = match url_param {
        Some(u) => u,
        None => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Missing url")),
    };

    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let resp = client
        .head(&target)
        .timeout(Duration::from_secs(10))
        .send()
        .await;
    let (final_url, content_length, status) = match resp {
        Ok(r) => {
            let url = r.url().to_string();
            let len = r
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            let status = r.status().as_u16();
            (url, len, status)
        }
        Err(e) => {
            warn!(error = ?e, target = %target, "resolve-url HEAD failed; returning original");
            (target, 0u64, 0u16)
        }
    };

    let body = serde_json::json!({
        "url": final_url,
        "contentLength": content_length,
        "status": status,
    })
    .to_string();
    Ok(text_response(StatusCode::OK, "application/json", body))
}

async fn forward_to_upstream(
    req: &Request<Incoming>,
    upstream_base: &str,
    suffix: &str,
) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let mut target = format!("{}{}", upstream_base, suffix);
    if !qs.is_empty() {
        target.push('?');
        target.push_str(qs);
    }
    forward_url(req, &target).await
}

/// Full-method proxy: forwards request method, body, AND headers to the
/// upstream. Used by /storage/* and /stremio/* so POST /storage/state
/// (state save) actually carries the user's settings JSON and the
/// `x-stremio-auth` header reaches the storage server. Without this,
/// every storage write silently became a GET-with-no-auth and the
/// server returned 401 on every read for users who DO exist in the
/// backend MongoDB.
async fn forward_request(
    req: Request<Incoming>,
    upstream_base: &str,
    suffix: &str,
) -> Result<Response<BoxBody>> {
    const FORWARDED_HEADERS: &[&str] = &[
        "range",
        "x-stremio-auth",
        "authorization",
        "content-type",
        "if-none-match",
        "if-modified-since",
    ];
    let qs = req.uri().query().map(String::from).unwrap_or_default();
    let mut target = format!("{}{}", upstream_base, suffix);
    if !qs.is_empty() {
        target.push('?');
        target.push_str(&qs);
    }
    let method = req.method().clone();
    let headers = req.headers().clone();
    let body_bytes = req
        .into_body()
        .collect()
        .await
        .map(|c| c.to_bytes())
        .unwrap_or_default();

    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return Ok(text_response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", "bad method")),
    };
    let mut upstream_req = client.request(reqwest_method, &target);
    for name in FORWARDED_HEADERS {
        if let Some(v) = headers.get(*name) {
            if let Ok(s) = v.to_str() {
                upstream_req = upstream_req.header(*name, s);
            }
        }
    }
    if !body_bytes.is_empty() {
        upstream_req = upstream_req.body(body_bytes.to_vec());
    }
    let upstream_res = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            warn!(error = ?e, target = %target, "forward_request upstream failed");
            return Ok(text_response(
                StatusCode::BAD_GATEWAY,
                "text/plain",
                "Upstream error",
            ));
        }
    };
    let status = upstream_res.status();
    let mut out_headers = HeaderMap::new();
    for (k, v) in upstream_res.headers() {
        let name = k.as_str().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "connection"
                | "transfer-encoding"
                | "keep-alive"
                | "upgrade"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailers"
                | "content-encoding"
                | "content-length"
        ) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_str().as_bytes()),
            HeaderValue::from_bytes(v.as_bytes()),
        ) {
            out_headers.insert(name, val);
        }
    }
    let bytes = upstream_res.bytes().await.unwrap_or_default();
    let mut builder = Response::builder().status(status.as_u16());
    for (k, v) in out_headers.iter() {
        builder = builder.header(k, v);
    }
    let body = Full::new(bytes).map_err(|never| match never {}).boxed();
    Ok(builder.body(body).expect("forward_request response build"))
}

async fn forward_url(req: &Request<Incoming>, target: &str) -> Result<Response<BoxBody>> {
    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let mut upstream_req = client.get(target);
    // Forward request-bearing headers the upstream cares about. The
    // storage server identifies the user via `x-stremio-auth`; without
    // it, every /storage/* request comes back 401 even when the user
    // exists in MongoDB. Pass through a curated allow-list rather than
    // blanket-forwarding so we don't leak hop-by-hop or browser-only
    // headers into the upstream request.
    const FORWARDED_HEADERS: &[&str] = &[
        "range",
        "x-stremio-auth",
        "authorization",
        "if-none-match",
        "if-modified-since",
    ];
    for name in FORWARDED_HEADERS {
        if let Some(v) = req.headers().get(*name) {
            if let Ok(s) = v.to_str() {
                upstream_req = upstream_req.header(*name, s);
            }
        }
    }
    let upstream_res = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            warn!(error = ?e, target = %target, "upstream fetch failed");
            return Ok(text_response(
                StatusCode::BAD_GATEWAY,
                "text/plain",
                "Upstream error",
            ));
        }
    };
    let status = upstream_res.status();
    let mut headers = HeaderMap::new();
    for (k, v) in upstream_res.headers() {
        // Strip hop-by-hop / connection-specific headers so the renderer
        // doesn't try to follow them.
        let name = k.as_str().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "connection"
                | "transfer-encoding"
                | "keep-alive"
                | "upgrade"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailers"
                | "content-encoding"
                | "content-length"
        ) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_str().as_bytes()), HeaderValue::from_bytes(v.as_bytes())) {
            headers.insert(name, val);
        }
    }
    let bytes = upstream_res.bytes().await.unwrap_or_default();
    let mut builder = Response::builder().status(status.as_u16());
    for (k, v) in headers.iter() {
        builder = builder.header(k, v);
    }
    let body = Full::new(bytes).map_err(|never| match never {}).boxed();
    Ok(builder.body(body).expect("response build"))
}

async fn serve_static_or_vite(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    if let Some(root) = STATIC_ROOT.get().cloned().flatten() {
        // Production: serve from disk. SPA fallback — non-asset paths
        // route to index.html so React Router can take over.
        let path = req.uri().path();
        let is_asset = path.starts_with("/assets/") || path.contains('.');
        let target = if is_asset {
            root.join(path.trim_start_matches('/'))
        } else {
            root.join("index.html")
        };
        if let Ok(body) = tokio::fs::read(&target).await {
            let ct = guess_content_type(&target);
            let body = Full::new(Bytes::from(body)).map_err(|never| match never {}).boxed();
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header("content-type", ct)
                .body(body)
                .expect("static response build"));
        }
        return Ok(text_response(StatusCode::NOT_FOUND, "text/plain", "Not found"));
    }

    // Dev: proxy to Vite. Vite serves the React app + handles HMR via
    // websocket on the same origin (ws://localhost:5173/...).
    let mut target = format!("{}{}", VITE_DEV_ORIGIN, req.uri().path());
    if let Some(qs) = req.uri().query() {
        target.push('?');
        target.push_str(qs);
    }
    forward_url(req, &target).await
}

fn guess_content_type(path: &PathBuf) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn text_response(status: StatusCode, ct: &str, body: impl Into<String>) -> Response<BoxBody> {
    let s = body.into();
    let body = Full::new(Bytes::from(s)).map_err(|never| match never {}).boxed();
    Response::builder()
        .status(status)
        .header("content-type", ct)
        .body(body)
        .expect("text response build")
}

fn parse_query(qs: &str) -> Vec<(String, String)> {
    qs.split('&')
        .filter_map(|kv| {
            let mut it = kv.splitn(2, '=');
            let k = it.next()?;
            let v = it.next().unwrap_or("");
            Some((
                urlencoding::decode(k).ok()?.into_owned(),
                urlencoding::decode(v).ok()?.into_owned(),
            ))
        })
        .collect()
}

// Suppress empty-body warning paths.
#[allow(dead_code)]
fn empty_body() -> BoxBody {
    Empty::<Bytes>::new().map_err(|never| match never {}).boxed()
}
