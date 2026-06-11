#!/usr/bin/env bash
# Send alert to Discord webhook when Blissful services fail.
# Usage: blissful-alert.sh <service-name> <error-message>
# Env: BLISSFUL_ALERT_WEBHOOK (Discord webhook URL)
set -euo pipefail

SERVICE="${1:-unknown}"
MESSAGE="${2:-Service failure detected}"
WEBHOOK="${BLISSFUL_ALERT_WEBHOOK:-}"

if [ -z "$WEBHOOK" ]; then
  echo "BLISSFUL_ALERT_WEBHOOK not set, skipping alert" >&2
  exit 0
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOSTNAME=$(hostname -s 2>/dev/null || echo "unknown")

PAYLOAD=$(cat <<EOF
{
  "embeds": [{
    "title": "Blissful Alert: $SERVICE",
    "description": "$MESSAGE",
    "color": 15158332,
    "fields": [
      { "name": "Host", "value": "$HOSTNAME", "inline": true },
      { "name": "Time", "value": "$TIMESTAMP", "inline": true }
    ],
    "footer": { "text": "Blissful Monitoring" }
  }]
}
EOF
)

curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WEBHOOK"
