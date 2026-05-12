# Blissful Self-Hosted Expansion Plan

## Goal

Keep Blissful + Stremio click-to-play behavior, but make the stack significantly more self-hosted on Mac-mini, with browser-compatible playback fallback and centralized storage on NAS.

## Target End State

- Blissful stays the primary UI at `blissful.budinoff.com`.
- Stremio/Torrentio/RD remain upstream content sources for instant play.
- A local stream gateway on Mac-mini handles pass-through/remux/transcode for browser compatibility.
- WEB Ready filtering/toggle is removed; compatibility is automatic.
- All persistent state/cache/logs/backups are under `/Volumes/2TB/NAS/blissful`.
- Mac-mini resource impact is controlled with strict transcode limits and cleanup.

## NAS Storage Layout

All local persisted files should be under:

- `/Volumes/2TB/NAS/blissful/config`
- `/Volumes/2TB/NAS/blissful/state/blissful-storage`
- `/Volumes/2TB/NAS/blissful/cache/meta`
- `/Volumes/2TB/NAS/blissful/cache/posters`
- `/Volumes/2TB/NAS/blissful/cache/addon`
- `/Volumes/2TB/NAS/blissful/cache/stream-gateway/hls`
- `/Volumes/2TB/NAS/blissful/cache/stream-gateway/temp`
- `/Volumes/2TB/NAS/blissful/logs/blissful`
- `/Volumes/2TB/NAS/blissful/logs/blissful-storage`
- `/Volumes/2TB/NAS/blissful/logs/addon-proxy`
- `/Volumes/2TB/NAS/blissful/logs/stream-gateway`
- `/Volumes/2TB/NAS/blissful/logs/ops`
- `/Volumes/2TB/NAS/blissful/backups/state`
- `/Volumes/2TB/NAS/blissful/backups/config`

### NAS Mount Resilience

The `/Volumes/2TB` external drive can become unavailable (eject, sleep, reboot timing). Given known Docker + external-drive quirks on macOS (see root AGENTS.md):

- All services must health-check the NAS mount path on startup and fail fast if unavailable.
- Cache paths gracefully degrade to a local tmpdir (`/tmp/blissful-cache`) when NAS is missing; state writes are refused (no silent data loss).
- A shared health-check script (`infra/scripts/blissful-nas-check.sh`) verifies mount availability; Compose `depends_on` or entrypoint wrappers call it before service start.

## Disk Usage Policy

- Poster cache max: `5 GB`, TTL `30 days`.
- Meta/addon JSON cache max: `1 GB`, TTL `24-72 hours`.
- Stream-gateway HLS/temp cache max: `10-20 GB`, TTL `1-6 hours`.
- Logs max: `1 GB` total with rotation.
- State backups: daily, retain `14-30` snapshots.
- Emergency cleanup if NAS path exceeds configured threshold.

## New Service: Stream Gateway

Add `blissful-stream-gateway` (Mac-mini local service) to provide browser-friendly playback without manual WEB Ready filtering.

### Tech Stack

- **Language**: TypeScript (Node.js) -- consistent with the rest of the Blissful stack.
- **FFmpeg/ffprobe**: Invoked as child processes (not a native binding). Use the Homebrew `ffmpeg` with `videotoolbox` support baked in.
- **Container**: `node:20-alpine` with `ffmpeg` installed, or run on host via launchd if hardware acceleration requires direct Metal/GPU access (evaluate during phase 3).

### API Contract

All endpoints are behind Traefik at `https://blissful.budinoff.com/stream/...`. The gateway itself listens on `localhost:18082`.

| Endpoint | Method | Description |
|---|---|---|
| `/stream/play?url={source}` | GET | Probe source, return redirect (pass-through) or HLS manifest URL |
| `/stream/hls/{session}/{file}` | GET | Serve HLS segments for active transcode sessions |
| `/stream/status/{session}` | GET | Session status: `probing`, `ready`, `transcoding`, `error` |
| `/stream/health` | GET | Service health |

**Response from `/stream/play`**:

- `302` redirect to source URL if direct-play compatible.
- `200 { "type": "hls", "manifestUrl": "/stream/hls/{session}/master.m3u8", "status": "ready"|"transcoding" }` if conversion is needed.
- `503` if max concurrent transcodes reached (frontend shows "busy, try again").
- `504` if probe times out.

### Behavior

- Probe source stream (`ffprobe`) with a **10-second timeout**. If probe hangs beyond that, return `504` and let the frontend offer the raw URL as a fallback.
- If browser-safe (`h264+aac`, mp4/hls), use direct pass-through (302 redirect) or remux to fragmented MP4.
- If incompatible (e.g. mkv/eac3/dts/hevc edge cases), do on-demand HLS transcode.

### Error Handling

- **Probe timeout** (>10s): return `504`, frontend shows "Stream unavailable, try another source" with option to attempt direct play.
- **Transcode failure** (codec unsupported by `videotoolbox`, corrupt source): return `500` with `{ "error": "transcode_failed", "detail": "..." }`, frontend shows error toast and offers the raw URL as a last resort.
- **Mid-stream failure** (ffmpeg crashes during playback): gateway cleans up session, player fires `error` event, frontend shows "Playback interrupted" with retry/alternate-source options.
- **Max concurrency reached**: return `503`, frontend shows "Server busy -- try again in a moment" with auto-retry after 5s (max 3 retries).

### Resource Controls

- Max concurrent transcodes: `1` initially (`2` optional later), controlled via `GATEWAY_MAX_TRANSCODES` env var.
- No background pre-transcoding. First play of an incompatible stream always has a cold-start delay (probe + initial segment generation, typically 3-8s).
- Idle cleanup: session is torn down after **60 seconds** with no segment requests from the player.
- Prefer Apple Silicon hardware acceleration (`videotoolbox`) where available.
- Gateway listens only on `localhost:18082`; TLS is terminated by Traefik.

## Remove WEB Ready Implementation

Replace WEB Ready filtering with automatic compatibility routing.

Required changes:

- Remove WEB Ready toggle/state from UI and stream filters.
- Keep stream list complete; do not hide by browser-readiness.
- On stream click, request a playable URL from stream gateway (`/stream/play?url={source}`).
- If direct-play works (`302`), start immediately.
- If conversion required, show "Preparing stream..." spinner, poll `/stream/status/{session}` until `ready`, then play.
- If gateway returns `503`/`504`/`500`, show appropriate error with fallback options.

Likely files:

- `src/features/detail/components/StreamFilters.tsx`
- `src/features/detail/components/DetailStreamsPanel.tsx`
- `src/features/detail/components/StreamList.tsx`
- `src/features/detail/streams.ts`
- `src/pages/DetailPage.tsx`
- `src/pages/PlayerPage.tsx`

### Gateway Bypass Toggle

Add a `GATEWAY_ENABLED` env var (default `true`). When `false`, stream clicks behave as they do today (direct URL to player). This serves as a rollback mechanism and simplifies debugging.

## Self-Hosted Hardening

### Addon Proxy

- Domain allowlist: default allow `cinemeta`, `torrentio`, `v3-cinemeta.strem.io`, `thepiratebay+`, known addon hosts. Additional domains configurable via `ADDON_PROXY_EXTRA_DOMAINS` env var.
- Response caching with stale-on-error.
- Tuned retries/timeouts.
- Structured error mapping for frontend.

### Metadata + Poster Resilience

- Local cache for meta/posters.
- Serve cached fallback when upstream fails.

### State Durability

- Expand `blissful-storage` to persist more user/session state server-side.
- Backup strategy:
  - **What**: `state/blissful-storage` data + `config/` directory.
  - **When**: Daily via launchd plist (`com.budinoff.blissful-backup`), runs `infra/scripts/blissful-backup.sh`.
  - **Where**: Snapshots go to `/Volumes/2TB/NAS/blissful/backups/state/` and `.../backups/config/` with timestamped filenames.
  - **Retention**: Keep last 14 daily snapshots, prune older.
  - **Restore**: Manual -- `infra/scripts/blissful-restore.sh <snapshot>` copies snapshot back to state path and restarts `blissful-storage`.

### Observability

- Health endpoints: all services must expose `GET /health` returning `200` with `{ "status": "ok" }`. Currently missing on: `addon-proxy`, `stream-gateway` (new), `blissful` (static serve -- add a simple `/health` route or rely on Traefik health check).
- Metrics: each service logs structured JSON (request path, latency ms, status code, errors). No Prometheus/Grafana for now -- keep it log-based and grep-friendly.
- Alerts: on repeated failures (5+ errors in 5 minutes), POST to Discord webhook (`BLISSFUL_ALERT_WEBHOOK` env var) in the existing `#alerts` channel. Reuse the notification pattern from `pi-monitor`.

## Compose + Traefik Changes

### `docker-compose.blissful-mac.yml`

- Add NAS mounts for state/cache/logs.
- Add `blissful-stream-gateway` service (port `18082`, localhost only).
- Add env tunables for cache limits and transcode concurrency.
- Add NAS mount health check to service entrypoints.

### `infra/traefik/dynamic/blissful.yml`

- Add router/service for `/stream` to `host.docker.internal:18082`.
- Keep existing routes for `/`, `/storage`, `/stremio`, `/addon-proxy`.

### Tunnel

- Keep Cloudflare Tunnel target for Blissful as `http://192.168.1.11:5001`.
- Note: `192.168.1.11` is the Mac-mini's current static LAN IP. If this changes, update the tunnel config. Consider using Tailscale IP as a stable alternative.

## Migration Plan

### Data Migration (Phase 1)

1. Stop `blissful-storage`: `docker compose -f docker-compose.blissful-mac.yml stop blissful-storage`.
2. Create NAS directory tree: `infra/scripts/blissful-nas-init.sh` (creates all paths under `/Volumes/2TB/NAS/blissful/`).
3. Copy existing state: `cp -a apps/blissful-storage/data/* /Volumes/2TB/NAS/blissful/state/blissful-storage/`.
4. Update Compose volumes to point to NAS paths.
5. Restart and verify: `docker compose -f docker-compose.blissful-mac.yml up -d`.

### Rollback

- Keep original `apps/blissful-storage/data/` intact until NAS migration is validated (at least 7 days).
- Gateway bypass: set `GATEWAY_ENABLED=false` to revert to direct-URL playback without removing the gateway service.
- If NAS mount is unreliable, revert Compose volumes to local paths and reassess.

## Implementation Phases

1. **NAS migration**: create directory tree, init script, remap volumes, migrate existing state.
2. **Cache + retention**: add TTL/caps/cleanup jobs. (Can run in parallel with phase 3.)
3. **Stream gateway v1**: probe + pass-through/remux first, then transcode fallback. Includes API contract, error handling, health endpoint.
4. **WEB Ready removal**: remove toggle, wire up gateway calls, add preparing/error UI states.
5. **Resource tuning**: verify CPU/memory impact, cap transcodes, test with real streams (see testing section).
6. **Ops + docs**: health checks, backup/restore scripts, alert hooks, runbook.

## Testing Strategy

Each phase needs explicit validation before moving to the next:

- **Phase 1 (NAS)**: services start with NAS mounts, read/write roundtrip works, unmounting NAS triggers graceful degradation (cache falls back, state refuses writes).
- **Phase 2 (Cache)**: cache files are created under NAS paths, TTL expiry deletes old entries, emergency cleanup triggers at threshold.
- **Phase 3 (Gateway)**: test with known-good streams:
  - Direct-play: `h264+aac` MP4 URL returns `302`.
  - Remux: MKV with `h264+aac` returns HLS manifest.
  - Transcode: HEVC/DTS source returns HLS manifest after transcode start.
  - Timeout: unreachable URL returns `504` within 10s.
  - Concurrency: second simultaneous transcode returns `503`.
- **Phase 4 (WEB Ready removal)**: stream list shows all streams, click routes through gateway, preparing spinner appears for transcode, playback starts.
- **Phase 5 (Resource tuning)**: monitor Activity Monitor during transcode -- CPU should stay under 80% sustained, memory under 2 GB for gateway process.
- **Phase 6 (Ops)**: all `/health` endpoints return `200`, backup script produces timestamped snapshot, restore script recovers state, alert fires on simulated failure burst.

## Acceptance Criteria

- Public app has no localhost storage calls.
- Stream click works without WEB Ready toggle.
- Browser can play incompatible streams via gateway fallback.
- Mac-mini remains responsive under load.
- Persistent state/cache/logs/backups live under `/Volumes/2TB/NAS/blissful`.
- Services recover cleanly after restart/reboot.
- NAS unavailability does not crash services (graceful degradation).
- Gateway bypass toggle (`GATEWAY_ENABLED=false`) restores pre-gateway behavior.
- Backup/restore cycle produces a valid, recoverable snapshot.
