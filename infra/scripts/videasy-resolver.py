#!/usr/bin/env python3
"""Videasy source resolver (runs on the Mac, driven by launchd).

Videasy gated /sources-with-title behind Cloudflare Turnstile AND moved the
response to a `v2:` CryptoJS-Salted payload whose passphrase lives in their
player JS and rotates. Rather than fight either (Turnstile blocks automation;
the cipher is an arms race), we let Videasy's OWN player do the work:

  * undetected-chromedriver drives a real Chrome that passes Turnstile, and
  * a `JSON.parse` hook injected at document-start harvests the *decrypted*
    {sources, subtitles} the player produces client-side.

A warm browser is kept open; the addon-proxy asks this service for sources per
title over localhost (GET /resolve, secret-guarded). Because we never decrypt
anything, this survives Videasy's cipher changes (v2 -> v3 -> ...).

Driven by infra/launchd/com.budinoff.videasy-resolver.plist (RunAtLoad +
KeepAlive, GUI session for headed Chrome).
"""
from __future__ import annotations

import atexit
import json
import os
import re
import signal
import threading
import time
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("VIDEASY_RESOLVER_PORT", "13099"))
HARVEST_TIMEOUT = float(os.environ.get("VIDEASY_RESOLVE_TIMEOUT", "28"))
# Recycle rarely — every (re)launch briefly grabs focus on the Mac, and the
# 0-sources retry already recreates the browser if its session ever goes stale.
RECYCLE_AFTER = int(os.environ.get("VIDEASY_RESOLVER_RECYCLE", "500"))
RECYCLE_AGE = float(os.environ.get("VIDEASY_RESOLVER_RECYCLE_AGE", "21600"))  # 6 h
# Keep the browser warm: prime at startup + a periodic dummy resolve, so users
# never hit a cold (Turnstile-not-yet-cleared) Chrome that 0-sources for ~60s
# and falls everything back to RD. The keep-alive also re-primes the new browser
# right after a recycle.
WARM_INTERVAL = int(os.environ.get("VIDEASY_RESOLVER_WARM_INTERVAL", "900"))  # 15 min
WARM_TMDB = os.environ.get("VIDEASY_RESOLVER_WARM_TMDB", "550")  # Fight Club — always on Vidking

# JSON.parse hook: capture any parsed string that looks like a sources or
# subtitle payload. Re-installed on every new document (so window.__caps
# resets per navigation). Ad payloads (no `sources` array) are filtered later.
HOOK = r"""(function(){
  // Make the player believe the tab is always visible/focused, so it autoplays
  // and resolves sources even though the window is parked off-screen / behind.
  try {
    Object.defineProperty(Document.prototype,'hidden',{get:function(){return false;},configurable:true});
    Object.defineProperty(Document.prototype,'visibilityState',{get:function(){return 'visible';},configurable:true});
    document.hasFocus = function(){return true;};
  } catch(e){}
  try {
  var orig = JSON.parse;
  window.__caps = [];
  window.__seen = {};
  JSON.parse = function(s){
    var r = orig.apply(this, arguments);
    try {
      if (typeof s === 'string' && s.length > 20 &&
          (s.indexOf('m3u8')>=0 || s.indexOf('"sources"')>=0 || s.indexOf('.mp4')>=0 ||
           s.indexOf('.vtt')>=0 || s.indexOf('subtitle')>=0 ||
           (s.indexOf('"url"')>=0 && s.indexOf('http')>=0))) {
        // Ad SDKs JSON.parse the same junk payload dozens of times — dedupe by
        // prefix so spam can't fill the 40-slot buffer before the real payload.
        var k = s.slice(0, 64);
        if (!window.__seen[k] && window.__caps.length < 40) {
          window.__seen[k] = 1;
          // The {sources,subtitles} payload can exceed 100k now: dozens of
          // subtitle tracks with ~500-char tokenized URLs come FIRST in the
          // JSON, so a flat 12k slice truncated it mid-payload, json.loads
          // failed on it, and every resolve 0-sourced (broke 2026-06-16).
          // Keep the small cap only for strings that can't be the payload.
          var main = s.indexOf('"sources"')>=0 || s.indexOf('"subtitles"')>=0;
          window.__caps.push(s.slice(0, main ? 400000 : 12000));
        }
      }
    } catch(e){}
    return r;
  };
} catch(e){} })();"""


def log(msg: str) -> None:
    print(f"[videasy-resolver] {time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_secret() -> str:
    s = os.environ.get("VIDEASY_TOKEN_SECRET", "").strip()
    if s:
        return s
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.normpath(os.path.join(here, "..", "..", ".env"))
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("VIDEASY_TOKEN_SECRET="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return ""


SECRET = load_secret()


def _front_app() -> str:
    """Name of the app the user currently has focused (to restore after launch)."""
    try:
        r = subprocess.run(
            ["bash", "-lc", "lsappinfo info -only name `lsappinfo front` 2>/dev/null"],
            capture_output=True, text=True, timeout=5,
        )
        out = r.stdout.strip()  # e.g.  "LSDisplayName"="Finder"
        if '="' in out:
            return out.split('="', 1)[1].strip().strip('"')
    except Exception:
        pass
    return ""


def _activate_app(name: str) -> None:
    """Bring `name` back to the front — hands focus back after Chrome grabs it on
    launch. No-op for Chrome itself or names with characters unsafe for osascript."""
    if not name or name == "Google Chrome" or '"' in name or "\\" in name:
        return
    try:
        subprocess.run(["osascript", "-e", f'tell application "{name}" to activate'],
                       capture_output=True, timeout=5)
    except Exception:
        pass


_lock = threading.Lock()
_driver = None
_driver_started = 0.0
_resolve_count = 0


# undetected-chromedriver's .quit() with use_subprocess leaks the Chrome (and
# its patched chromedriver) on recycle/restart, so they pile up — the user sees
# N off-screen Chromes accumulate over the day. Kill our OWN leftovers before
# each (re)launch and on exit. Targets ONLY our processes via two markers unique
# to the resolver (the off-screen window flag + the undetected_chromedriver
# binary path), so a normal Chrome is never touched.
_KILL_MARKERS = (
    "window-position=-32000,-32000",
    "undetected_chromedriver/undetected_chromedriver",
)


def _kill_orphan_chromes():
    for pat in _KILL_MARKERS:
        try:
            subprocess.run(["pkill", "-f", pat], capture_output=True, timeout=10)
        except Exception:
            pass


_CHROME_BINARIES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
)


def _chrome_major():
    """Major version of the installed Chrome, or None if undetectable.

    undetected-chromedriver downloads the LATEST chromedriver when version_main
    is not pinned. When Google publishes driver N+1 before this Mac's Chrome
    auto-updates past N, every launch dies with SessionNotCreatedException
    ("only supports Chrome version N+1") — this killed the resolver for 16 days
    starting 2026-06-16 (driver 150 vs Chrome 149). Pin the driver to the
    browser we actually have.
    """
    for binary in _CHROME_BINARIES:
        try:
            r = subprocess.run([binary, "--version"], capture_output=True,
                               text=True, timeout=10)
            m = re.search(r"(\d+)\.", r.stdout)
            if m:
                return int(m.group(1))
        except Exception:
            continue
    return None


def _new_driver():
    import undetected_chromedriver as uc
    _kill_orphan_chromes()  # clear any leaked Chromes from a prior driver/run
    # Headed is mandatory — undetected-chromedriver only passes Cloudflare
    # Turnstile with a real (non-headless) Chrome. macOS won't let us truly hide
    # it (chromedriver minimize is broken, CDP minimize is ignored, System Events
    # hide is TCC-blocked from launchd), so instead:
    #   - park it off-screen,
    #   - disable occlusion/background throttling + spoof visibility (HOOK) so it
    #     keeps autoplaying/resolving while off-screen or behind another window,
    #   - hand focus straight back to whatever the user was using — Chrome grabs
    #     focus when it LAUNCHES, but navigating an already-open window does not.
    prev = _front_app()
    opts = uc.ChromeOptions()
    for arg in (
        "--no-first-run", "--no-default-browser-check",
        "--window-position=-32000,-32000", "--window-size=1280,1000",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion",
    ):
        opts.add_argument(arg)
    # version_main=None falls back to uc's default (latest driver) if Chrome's
    # version can't be read — same behavior as before the pin.
    d = uc.Chrome(options=opts, headless=False, use_subprocess=True,
                  version_main=_chrome_major())
    try:
        d.set_window_position(-32000, -32000)
        d.set_window_size(1280, 1000)
    except Exception:
        pass
    _activate_app(prev)  # give the user's focus back after Chrome's launch grab
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK})
    try:
        d.set_page_load_timeout(24)
    except Exception:
        pass
    return d


def get_driver(force_new: bool = False):
    global _driver, _driver_started, _resolve_count
    now = time.time()
    stale = (_resolve_count >= RECYCLE_AFTER) or (now - _driver_started > RECYCLE_AGE)
    if _driver is not None and not force_new and not stale:
        try:
            _ = _driver.current_url  # liveness probe
            return _driver
        except Exception:
            pass
    if _driver is not None:
        try:
            _driver.quit()
        except Exception:
            pass
        _driver = None
    log("starting Chrome…")
    _driver = _new_driver()
    _driver_started = now
    _resolve_count = 0
    return _driver


def pick_sources(caps):
    """From captured JSON strings, extract the {sources, subtitles} payload."""
    out = {"sources": [], "subtitles": []}
    for s in caps:
        try:
            obj = json.loads(s)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        srcs = obj.get("sources")
        if isinstance(srcs, list):
            good = []
            for x in srcs:
                if isinstance(x, dict) and isinstance(x.get("url"), str) and \
                        ("m3u8" in x["url"] or ".mp4" in x["url"]):
                    good.append({"url": x["url"], "quality": str(x.get("quality") or x.get("label") or "")})
            if good and len(good) > len(out["sources"]):
                out["sources"] = good
        subs = obj.get("subtitles") or obj.get("tracks") or obj.get("captions")
        if isinstance(subs, list) and subs and not out["subtitles"]:
            cleaned = []
            for t in subs:
                if isinstance(t, dict) and isinstance(t.get("url") or t.get("file"), str):
                    cleaned.append({
                        "url": t.get("url") or t.get("file"),
                        "lang": t.get("lang") or t.get("language") or t.get("label") or "",
                    })
            if cleaned:
                out["subtitles"] = cleaned
    return out if out["sources"] else None


def harvest(driver, embed):
    global _resolve_count
    start = time.time()
    try:
        driver.get(embed)
    except Exception:
        pass  # autoplay pages may exceed page-load timeout; hook is still live
    _resolve_count += 1
    while time.time() - start < HARVEST_TIMEOUT:
        try:
            caps = driver.execute_script("return (window.__caps||[])")
        except Exception:
            caps = []
        payload = pick_sources(caps)
        if payload:
            return payload
        time.sleep(0.4)
    try:
        caps = driver.execute_script("return (window.__caps||[])")
    except Exception:
        caps = []
    return pick_sources(caps) or {"sources": [], "subtitles": []}


def resolve(media_type, tmdb, season, episode):
    if media_type == "tv":
        embed = f"https://www.vidking.net/embed/tv/{tmdb}/{season}/{episode}"
    else:
        embed = f"https://www.vidking.net/embed/movie/{tmdb}"
    with _lock:
        driver = get_driver()
        payload = harvest(driver, embed)
        if not payload.get("sources"):
            # Retry ONCE — but on the SAME warm browser, not a fresh one. A title
            # Vidking simply doesn't have also returns 0; recycling for that would
            # cold-restart Chrome (Turnstile not yet cleared) and fail the NEXT
            # request too — that cascade was "everything falls back to RD". Only
            # recreate the browser if the session is genuinely dead.
            alive = True
            try:
                _ = driver.current_url
            except Exception:
                alive = False
            if alive:
                log("0 sources; retrying once on the warm browser")
                payload = harvest(driver, embed)
            else:
                log("0 sources + dead session; recycling browser and retrying once")
                driver = get_driver(force_new=True)
                payload = harvest(driver, embed)
        # Park on about:blank so the harvested stream doesn't keep playing
        # (and burning bandwidth) in the warm browser between resolves. The
        # session/Turnstile clearance survives, so the next resolve stays fast.
        try:
            driver.get("about:blank")
        except Exception:
            pass
    return payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence default access logging
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/health":
            self._send(200, {"ok": True, "browser": _driver is not None,
                             "resolves": _resolve_count})
            return
        if u.path == "/resolve":
            if not SECRET or (q.get("secret", [""])[0] != SECRET):
                self._send(403, {"error": "forbidden"})
                return
            tmdb = (q.get("tmdbId", [""])[0] or "").strip()
            if not tmdb:
                self._send(400, {"error": "missing tmdbId"})
                return
            mt = (q.get("type", ["tv"])[0] or "tv").strip()
            season = (q.get("season", ["1"])[0] or "1").strip()
            episode = (q.get("episode", ["1"])[0] or "1").strip()
            t0 = time.time()
            try:
                payload = resolve(mt, tmdb, season, episode)
            except Exception as e:  # noqa: BLE001
                log(f"ERROR resolve {mt}/{tmdb} S{season}E{episode}: {str(e)[:160]}")
                self._send(502, {"error": "resolve_failed"})
                return
            n = len(payload.get("sources", []))
            log(f"resolve {mt}/{tmdb} S{season}E{episode} -> {n} sources in {time.time()-t0:.1f}s")
            self._send(200, payload)
            return
        self._send(404, {"error": "not_found"})


# The warm-loop kept Chrome hot for the PRIMARY resolve path. As of 2026-07-02
# the addon-proxy resolves in-process from api.videasy.to (no browser), so this
# service is a break-glass fallback only — keeping Chrome hot 24/7 (and grabbing
# focus on every relaunch) is pure cost. Default OFF; set VIDEASY_RESOLVER_WARM=1
# to restore warming if the browser ever becomes the primary path again.
WARM_ENABLED = os.environ.get("VIDEASY_RESOLVER_WARM", "0") == "1"


def _warm_loop():
    # Prime the browser at startup, then keep it warm: a fresh/recycled Chrome
    # needs ~60s to clear Turnstile, during which real resolves 0-source and fall
    # back to RD. Resolving a known-good title here clears Turnstile up front and
    # re-primes the browser right after each recycle, so users hit a warm one.
    while True:
        try:
            log("warm-loop: priming resolve")
            resolve("movie", WARM_TMDB, "1", "1")
        except Exception as e:  # noqa: BLE001
            log(f"warm-loop error: {str(e)[:120]}")
        time.sleep(WARM_INTERVAL)


def _on_term(*_a):
    _kill_orphan_chromes()
    os._exit(0)


def main():
    # Clean our Chromes on exit AND on launchd's SIGTERM (KeepAlive restart),
    # so a restart never leaves an orphaned off-screen Chrome behind.
    atexit.register(_kill_orphan_chromes)
    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)
    if not SECRET:
        log("WARN no VIDEASY_TOKEN_SECRET — /resolve will reject all requests")
    if WARM_ENABLED:
        threading.Thread(target=_warm_loop, daemon=True).start()
    else:
        log("warm-loop disabled (fallback-only; Chrome stays cold until a /resolve call)")
    log(f"listening on 0.0.0.0:{PORT}")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
