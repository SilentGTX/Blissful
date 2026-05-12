# Phase 8 — Verification Test Matrix

Run before tagging a release. The shell's goal is **Stremio Desktop parity**;
every row that fails compared to Stremio Desktop on the same content is a
bug, not a feature trade-off.

Run on:
- [ ] Clean Windows 11 VM with no prior Blissful install (catches missing
      dependencies + WebView2 bootstrapper behavior)
- [ ] Dev machine (catches regressions against your everyday workflow)

## Codec matrix

For each codec, pick a representative stream from your library + play to
the end. Watch the player UI, the rust shell terminal, and Task Manager.

| Codec / container | Source | Plays | HW decode | Audio | Subs | Notes |
|---|---|---|---|---|---|---|
| H.264 1080p AAC | WEB-DL | | | | | |
| HEVC 1080p AAC | x265 remux | | | | | |
| HEVC 2160p HDR10 Atmos (E-AC-3) | UHD remux | | | | | the Chrome `<video>` killer; libmpv should just work |
| HEVC 2160p HDR10+ TrueHD | UHD remux | | | | | |
| HEVC 2160p Dolby Vision P5 | UHD remux | | | | | mpv tonemaps DV→HDR10; visible as washed-out colors if broken |
| HEVC 2160p Dolby Vision P7 | UHD remux | | | | | mpv tonemaps via base layer; expect HDR10 quality, no DV-specific punch |
| H.264 anime FLAC | BluRay rip | | | | | FLAC audio dies in Chrome `<video>` |
| AV1 | newer 2024+ rips | | | | | only on supported GPUs |

"HW decode": Task Manager → Performance → GPU 0 → Video Decode should
spike during playback. CPU should NOT be the bottleneck.

## Source matrix

| Source | Cold start | Seek | Pause/Resume | Audio switch | Sub switch | Notes |
|---|---|---|---|---|---|---|
| Cold torrent (no peers seen yet) | | | | | | target: < 10s before first frame |
| Warm torrent (peers cached) | | | | | | target: < 2s |
| Real-Debrid HTTPS | | | | | | direct HTTP — fastest path |
| Premiumize HTTPS | | | | | | |
| Local file via addon | | | | | | |
| HLS via addon | | | | | | |

## Player UI

- [ ] Top strip (back button + title) — visible, translucent over video
- [ ] Bottom strip (controls) — visible, no scrollbar gutter showing as white
- [ ] Center marker / buffering veil — appears only when cache is actually low
- [ ] Volume slider — drives mpv volume in real time
- [ ] Mute toggle — flips ⊘ icon, mutes audio
- [ ] Audio cycle button — walks through audio tracks (verify with
      multi-language remux)
- [ ] Subtitle cycle button — same
- [ ] Settings popover (⚙) — subtitle size buttons hot-apply to mpv
- [ ] Fullscreen button (⛶) — borderless on current monitor, video resizes
- [ ] Up Next overlay — fires when remaining time ≤ notification setting,
      countdown advances, "Watch Now" / "Cancel" both work
- [ ] Auto-advance to next episode on EndFile when binge-watching enabled

## Stremio integration

- [ ] Item added to library on first play (check Library page)
- [ ] Progress bar appears in Continue Watching after playing a couple
      minutes
- [ ] Continue Watching click resumes from the saved offset (within ±2s)
- [ ] Progress syncs to Stremio account (visible on web app /
      blissful.budinoff.com after a few seconds)
- [ ] Stream history remembers the last picked stream per episode

## Shell + OS integration

- [ ] Tray icon appears in the notification area
- [ ] Tray left-click toggles window visibility
- [ ] Tray right-click → menu → Show/Hide + Quit both work
- [ ] Tray Quit cleanly kills stremio-service.exe (check Task Manager —
      no orphan process after exit)
- [ ] Window starts hidden, appears only after WebView2 has rendered
      (no empty NWG frame flash)
- [ ] Window can be minimized + restored without losing playback state
- [ ] Multi-monitor: drag the window to a 4K display → mpv keeps painting
- [ ] Multi-DPI: 4K + 1080p side-by-side, move the window across — no
      blur / scaling artifacts (NWG Per-Monitor V2 awareness in main.rs)

## Resource usage

- [ ] Cold-start time (double-click → first frame): within 10% of Stremio
      Desktop on the same content
- [ ] Sustained 4K HDR playback: GPU 0 → Video Decode shows usage, CPU
      under 15% on RTX/AMD modern hardware
- [ ] Memory: idle on Home ~ 200–300 MB. During 4K playback 250–400 MB.
- [ ] 8-hour memory soak: leave a long stream looping, walk away, come
      back. RSS should not grow past ~600 MB. If it climbs steadily,
      that's a leak somewhere (most likely libmpv property observer
      buildup or stale promises in the JS shim).

## Auto-updater

- [ ] Publish a test release `shell-v999.0.0` to GitHub with a dummy MSI
- [ ] Run an installed older Blissful → expect update-available event +
      auto-download
- [ ] Toast appears in renderer → "Update & Restart" → installer runs +
      shell quits cleanly

## SmartScreen / Authenticode

- [ ] Fresh install on a clean VM does not trip SmartScreen (assuming EV
      cert) OR shows the "Windows protected your PC" prompt with `More
      info → Run anyway` only on first run

## After all green

- [ ] `git mv apps/blissful-desktop apps/blissful-desktop-legacy`
- [ ] Update `CLAUDE.md` Blissful section to point at `apps/blissful-shell`
- [ ] Update top-level `README.md` install instructions
- [ ] Tag `shell-v0.4.0` → GitHub Actions builds + signs + publishes MSI
- [ ] Update Stremio Desktop's auto-updater feed if applicable
- [ ] Wait for one release cycle, then delete `apps/blissful-desktop-legacy`
