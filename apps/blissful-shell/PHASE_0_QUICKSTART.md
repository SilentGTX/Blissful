# Phase 0 Quickstart — running the architecture spike

Phase 0 is a **hard gate**. The spike either proves the WebView2-over-libmpv compositing works on your machine or it doesn't; everything after Phase 0 in `plan.md` assumes it does. Run through this once before sinking days into Phase 1+.

There are two sub-gates:

- **Phase 0a** — hardcoded HTML over libmpv. The code in this repo today.
- **Phase 0b** — actual `apps/blissful-mvs/` React build, with a temporary `/player-spike` route, over libmpv. Lands later in Phase 0.

This doc covers 0a.

## 0. Are you ready?

Walk through `PREREQUISITES.md` and confirm all four checkboxes:

- [ ] `rustup --version` works
- [ ] `apps/blissful-shell/resources/mpv-x64/libmpv-2.dll` exists and is LGPL-built
- [ ] Local 4K HEVC HDR test file path is known
- [ ] WebView2 Runtime is installed (Win11 default = yes)

If any of those is missing, stop here and finish prereqs first. The spike will fail with confusing errors otherwise.

## 1. Wire up the test file

Open [src/main.rs](src/main.rs) and replace the placeholder path:

```rust
const PHASE_0A_TEST_FILE: &str = r"D:\test-media\example-4k-hdr.mkv";
```

with the absolute path to your local 4K HEVC HDR file. Use a raw string (`r"..."`) so backslashes don't bite. A 5–30s clip is enough.

Drop your LGPL `libmpv-2.dll` here:

```
apps/blissful-shell/resources/mpv-x64/libmpv-2.dll
```

Plus any FFmpeg DLLs the build needs (the loader will tell you if it can't resolve them).

## 2. Run it

From the repo root, in PowerShell:

```powershell
cd apps\blissful-shell
cargo run --features spike0a
```

First build pulls dependencies and takes a few minutes. Subsequent runs are fast.

You should see tracing output like:

```
INFO  Blissful Shell v0.1.0 starting
INFO  loading libmpv from "...\resources\mpv-x64"
INFO  running Phase 0a spike
DEBUG video host HWND created
INFO  WebView2 controller ready
INFO  mpv event loop started
```

A 1280×720 native window opens, mpv starts playing the test file, and the WebView2 overlay paints two semi-opaque dark strips at the top and bottom with a center marker.

## 3. Verify the acceptance checklist

The same boxes as in [plan.md Phase 0a](plan.md#phase-0a-acceptance--hardcoded-html-compositing-proof). What to actually look for:

| Check | How to verify | What failure looks like |
|---|---|---|
| Native window, no Electron | `Get-Process` shows one `blissful-shell.exe`, no `blissful-desktop` / `electron` / `chrome` | Multiple helper procs → wrong binary running |
| HW decode | Task Manager → Performance → GPU 0 → **Video Decode** graph spikes during playback | Video Decode flat at 0% → mpv fell back to software decode (check libmpv stderr for `hwdec failed`) |
| WebView2 strips render | Top 60px and bottom 80px are semi-opaque dark rectangles with text | No strips at all → WebView2 controller didn't load (check tracing for `WebView2 controller creation failed`) |
| Middle region fully transparent | Move a colorful mpv frame under the middle gap; you see the video frame **with no haze, no white square, no black square** | Solid color in the middle → either the WebView page background isn't transparent, or `DefaultBackgroundColor` wasn't set |
| Strips bleed video through | Look closely at the top/bottom strips — they should be the **video tinted ~40% darker**, not a flat black band | Flat opaque black/white → per-window transparency only; we'd need to switch to a layered window. See plan.md "If Phase 0 fails — fallbacks" |
| Play/Pause buttons work | Click Play in the bottom strip → video plays. Click Pause → video freezes. Tracing shows the JSON message landing | Buttons do nothing → check `webview2 WebMessageReceived` is firing and `PLAYER` thread-local is populated |
| Resize follows | Drag the window edge — both child HWNDs follow smoothly, no flicker | Video stays at old size or jumps to top-left → `SetWindowPos` not wired to WM_SIZE |
| No flash on focus | Alt-tab away and back — strips don't flash white/black | Brief white/black flash → WebView2 background paint race; usually harmless but log it |
| Drag-resize redraws cleanly | Slow drag-resize the window edge — no ghost titlebar, no stale frames | Stale frames → DWM compositor issue, may need WS_EX_COMPOSITED on parent |
| Quit cleanly | Close the window — no zombie `blissful-shell.exe` in Task Manager | Hung process → Drop order is wrong; `webview` must drop before `player`, `player` before `video_host` |

**All ten boxes must check before Phase 0a is "passed".** A single failed box is the entire architecture failing — don't shrug it off.

## 4. Common troubleshooting

**`libmpv-2.dll not found`** → Either the DLL isn't at `resources/mpv-x64/libmpv-2.dll`, or `cargo run` is putting `target/debug/blissful-shell.exe` deeper than `locate_libmpv_dir()` searches. Verify with `dir target\debug\blissful-shell.exe` and trace back to the resources dir.

**libmpv loads but no video shows** → The video host HWND is there but mpv isn't drawing into it. Check:
1. mpv stderr (debug builds set `terminal=yes` + `msg-level=all=v`) — look for `vo: gpu`, `gpu/d3d11`. If you see `vo: null`, `wid` didn't take.
2. The host HWND value in tracing matches what mpv reports (cast int → check both as hex).

**No HW decode** → mpv stderr will show the hwdec attempt. `auto-safe` is conservative; if your driver/codec isn't in its safe list, try setting `hwdec=d3d11va` or `hwdec=auto` directly in [src/player/mpv.rs:48](src/player/mpv.rs#L48). Confirm in Task Manager again.

**WebView2 controller creation hangs forever** → The controller is async-created on the UI thread; if you see `WebView2 environment created` but never `WebView2 controller ready`, the message pump isn't running. Phase 0a uses NWG which pumps automatically — if you replaced that, you need to pump messages.

**`RPC_E_WRONG_THREAD`** → You called something on the WebView2 controller from a non-UI thread. See plan.md "WebView2 threading rule" — Phase 1 implements the proper UI-thread dispatch, but Phase 0a uses thread-local state and the click handler runs on the UI thread, so this shouldn't fire here.

**Strips are flat opaque even with alpha set** → Try a non-zero alpha on `DefaultBackgroundColor` (e.g. `A: 1`). Some compositor paths reject exact zero. If that fixes it, document it; if not, this is the failure mode that triggers the WS_EX_LAYERED fallback in the plan.

## 5. What Phase 0a does NOT prove

- That **the real React app** can be made transparent in the player region. That's Phase 0b.
- That **input forwarding** through a `WS_DISABLED` mpv child works for all edge cases (modifier keys, scroll, double-click). That's Phase 1.
- That **arbitrary content** plays — only your hardcoded test file. Cold-torrent and HLS come in Phase 2.
- That **every codec** decodes — only what's in your test file. The full matrix is Phase 8.

If 0a passes, move on to staging Phase 0b: build `apps/blissful-mvs/`, add the temporary `/player-spike` route, point the shell's WebView at the local Vite/UI server, and re-run the same ten-box checklist with the real React DOM.

## 6. If Phase 0a fails

Don't escalate by piling on Phase 1 work. Read the **"If Phase 0 fails — fallbacks"** section in plan.md, try them in order, and re-run this checklist. If all fallbacks fail, the architecture is wrong for this machine and we need to reassess before spending another week on the rewrite.
