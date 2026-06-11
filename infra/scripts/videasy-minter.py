#!/usr/bin/env python3
"""Videasy session-token minter (runs on the Mac, driven by launchd).

Videasy gated /sources-with-title behind a Cloudflare-Turnstile-minted session
token. No automation flavour we tried (headless/headed Playwright, rebrowser
CDP-patch) passes Turnstile -- but undetected-chromedriver, driving a *real*
Chrome in the Mac's GUI session, does. This script loads vidking's embed, lets
the real player mint a token, captures it off the wire, and POSTs it to the
addon-proxy over localhost (POST /videasy-token, guarded by a shared secret).

Mint and use happen from the same Mac IP, so the token is not rejected for
binding/portability the way a token grabbed from a different machine would be.

Driven by infra/launchd/com.budinoff.videasy-minter.plist (RunAtLoad +
StartInterval ~40 min). Logs are masked -- the token/secret never hit the log
beyond their last 4 chars.
"""
# Defer annotation evaluation so PEP 604 (`str | None`) hints work on the Mac's
# system Python 3.9, which otherwise evaluates them at def-time and TypeErrors.
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

EMBED = os.environ.get("VIDEASY_MINT_EMBED", "https://www.vidking.net/embed/movie/550")
PROXY_URL = os.environ.get("VIDEASY_PROXY_URL", "http://127.0.0.1:13000/videasy-token")
WAIT_SECS = int(os.environ.get("VIDEASY_MINT_WAIT", "45"))


def log(msg: str) -> None:
    print(f"[videasy-minter] {time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_secret() -> str:
    """Secret comes from the env, else from the repo-root .env (gitignored)."""
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


def mint_token() -> tuple[str | None, str | None]:
    """Return (token, remaining_quota) by driving a real Chrome via uc."""
    import undetected_chromedriver as uc

    found = {"tok": None, "rem": None, "auth_rid": None}

    def on_extra(msg):
        try:
            t = msg["params"].get("headers", {}).get("x-session-token")
            if t and len(t) >= 40:
                found["tok"] = t
        except Exception:
            pass

    def on_resp(msg):
        try:
            r = msg["params"]["response"]
            u = r["url"]
            if "sources-with-title" in u:
                rem = r.get("headers", {}).get("x-session-remaining")
                if rem:
                    found["rem"] = rem
            if "/auth/session" in u and r.get("status") == 200:
                found["auth_rid"] = msg["params"]["requestId"]
        except Exception:
            pass

    driver = None
    try:
        driver = uc.Chrome(headless=False, enable_cdp_events=True, use_subprocess=True)
        driver.add_cdp_listener("Network.requestWillBeSentExtraInfo", on_extra)
        driver.add_cdp_listener("Network.responseReceived", on_resp)
        driver.get(EMBED)
        for _ in range(WAIT_SECS):
            if found["tok"]:
                break
            time.sleep(1)
        # Fallback: pull the token out of the /auth/session response body.
        if not found["tok"] and found["auth_rid"]:
            try:
                body = driver.execute_cdp_cmd(
                    "Network.getResponseBody", {"requestId": found["auth_rid"]}
                )
                j = json.loads(body.get("body", "{}"))
                if j.get("token"):
                    found["tok"] = j["token"]
            except Exception:
                pass
    finally:
        try:
            if driver:
                driver.quit()
        except Exception:
            pass
    return found["tok"], found["rem"]


def push_token(token: str, secret: str) -> int:
    data = json.dumps({"token": token}).encode("utf-8")
    rq = urllib.request.Request(
        PROXY_URL,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "x-token-secret": secret},
    )
    with urllib.request.urlopen(rq, timeout=12) as r:
        return r.status


def main() -> int:
    secret = load_secret()
    if not secret:
        log("ERROR no VIDEASY_TOKEN_SECRET (env or repo .env) -- cannot push")
        return 2
    try:
        token, rem = mint_token()
    except Exception as e:  # noqa: BLE001 - top-level guard for the launchd job
        log(f"ERROR mint failed: {str(e)[:200]}")
        return 1
    if not token:
        log("ERROR Turnstile/mint produced no token (player may have changed)")
        return 1
    try:
        status = push_token(token, secret)
    except Exception as e:  # noqa: BLE001
        log(f"ERROR push to proxy failed: {str(e)[:200]}")
        return 1
    log(f"OK token …{token[-4:]} pushed (HTTP {status}); quota remaining={rem}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
