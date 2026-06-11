#!/usr/bin/env bash
# Monitors all Blissful service health endpoints.
# Sends Discord alert if 5+ failures detected in 5 minutes.
# Run via launchd or cron every minute.
set -euo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FAILURE_DIR="$NAS_ROOT/logs/ops/failures"
ALERT_COOLDOWN_FILE="$NAS_ROOT/logs/ops/.last-alert"
ALERT_COOLDOWN_SECONDS=300

mkdir -p "$FAILURE_DIR" 2>/dev/null || true

SERVICES=(
  "blissful-storage|http://127.0.0.1:18787/health"
  "addon-proxy|http://127.0.0.1:13000/health"
  "stream-gateway|http://127.0.0.1:18082/stream/health"
)

NOW=$(date +%s)
FAILURES=0

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name url <<< "$entry"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" != "200" ]; then
    echo "$NOW $name $HTTP_CODE" >> "$FAILURE_DIR/recent.log"
    FAILURES=$((FAILURES + 1))
    echo "FAIL: $name ($url) -> HTTP $HTTP_CODE"
  else
    echo "OK: $name"
  fi
done

# Count recent failures (last 5 minutes)
CUTOFF=$((NOW - 300))
RECENT_FAILURES=0
if [ -f "$FAILURE_DIR/recent.log" ]; then
  while IFS= read -r line; do
    TS=$(echo "$line" | awk '{print $1}')
    if [ "$TS" -ge "$CUTOFF" ] 2>/dev/null; then
      RECENT_FAILURES=$((RECENT_FAILURES + 1))
    fi
  done < "$FAILURE_DIR/recent.log"

  # Trim old entries
  awk -v cutoff="$CUTOFF" '$1 >= cutoff' "$FAILURE_DIR/recent.log" > "$FAILURE_DIR/recent.log.tmp" 2>/dev/null || true
  mv "$FAILURE_DIR/recent.log.tmp" "$FAILURE_DIR/recent.log" 2>/dev/null || true
fi

# Send alert if threshold exceeded
if [ "$RECENT_FAILURES" -ge 5 ]; then
  SHOULD_ALERT=true

  if [ -f "$ALERT_COOLDOWN_FILE" ]; then
    LAST_ALERT=$(cat "$ALERT_COOLDOWN_FILE" 2>/dev/null || echo 0)
    if [ "$((NOW - LAST_ALERT))" -lt "$ALERT_COOLDOWN_SECONDS" ]; then
      SHOULD_ALERT=false
    fi
  fi

  if [ "$SHOULD_ALERT" = true ]; then
    echo "$NOW" > "$ALERT_COOLDOWN_FILE"
    "$SCRIPT_DIR/blissful-alert.sh" "health-monitor" \
      "$RECENT_FAILURES failures in last 5 minutes across Blissful services"
    echo "ALERT: Sent Discord notification ($RECENT_FAILURES failures)"
  fi
fi
