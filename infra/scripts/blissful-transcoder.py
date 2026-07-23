#!/usr/bin/env python3
"""Blissful host-side transcoder (runs natively on the Mac, driven by launchd).

The addon-proxy runs inside Docker's Linux VM, where Apple Silicon's hardware
H.264 encoder (h264_videotoolbox) isn't reachable — so its /transcode-seg used
software libx264 across every core and pinned the Mac at ~85°C on just two
streams. This service runs ffmpeg ON THE macOS HOST, where VideoToolbox offloads
encoding to the dedicated media engine (~6× less CPU, barely any heat), so the
Mac can serve many concurrent transcodes.

The proxy resolves the (RD) source URL + builds the HLS playlist as before, then
proxies each SEGMENT encode to this service over host.docker.internal. We only
do the heavy lifting (the per-segment re-encode); everything else stays in the
proxy.

Endpoint (secret-guarded, mirrors the proxy's /transcode-seg):
  GET /seg?url=<direct media url>&n=<segment index>&a=<audio track>&secret=<s>
    → streams a 6s MPEG-TS segment (H.264 via VideoToolbox + AAC).
  GET /health

Driven by infra/launchd/com.budinoff.blissful-transcoder.plist.
"""
from __future__ import annotations

import hashlib
import os
import signal
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("BLISSFUL_TRANSCODER_PORT", "13098"))
SEG = 6  # seconds per segment — must match the proxy's playlist SEG.
VBITRATE = os.environ.get("TRANSCODE_VBITRATE", "6000k")
VMAXRATE = os.environ.get("TRANSCODE_VMAXRATE", "9000k")
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")

# Segment cache. Each (source, segment, audio-track) is encoded AT MOST ONCE and
# reused — so a whole watch party (all guests load the SAME transcode URL) shares
# a single transcode instead of every guest re-encoding the same source. Seeking
# is free for any segment already cached; the host's own seek-backs hit it too.
# Cached on the Mac's local SSD (fast, no NAS/TCC issues), pruned by age.
CACHE_DIR = os.environ.get(
    "TRANSCODE_CACHE_DIR",
    os.path.expanduser("~/Library/Caches/blissful-transcode"),
)
CACHE_TTL = float(os.environ.get("TRANSCODE_CACHE_TTL", "21600"))  # 6 h
os.makedirs(CACHE_DIR, exist_ok=True)

# Watchdog: a stalled RD connection leaves ffmpeg blocked on a dead socket
# forever (observed 2026-07-24: four zombie encodes hours old, each pinning an
# HTTPS connection). A healthy 6s segment encodes in ~3s; anything past this is
# dead — kill it so the client's retry gets a fresh connection.
ENCODE_TIMEOUT = float(os.environ.get("TRANSCODE_ENCODE_TIMEOUT", "45"))

# Prefetch: encode the next N segments in the background whenever a segment is
# requested. The request-driven cadence alone nets ~1.0x realtime (fresh TLS
# connection + remote MKV open per segment eats ~40% of each segment's budget),
# so the client buffer never builds headroom and playback stutters at every
# hiccup. Prefetch keeps the media engine busy during client idle gaps.
PREFETCH = int(os.environ.get("TRANSCODE_PREFETCH", "3"))
_prefetch_slots = threading.BoundedSemaphore(
    int(os.environ.get("TRANSCODE_PREFETCH_CONCURRENCY", "2"))
)

# Coalesce concurrent identical encodes (two guests requesting the same segment
# before it's cached) into ONE — the rest wait, then read the cache.
_inflight_lock = threading.Lock()
_inflight: dict[str, threading.Event] = {}


def cache_key(url: str, n: int, audio_idx: int) -> str:
    return hashlib.sha1(f"{url}|{n}|{audio_idx}".encode("utf-8")).hexdigest()


def cache_path(key: str) -> str:
    return os.path.join(CACHE_DIR, key[:2], key + ".ts")


def encode_segment(url: str, n: int, audio_idx: int, out_path: str) -> tuple[bool, bytes]:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = f"{out_path}.tmp{os.getpid()}.{threading.get_ident()}"
    try:
        with open(tmp, "wb") as f:
            proc = subprocess.Popen(seg_args(url, n, audio_idx), stdout=f, stderr=subprocess.PIPE)
            try:
                _, err = proc.communicate(timeout=ENCODE_TIMEOUT)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                err = f"watchdog killed encode after {ENCODE_TIMEOUT:.0f}s".encode("utf-8")
        if proc.returncode == 0 and os.path.getsize(tmp) > 0:
            os.replace(tmp, out_path)  # atomic publish
            return True, b""
    except Exception as e:  # noqa: BLE001
        err = str(e).encode("utf-8")
    try:
        os.remove(tmp)
    except OSError:
        pass
    return False, (err or b"")[-200:]


def ensure_segment(url: str, n: int, audio_idx: int, quiet: bool = False) -> tuple[bool, str]:
    """Make sure (url, n, audio_idx) is in the cache; encode it if needed.

    Coalesces with any in-flight encode of the same key: if another thread is
    already encoding this segment, wait for it and reuse the result — taking
    over as encoder if it failed. Returns (ok, cache_path).
    """
    key = cache_key(url, n, audio_idx)
    path = cache_path(key)
    for _attempt in range(3):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return True, path
        with _inflight_lock:
            ev = _inflight.get(key)
            am_encoder = ev is None
            if am_encoder:
                ev = threading.Event()
                _inflight[key] = ev
        if not am_encoder:
            # Another request/prefetch is encoding this exact segment — wait,
            # then loop: cache hit if it succeeded, else become the encoder.
            ev.wait(timeout=ENCODE_TIMEOUT + 15)
            continue
        try:
            ok, err = encode_segment(url, n, audio_idx, path)
        finally:
            with _inflight_lock:
                _inflight.pop(key, None)
            ev.set()
        if not ok and not quiet:
            log(f"seg n={n} encode failed: {err.decode('utf-8', 'replace').strip()}")
        return ok, path
    return (os.path.exists(path) and os.path.getsize(path) > 0), path


def prefetch_segment(url: str, n: int, audio_idx: int) -> None:
    """Opportunistic background encode of an upcoming segment. Skips work that
    is already cached or in flight; bounded by _prefetch_slots so a seek can't
    stampede the media engine. quiet=True — running past the end of the file is
    expected on the last few segments and shouldn't spam the log."""
    key = cache_key(url, n, audio_idx)
    path = cache_path(key)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    with _inflight_lock:
        if key in _inflight:
            return
    if not _prefetch_slots.acquire(blocking=False):
        return  # engine busy — the on-demand path will pick it up if needed
    try:
        ensure_segment(url, n, audio_idx, quiet=True)
    finally:
        _prefetch_slots.release()


def prune_cache_loop():
    while True:
        time.sleep(1800)  # every 30 min
        cutoff = time.time() - CACHE_TTL
        try:
            for root, _dirs, files in os.walk(CACHE_DIR):
                for name in files:
                    p = os.path.join(root, name)
                    try:
                        if os.path.getmtime(p) < cutoff:
                            os.remove(p)
                    except OSError:
                        pass
        except OSError:
            pass


def log(msg: str) -> None:
    print(f"[transcoder] {time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_secret() -> str:
    s = os.environ.get("TRANSCODE_SECRET", "").strip()
    if s:
        return s
    # Fall back to the repo-root .env (same pattern as the videasy resolver).
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.normpath(os.path.join(here, "..", "..", ".env"))
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TRANSCODE_SECRET="):
                    return line.split("=", 1)[1].strip().strip("'\"")
                # Reuse the videasy secret if a dedicated one isn't set.
                if line.startswith("VIDEASY_TOKEN_SECRET="):
                    fallback = line.split("=", 1)[1].strip().strip("'\"")
                    os.environ.setdefault("_TRANSCODE_FALLBACK_SECRET", fallback)
    except OSError:
        pass
    return os.environ.get("_TRANSCODE_FALLBACK_SECRET", "")


SECRET = load_secret()


def seg_args(url: str, n: int, audio_idx: int) -> list[str]:
    start = n * SEG
    return [
        FFMPEG, "-hide_banner", "-loglevel", "error",
        # Hardware DECODE on the media engine too — decoding 4K HEVC in software
        # was the real CPU hog (the encode is already offloaded). videotoolbox
        # falls back to software automatically for codecs it can't decode, so
        # this is safe for any source.
        "-hwaccel", "videotoolbox",
        # Ride out transient RD throttling (429/5xx) instead of failing the
        # segment — mirrors the proxy's in-container args.
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "8",
        "-reconnect_on_http_error", "429,500,502,503,504",
        "-ss", str(start), "-i", url, "-t", str(SEG),
        "-map", "0:v:0", "-map", f"0:a:{audio_idx}?", "-sn", "-dn",
        # Hardware H.264 — the whole point: encode on the media engine, not the
        # CPU cores.
        "-c:v", "h264_videotoolbox",
        "-b:v", VBITRATE, "-maxrate", VMAXRATE, "-bufsize", "12000k",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ac", "2", "-b:a", "160k",
        # Place the independently-encoded segment at its true timeline position
        # so HLS.js appends them contiguously (identical to the proxy path).
        "-output_ts_offset", str(start),
        "-muxdelay", "0", "-muxpreload", "0",
        "-f", "mpegts", "pipe:1",
    ]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # silence default access logging
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/health":
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path != "/seg":
            self.send_error(404)
            return
        if not SECRET or q.get("secret", [""])[0] != SECRET:
            self.send_error(403)
            return
        url = q.get("url", [""])[0]
        if not url.startswith("http://") and not url.startswith("https://"):
            self.send_error(400)
            return
        try:
            n = int(q.get("n", ["0"])[0])
            audio_idx = int(q.get("a", ["0"])[0])
        except ValueError:
            self.send_error(400)
            return
        if n < 0 or audio_idx < 0:
            self.send_error(400)
            return

        # Kick the prefetchers first so the next segments encode WHILE this one
        # is encoded/served — they dedupe against cache + in-flight and exit
        # instantly when there's nothing to do.
        for i in range(1, PREFETCH + 1):
            threading.Thread(
                target=prefetch_segment, args=(url, n + i, audio_idx), daemon=True
            ).start()

        # Cache hit serves straight from disk (watch-party guests after the
        # first, seek-backs, and everything the prefetcher got to in time);
        # otherwise encode — coalesced with any identical in-flight request.
        ok, path = ensure_segment(url, n, audio_idx)
        if not ok:
            self.send_error(502)
            return
        self._serve_file(path)

    def _serve_file(self, path: str):
        try:
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", "video/mp2t")
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client seeked/closed mid-stream — fine, segment is cached
        except OSError as e:
            log(f"serve {os.path.basename(path)} error: {e}")


def main():
    if not SECRET:
        log("WARN no TRANSCODE_SECRET / VIDEASY_TOKEN_SECRET — /seg will reject all requests")
    # Verify the hardware encoder is actually present (else this whole service is
    # pointless — better to fail loudly).
    try:
        out = subprocess.run([FFMPEG, "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=15).stdout
        if "h264_videotoolbox" not in out:
            log("WARN h264_videotoolbox NOT in this ffmpeg — segments will fail")
        else:
            log("h264_videotoolbox available — hardware encoding active")
    except Exception as e:  # noqa: BLE001
        log(f"WARN could not probe ffmpeg encoders: {e}")
    signal.signal(signal.SIGTERM, lambda *_a: os._exit(0))
    signal.signal(signal.SIGINT, lambda *_a: os._exit(0))
    threading.Thread(target=prune_cache_loop, daemon=True).start()
    log(f"segment cache: {CACHE_DIR} (ttl {int(CACHE_TTL/3600)}h)")
    log(f"prefetch depth {PREFETCH}, encode watchdog {int(ENCODE_TIMEOUT)}s")
    log(f"listening on 0.0.0.0:{PORT}")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
