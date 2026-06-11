#!/usr/bin/env bash
# Daily backup of Blissful state and config to NAS.
# Run via launchd: com.budinoff.blissful-backup
set -euo pipefail

NAS_ROOT="${BLISSFUL_NAS_ROOT:-/Volumes/2TB/NAS/blissful}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RETAIN_DAYS="${BLISSFUL_BACKUP_RETAIN_DAYS:-14}"

STATE_SRC="$NAS_ROOT/state/blissful-storage"
CONFIG_SRC="$NAS_ROOT/config"
STATE_DEST="$NAS_ROOT/backups/state"
CONFIG_DEST="$NAS_ROOT/backups/config"
LOG_DIR="$NAS_ROOT/logs/ops"
LOG_FILE="$LOG_DIR/backup-$(date +%Y%m%d).log"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

if [ ! -d "$NAS_ROOT" ]; then
  echo "ABORT: NAS root not available: $NAS_ROOT" >&2
  exit 1
fi

mkdir -p "$STATE_DEST" "$CONFIG_DEST" "$LOG_DIR" 2>/dev/null || true

log "=== Backup started ==="

# State backup
if [ -d "$STATE_SRC" ] && [ "$(ls -A "$STATE_SRC" 2>/dev/null)" ]; then
  ARCHIVE="$STATE_DEST/state-$TIMESTAMP.tar.gz"
  tar czf "$ARCHIVE" -C "$(dirname "$STATE_SRC")" "$(basename "$STATE_SRC")"
  log "State backup: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
else
  log "State backup: skipped (empty or missing source)"
fi

# Config backup
if [ -d "$CONFIG_SRC" ] && [ "$(ls -A "$CONFIG_SRC" 2>/dev/null)" ]; then
  ARCHIVE="$CONFIG_DEST/config-$TIMESTAMP.tar.gz"
  tar czf "$ARCHIVE" -C "$(dirname "$CONFIG_SRC")" "$(basename "$CONFIG_SRC")"
  log "Config backup: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
else
  log "Config backup: skipped (empty or missing source)"
fi

# Prune old snapshots
log "Pruning backups older than $RETAIN_DAYS days..."
find "$STATE_DEST" -name "state-*.tar.gz" -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true
find "$CONFIG_DEST" -name "config-*.tar.gz" -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true

STATE_COUNT=$(find "$STATE_DEST" -name "state-*.tar.gz" 2>/dev/null | wc -l | tr -d ' ')
CONFIG_COUNT=$(find "$CONFIG_DEST" -name "config-*.tar.gz" 2>/dev/null | wc -l | tr -d ' ')
log "Retained: $STATE_COUNT state snapshots, $CONFIG_COUNT config snapshots"

log "=== Backup finished ==="
