#!/usr/bin/env bash
# Startet Chrome mit Remote-Debugging-Port + isoliertem User-Profil.
# Voraussetzung für CDP-Attach durch den FB-Crawler.
#
# Usage: ./scripts/start-chrome.sh
#
# Nach dem Start:
#   1. Bei FB einloggen (manuell, ein Mal — Cookies bleiben im Profil-Dir)
#   2. FB-Gruppen-Tab(s) öffnen, scrollen
#   3. In separatem Terminal: `python -m src.main --watch`

set -euo pipefail

# .env laden falls vorhanden, sonst Defaults
if [[ -f "$(dirname "$0")/../.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$(dirname "$0")/../.env"; set +a
fi

CDP_PORT="${CDP_PORT:-9222}"
PROFILE_DIR="${CHROME_PROFILE_DIR:-$HOME/.home4u-fb-chrome}"

# Tilde manuell expandieren falls aus .env
PROFILE_DIR="${PROFILE_DIR/#\~/$HOME}"

mkdir -p "$PROFILE_DIR"

# Chrome-Binary plattformabhängig
case "$(uname -s)" in
  Darwin)
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ;;
  Linux)
    CHROME_BIN="$(command -v google-chrome || command -v chromium || true)"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Chrome nicht gefunden unter: $CHROME_BIN" >&2
  exit 1
fi

# Sanity: kein anderer Chrome-Prozess hört schon auf dem Port
if lsof -i ":$CDP_PORT" >/dev/null 2>&1; then
  echo "Port $CDP_PORT ist bereits belegt — läuft schon ein Chrome-Debug-Prozess?" >&2
  echo "Beenden mit: lsof -ti :$CDP_PORT | xargs kill" >&2
  exit 1
fi

echo "→ Starte Chrome mit CDP-Port $CDP_PORT, Profil $PROFILE_DIR"
echo "  CDP-DevTools: http://localhost:$CDP_PORT"
echo
echo "Workflow:"
echo "  1. Bei FB einloggen (einmalig — Cookies persistieren im Profil)"
echo "  2. FB-Gruppen öffnen, scrollen"
echo "  3. Crawler starten: python -m src.main --watch"
echo

exec "$CHROME_BIN" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  about:blank
