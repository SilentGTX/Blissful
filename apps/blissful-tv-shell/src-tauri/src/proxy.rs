// Same-origin reverse proxy for Android — a faithful port of the Windows
// shell's apps/blissful-shell/src/ui_server.rs, minus the static-file/Vite
// serving (Tauri serves the React build itself from http://tauri.localhost).
//
// WHY THIS EXISTS
// The React UI fetches RELATIVE paths everywhere: `/addon-proxy?url=...`,
// `/storage/state`, `/stremio/...`, `/resolve-url?url=...`,
// `/tmdb-season-info?...`. On the desktop those are served same-origin by
// ui_server.rs so CORS never trips. Under the Tauri WebView origin
// (http://tauri.localhost) nothing serves them. We re-serve them here on a
// FIXED loopback port and point the UI's network base at this origin on
// Android (see apps/blissful-mvs/src/lib/proxyBase.ts).
//
// SECURITY: `classify_addon_proxy_target` and the FORWARDED_HEADERS allow-list
// are ported VERBATIM from ui_server.rs (including the IPv6-loopback-leak fix
// and the 11470 stremio-service bypass). The unit tests come along with them —
// any new bypass host / allowed path MUST be covered by a test.
//
// MIXED-CONTENT NOTE: the page is served on the cleartext `http://tauri.localhost`
// scheme, so fetching this cleartext `http://127.0.0.1:11471` proxy is NOT
// mixed content. The Android manifest must allow cleartext to 127.0.0.1 (see
// gen/android/MANIFEST_PATCH.md). Do NOT switch the WebView to https without
// also moving this proxy behind TLS, or every fetch will be blocked.

use anyhow::{Context, Result};
use futures_util::StreamExt;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use once_cell::sync::OnceCell;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Client;
use std::convert::Infallible;
use std::time::Duration;
use tokio::net::TcpListener;
use tracing::{debug, error, info, warn};

/// Fixed loopback port. The UI hardcodes this in proxyBase.ts, so it must stay
/// in sync. 11471 sits next to the streaming server's 11470.
pub const PROXY_PORT: u16 = 11471;

const ADDON_PROXY_UPSTREAM: &str = "https://blissful.budinoff.com/addon-proxy";
const STORAGE_UPSTREAM: &str = "https://blissful.budinoff.com/storage";
const STREMIO_UPSTREAM: &str = "https://www.strem.io";
const TMDB_UPSTREAM: &str = "https://blissful.budinoff.com/tmdb-season-info";
// IMDb->TMDB id lookup using the backend's TMDB key (the no-user-key fallback
// in tmdb.ts). The desktop ui_server.rs never proxied this route (it only
// worked on the web build where the page was same-origin to the backend); we
// add it so the fallback works on Android too. If the backend lacks the route
// it 404s and the UI degrades to null (user must set their own TMDB key).
const TMDB_FIND_UPSTREAM: &str = "https://blissful.budinoff.com/tmdb-find";

static HTTP_CLIENT: OnceCell<Client> = OnceCell::new();

type BoxBody = http_body_util::combinators::BoxBody<Bytes, std::io::Error>;

/// Spawn the proxy on a dedicated Tokio runtime thread. Returns immediately;
/// the thread runs until the process exits. Call once from the Tauri setup
/// hook.
pub fn spawn() -> Result<()> {
    let client = Client::builder()
        .pool_idle_timeout(Duration::from_secs(20))
        .build()
        .context("build reqwest client")?;
    let _ = HTTP_CLIENT.set(client);

    std::thread::Builder::new()
        .name("blissful-proxy".into())
        .spawn(|| {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("build tokio runtime for proxy");
            rt.block_on(async {
                if let Err(e) = run_server().await {
                    error!(error = ?e, "blissful proxy stopped");
                }
            });
        })
        .context("spawn proxy thread")?;
    Ok(())
}

async fn run_server() -> Result<()> {
    let addr: std::net::SocketAddr = ([127, 0, 0, 1], PROXY_PORT).into();
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("bind proxy on {addr}"))?;
    info!(port = PROXY_PORT, "blissful proxy listening");

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                warn!(error = ?e, "proxy accept failed");
                continue;
            }
        };
        let io = TokioIo::new(stream);
        tokio::spawn(async move {
            let svc = service_fn(handle_request);
            if let Err(e) = http1::Builder::new().serve_connection(io, svc).await {
                debug!(error = ?e, "proxy connection closed with error");
            }
        });
    }
}

async fn handle_request(req: Request<Incoming>) -> Result<Response<BoxBody>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    let res = match (&method, path.as_str()) {
        (&Method::GET, "/addon-proxy") => addon_proxy(&req).await,
        (&Method::GET, "/resolve-url") => resolve_url(&req).await,
        (&Method::GET, "/stream") => stream_url(&req).await,
        (_, p) if p.starts_with("/storage/") => {
            let suffix = p["/storage".len()..].to_string();
            forward_request(req, STORAGE_UPSTREAM, &suffix).await
        }
        (_, p) if p.starts_with("/stremio/") => {
            let suffix = p["/stremio".len()..].to_string();
            forward_request(req, STREMIO_UPSTREAM, &suffix).await
        }
        (&Method::GET, "/tmdb-season-info") => forward_request(req, TMDB_UPSTREAM, "").await,
        (&Method::GET, "/tmdb-find") => forward_request(req, TMDB_FIND_UPSTREAM, "").await,
        // CORS preflight for browsers that send it (the WebView fetch to this
        // loopback origin is cross-origin to tauri.localhost).
        (&Method::OPTIONS, _) => Ok(cors_preflight()),
        // Everything else is served by Tauri's own asset host, not here.
        _ => Ok(text_response(StatusCode::NOT_FOUND, "text/plain", "Not found (served by Tauri)")),
    };
    let mut response = match res {
        Ok(r) => r,
        Err(e) => {
            error!(error = ?e, path = %path, "proxy handler error");
            text_response(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", "Internal server error")
        }
    };
    // The page origin (http://tauri.localhost) differs from this proxy origin
    // (http://127.0.0.1:11471), so responses need permissive CORS. The proxy is
    // bound to loopback and only reachable by this app's own WebView.
    add_cors(response.headers_mut());
    Ok(response)
}

// ----------------------------------------------------------------------------
// Security-critical classification — ported verbatim from ui_server.rs.
// ----------------------------------------------------------------------------

/// Decision the addon-proxy reaches after validating the requested target URL.
/// Pure function so the host/path gating is exhaustively unit-testable.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AddonProxyDecision {
    BadRequest(&'static str),
    Forbidden,
    BypassUpstream,
    ProxyUpstream,
}

pub(crate) fn classify_addon_proxy_target(target: &str) -> AddonProxyDecision {
    let parsed = match url::Url::parse(target) {
        Ok(u) => u,
        Err(_) => return AddonProxyDecision::BadRequest("Invalid url"),
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return AddonProxyDecision::BadRequest("Unsupported protocol");
    }
    // Branch on the typed Host variant so IPv6 loopback (`[::1]`) can't leak to
    // the public proxy (the bracket-vs-no-bracket bug the desktop test caught).
    let is_loopback = match parsed.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(addr)) => addr.is_loopback() || addr == std::net::Ipv4Addr::UNSPECIFIED,
        Some(url::Host::Ipv6(addr)) => addr.is_loopback() || addr == std::net::Ipv6Addr::UNSPECIFIED,
        None => false,
    };
    if is_loopback {
        let path = parsed.path();
        let is_streaming_server = parsed.port() == Some(11470)
            && (path.starts_with("/local-addon/")
                || path == "/subtitles.vtt"
                || path == "/opensubHash");
        return if is_streaming_server {
            AddonProxyDecision::BypassUpstream
        } else {
            AddonProxyDecision::Forbidden
        };
    }
    AddonProxyDecision::ProxyUpstream
}

async fn addon_proxy(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let target = match parse_query(qs).into_iter().find(|(k, _)| k == "url").map(|(_, v)| v) {
        Some(u) => u,
        None => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Missing url")),
    };
    match classify_addon_proxy_target(&target) {
        AddonProxyDecision::BadRequest(msg) => Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", msg)),
        AddonProxyDecision::Forbidden => Ok(text_response(StatusCode::FORBIDDEN, "text/plain", "Forbidden host")),
        AddonProxyDecision::BypassUpstream => forward_url(req, &target).await,
        AddonProxyDecision::ProxyUpstream => {
            let full = format!("{}?url={}", ADDON_PROXY_UPSTREAM, urlencoding::encode(&target));
            forward_url(req, &full).await
        }
    }
}

async fn resolve_url(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let target = match parse_query(qs).into_iter().find(|(k, _)| k == "url").map(|(_, v)| v) {
        Some(u) => u,
        None => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Missing url")),
    };
    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let (final_url, content_length, status) = match client
        .head(&target)
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => {
            let url = r.url().to_string();
            let len = r
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            (url, len, r.status().as_u16())
        }
        Err(e) => {
            warn!(error = ?e, target = %target, "resolve-url HEAD failed; returning original");
            (target, 0u64, 0u16)
        }
    };
    let body = serde_json::json!({ "url": final_url, "contentLength": content_length, "status": status })
        .to_string();
    Ok(text_response(StatusCode::OK, "application/json", body))
}

/// STREAMING media relay (Android playback path). mpv on the TV opens
/// `http://127.0.0.1:11471/stream?url=<debrid CDN url>` instead of the CDN URL
/// directly. Two wins on a low-end TV:
///   1. mpv's ffmpeg connects to loopback INSTANTLY — it never pays the bundled
///      ffmpeg's ~14 s IPv6 connect timeout (no Happy-Eyeballs); reqwest (which
///      has Happy-Eyeballs + a pooled keep-alive connection) does the real
///      connect ONCE and reuses the socket across the MKV-header-at-EOF seek.
///   2. The body is forwarded CHUNK-BY-CHUNK (reqwest bytes_stream -> hyper
///      StreamBody), never buffered — safe for a 1.75 GB file on ~1.3 GB RAM
///      (unlike `relay_response`, which buffers and is only used for small
///      JSON). The inbound Range header is forwarded and Content-Range/-Length/
///      Accept-Ranges are passed through so byte-range seeks work.
/// SSRF-guarded by the same classifier as /addon-proxy (public http(s) only).
async fn stream_url(req: &Request<Incoming>) -> Result<Response<BoxBody>> {
    let qs = req.uri().query().unwrap_or("");
    let target = match parse_query(qs).into_iter().find(|(k, _)| k == "url").map(|(_, v)| v) {
        Some(u) => u,
        None => return Ok(text_response(StatusCode::BAD_REQUEST, "text/plain", "Missing url")),
    };
    if classify_addon_proxy_target(&target) != AddonProxyDecision::ProxyUpstream {
        return Ok(text_response(StatusCode::FORBIDDEN, "text/plain", "Forbidden host"));
    }
    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let mut upstream_req = client.get(&target);
    // Forward Range so mpv's seek-to-EOF (MKV header/cues) becomes a 206 fetch.
    if let Some(v) = req.headers().get(reqwest::header::RANGE) {
        if let Ok(s) = v.to_str() {
            upstream_req = upstream_req.header(reqwest::header::RANGE, s);
        }
    }
    let upstream_res = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            warn!(error = ?e, target = %target, "stream relay upstream failed");
            return Ok(text_response(StatusCode::BAD_GATEWAY, "text/plain", "Upstream error"));
        }
    };
    let status = upstream_res.status();
    let mut builder = Response::builder().status(status.as_u16());
    // Pass through only the headers mpv needs for seekable streaming.
    for name in ["content-type", "content-length", "content-range", "accept-ranges"] {
        if let Some(v) = upstream_res.headers().get(name) {
            builder = builder.header(name, v.clone());
        }
    }
    // Stream the body as it arrives — never collect the whole 1.75 GB file.
    let stream = upstream_res.bytes_stream().map(|chunk| {
        chunk
            .map(Frame::data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    });
    // Disambiguate: BodyExt::boxed (Body -> BoxBody), NOT StreamExt::boxed.
    let body = BodyExt::boxed(StreamBody::new(stream));
    Ok(builder.body(body).expect("stream response build"))
}

/// Full-method proxy: forwards method, body, AND a curated header allow-list to
/// the upstream (so POST /storage/state carries the settings JSON + the
/// x-stremio-auth/authorization headers reach the storage server).
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
    let body_bytes = req.into_body().collect().await.map(|c| c.to_bytes()).unwrap_or_default();

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
            return Ok(text_response(StatusCode::BAD_GATEWAY, "text/plain", "Upstream error"));
        }
    };
    relay_response(upstream_res).await
}

async fn forward_url(req: &Request<Incoming>, target: &str) -> Result<Response<BoxBody>> {
    const FORWARDED_HEADERS: &[&str] =
        &["range", "x-stremio-auth", "authorization", "if-none-match", "if-modified-since"];
    let client = HTTP_CLIENT.get().expect("HTTP_CLIENT initialized");
    let mut upstream_req = client.get(target);
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
            return Ok(text_response(StatusCode::BAD_GATEWAY, "text/plain", "Upstream error"));
        }
    };
    relay_response(upstream_res).await
}

async fn relay_response(upstream_res: reqwest::Response) -> Result<Response<BoxBody>> {
    let status = upstream_res.status();
    let mut headers = HeaderMap::new();
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
            headers.insert(name, val);
        }
    }
    let bytes = upstream_res.bytes().await.unwrap_or_default();
    let mut builder = Response::builder().status(status.as_u16());
    for (k, v) in headers.iter() {
        builder = builder.header(k, v);
    }
    let body = Full::new(bytes).map_err(|never| match never {}).boxed();
    Ok(builder.body(body).expect("relay response build"))
}

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

fn add_cors(h: &mut HeaderMap) {
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("range,x-stremio-auth,authorization,content-type,if-none-match,if-modified-since"),
    );
    h.insert("access-control-allow-methods", HeaderValue::from_static("GET,POST,PUT,DELETE,OPTIONS"));
}

fn cors_preflight() -> Response<BoxBody> {
    let body = Full::new(Bytes::new()).map_err(|never| match never {}).boxed();
    let mut r = Response::builder().status(StatusCode::NO_CONTENT).body(body).expect("preflight build");
    add_cors(r.headers_mut());
    r
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

#[cfg(test)]
mod tests {
    use super::AddonProxyDecision::*;
    use super::{classify_addon_proxy_target, AddonProxyDecision};

    #[test]
    fn rejects_unparseable_url() {
        assert!(matches!(classify_addon_proxy_target("not a url at all"), AddonProxyDecision::BadRequest(_)));
    }

    #[test]
    fn rejects_unsupported_scheme() {
        for scheme in ["javascript", "data", "file", "ftp"] {
            let url = format!("{scheme}://anything");
            assert!(matches!(classify_addon_proxy_target(&url), AddonProxyDecision::BadRequest(_)));
        }
    }

    #[test]
    fn forbids_localhost_outside_streaming_server() {
        assert_eq!(classify_addon_proxy_target("http://127.0.0.1:8080/anything"), Forbidden);
        assert_eq!(classify_addon_proxy_target("http://127.0.0.1:11470/admin"), Forbidden);
        assert_eq!(classify_addon_proxy_target("http://localhost:9999/foo"), Forbidden);
        assert_eq!(classify_addon_proxy_target("http://0.0.0.0:11470/secret"), Forbidden);
    }

    #[test]
    fn bypasses_upstream_for_streaming_server_allowed_paths() {
        for url in [
            "http://127.0.0.1:11470/local-addon/cinemeta",
            "http://localhost:11470/local-addon/anything",
            "http://127.0.0.1:11470/subtitles.vtt",
            "http://127.0.0.1:11470/opensubHash",
        ] {
            assert_eq!(classify_addon_proxy_target(url), BypassUpstream, "{url} should bypass");
        }
    }

    #[test]
    fn proxies_public_https_through_upstream() {
        assert_eq!(classify_addon_proxy_target("https://torrentio.strem.fun/manifest.json"), ProxyUpstream);
        assert_eq!(classify_addon_proxy_target("http://example.com/manifest.json"), ProxyUpstream);
    }

    #[test]
    fn ipv6_loopback_does_not_leak_to_public_proxy() {
        assert_ne!(classify_addon_proxy_target("http://[::1]:9999/admin"), ProxyUpstream);
    }

    #[test]
    fn local_addon_path_must_start_with_prefix() {
        assert_eq!(classify_addon_proxy_target("http://127.0.0.1:11470/local-addonshenanigans"), Forbidden);
    }
}
