#!/usr/bin/env bash
# Blissful cache cleanup with TTL and size caps.
# Intended to run via launchd on a schedule (e.g. hourly).
set -uo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"
LOG_DIR="$NAS_ROOT/logs/ops"
LOG_FILE="$LOG_DIR/cache-cleanup-$(date +%Y%m%d).log"

POSTER_MAX_GB="${POSTER_MAX_GB:-5}"
POSTER_TTL_DAYS="${POSTER_TTL_DAYS:-30}"
META_MAX_GB="${META_MAX_GB:-1}"
META_TTL_HOURS="${META_TTL_HOURS:-72}"
ADDON_MAX_GB="${ADDON_MAX_GB:-1}"
ADDON_TTL_HOURS="${ADDON_TTL_HOURS:-72}"
JSON_MAX_GB="${JSON_MAX_GB:-1}"
JSON_TTL_DAYS="${JSON_TTL_DAYS:-90}"
GATEWAY_HLS_MAX_GB="${GATEWAY_HLS_MAX_GB:-20}"
GATEWAY_HLS_TTL_HOURS="${GATEWAY_HLS_TTL_HOURS:-6}"
GATEWAY_TEMP_TTL_HOURS="${GATEWAY_TEMP_TTL_HOURS:-1}"
LOG_MAX_GB="${LOG_MAX_GB:-1}"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg"
  { echo "$msg" >> "$LOG_FILE"; } 2>/dev/null || true
}

cleanup_by_ttl() {
  local dir="$1" ttl_minutes="$2" label="$3"
  if [ ! -d "$dir" ]; then return; fi
  local count
  count=$(find "$dir" -type f -mmin +"$ttl_minutes" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    find "$dir" -type f -mmin +"$ttl_minutes" -delete 2>/dev/null || true
    log "$label: removed $count expired files (TTL ${ttl_minutes}m)"
  fi
}

cleanup_by_size() {
  local dir="$1" max_bytes="$2" label="$3"
  if [ ! -d "$dir" ]; then return; fi
  local current_bytes
  current_bytes=$(du -sk "$dir" 2>/dev/null | awk '{print $1 * 1024}')
  if [ -z "$current_bytes" ] || [ "$current_bytes" -le "$max_bytes" ]; then return; fi

  local excess=$(( current_bytes - max_bytes ))
  log "$label: over cap by $(( excess / 1024 / 1024 ))MB, pruning oldest files"

  local freed=0
  while IFS= read -r -d '' file; do
    local fsize
    fsize=$(stat -f%z "$file" 2>/dev/null || stat --printf="%s" "$file" 2>/dev/null || echo 0)
    rm -f "$file" 2>/dev/null || true
    freed=$(( freed + fsize ))
    if [ "$freed" -ge "$excess" ]; then break; fi
  done < <(find "$dir" -type f -printf '%T+ %s %p\0' 2>/dev/null | sort -z | cut -z -d' ' -f3- 2>/dev/null || \
            find "$dir" -type f -print0 2>/dev/null | xargs -0 ls -tr 2>/dev/null | tr '\n' '\0')
}

gb_to_bytes() {
  echo $(( $1 * 1024 * 1024 * 1024 ))
}

hours_to_minutes() {
  echo $(( $1 * 60 ))
}

days_to_minutes() {
  echo $(( $1 * 1440 ))
}

# Verify NAS is available
if [ ! -d "$NAS_ROOT" ]; then
  log "ABORT: NAS root not available: $NAS_ROOT"
  exit 1
fi

mkdir -p "$LOG_DIR" 2>/dev/null || true

log "=== Cache cleanup started ==="

# Poster cache
cleanup_by_ttl "$NAS_ROOT/cache/posters" "$(days_to_minutes "$POSTER_TTL_DAYS")" "posters"
cleanup_by_size "$NAS_ROOT/cache/posters" "$(gb_to_bytes "$POSTER_MAX_GB")" "posters"

# Meta cache
cleanup_by_ttl "$NAS_ROOT/cache/meta" "$(hours_to_minutes "$META_TTL_HOURS")" "meta"
cleanup_by_size "$NAS_ROOT/cache/meta" "$(gb_to_bytes "$META_MAX_GB")" "meta"

# Addon cache
cleanup_by_ttl "$NAS_ROOT/cache/addon" "$(hours_to_minutes "$ADDON_TTL_HOURS")" "addon"
cleanup_by_size "$NAS_ROOT/cache/addon" "$(gb_to_bytes "$ADDON_MAX_GB")" "addon"

# JSON metadata cache (TMDB id maps, season info, skip-times, ratings).
# Tiny + mostly immutable; the long TTL is just disk hygiene — entries are
# rewritten (mtime bumped) whenever refreshed, so actively-used keys survive.
cleanup_by_ttl "$NAS_ROOT/cache/json" "$(days_to_minutes "$JSON_TTL_DAYS")" "json"
cleanup_by_size "$NAS_ROOT/cache/json" "$(gb_to_bytes "$JSON_MAX_GB")" "json"

# Stream gateway HLS cache
cleanup_by_ttl "$NAS_ROOT/cache/stream-gateway/hls" "$(hours_to_minutes "$GATEWAY_HLS_TTL_HOURS")" "gateway-hls"
cleanup_by_size "$NAS_ROOT/cache/stream-gateway/hls" "$(gb_to_bytes "$GATEWAY_HLS_MAX_GB")" "gateway-hls"

# Stream gateway temp
cleanup_by_ttl "$NAS_ROOT/cache/stream-gateway/temp" "$(hours_to_minutes "$GATEWAY_TEMP_TTL_HOURS")" "gateway-temp"

# Log rotation: remove log files older than 30 days, cap total to LOG_MAX_GB
find "$NAS_ROOT/logs" -type f -name "*.log" -mtime +30 -delete 2>/dev/null || true
cleanup_by_size "$NAS_ROOT/logs" "$(gb_to_bytes "$LOG_MAX_GB")" "logs"

# Remove empty directories left behind
find "$NAS_ROOT/cache" -mindepth 2 -type d -empty -delete 2>/dev/null || true

log "=== Cache cleanup finished ==="
