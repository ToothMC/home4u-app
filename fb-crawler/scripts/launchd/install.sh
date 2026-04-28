#!/usr/bin/env bash
# Installiert die drei launchd-Jobs auf einem Mac (Hauptanwendung: dauerhaft
# laufender Mac mini). Substituiert __REPO_PATH__ + __HOME__ in den Templates,
# kopiert sie nach ~/Library/LaunchAgents/ und lädt sie.
#
# Usage:
#   ./install.sh           # installiert + lädt
#   ./install.sh --uninstall   # entlädt + entfernt
#
# Voraussetzungen vor dem ersten Start:
#   - .venv eingerichtet (cd ../..; python3 -m venv .venv && source .venv/bin/activate && pip install -e .)
#   - .env vorhanden mit SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
#   - groups.json gepflegt (REPLACE_ME_* ersetzt)
#   - In Chrome einmalig FB-Login + Group-Tabs öffnen (siehe README.md)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"     # …/home4u-app
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/home4u"

JOBS=(
  ai.home4u.fb-chrome
  ai.home4u.fb-refresh
  ai.home4u.fb-crawler
)

uid=$(id -u)
domain="gui/$uid"

uninstall() {
  for label in "${JOBS[@]}"; do
    target="$LAUNCH_AGENTS/$label.plist"
    if [[ -f "$target" ]]; then
      launchctl bootout "$domain/$label" 2>/dev/null || true
      rm -f "$target"
      echo "✗ entfernt: $label"
    fi
  done
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall
  exit 0
fi

mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR"

for label in "${JOBS[@]}"; do
  src="$SCRIPT_DIR/$label.plist"
  dst="$LAUNCH_AGENTS/$label.plist"

  if [[ ! -f "$src" ]]; then
    echo "FEHLER: Template fehlt: $src" >&2
    exit 1
  fi

  # __REPO_PATH__ und __HOME__ ersetzen
  sed -e "s|__REPO_PATH__|$REPO_ROOT|g" \
      -e "s|__HOME__|$HOME|g" \
      "$src" > "$dst"

  # Falls Job schon läuft → bootout für sauberes Reload
  launchctl bootout "$domain/$label" 2>/dev/null || true
  launchctl bootstrap "$domain" "$dst"
  echo "✓ installiert + geladen: $label"
done

echo
echo "Logs:"
echo "  tail -f $LOG_DIR/fb-crawler.out.log"
echo "  tail -f $LOG_DIR/fb-chrome.out.log"
echo "  tail -f $LOG_DIR/fb-refresh.out.log"
echo
echo "Status:"
echo "  launchctl print $domain/ai.home4u.fb-crawler"
echo
echo "Stoppen:"
echo "  $0 --uninstall"
