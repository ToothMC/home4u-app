#!/usr/bin/env bash
# Bootstrap des FB-Crawlers auf einem frischen Mac mini (Apple Silicon).
# Idempotent — kann mehrfach laufen, überspringt was schon da ist.
#
# Usage (auf dem Mac mini, einmalig):
#   mkdir -p ~/Projekte && cd ~/Projekte && \
#     git clone https://github.com/ToothMC/home4u-app.git && \
#     cd home4u-app/fb-crawler && \
#     ./scripts/bootstrap-mac-mini.sh

set -euo pipefail

# Farben für Output
G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[1m"; X="\033[0m"
say()  { echo -e "${B}▶${X} $*"; }
ok()   { echo -e "  ${G}✓${X} $*"; }
warn() { echo -e "  ${Y}!${X} $*"; }
err()  { echo -e "  ${R}✗${X} $*" >&2; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FB_DIR="$REPO_DIR/fb-crawler"
cd "$FB_DIR"

# ─── 1. Homebrew ──────────────────────────────────────────────────────────────
say "Homebrew prüfen"
if ! command -v brew >/dev/null 2>&1; then
  warn "nicht installiert — installiere via offiziellem Skript"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon brew nach /opt/homebrew → in PATH bringen
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    # auch persistent für künftige Shells
    grep -q 'brew shellenv' ~/.zprofile 2>/dev/null \
      || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
fi
ok "$(brew --version | head -1)"

# ─── 2. Python 3.11 ───────────────────────────────────────────────────────────
say "Python 3.11 prüfen"
PYBIN="$(brew --prefix)/opt/python@3.11/bin/python3.11"
if [[ ! -x "$PYBIN" ]]; then
  warn "nicht da — brew install python@3.11"
  brew install python@3.11
fi
ok "$($PYBIN --version)"

# ─── 3. Google Chrome ─────────────────────────────────────────────────────────
say "Google Chrome prüfen"
if [[ ! -d "/Applications/Google Chrome.app" ]]; then
  warn "nicht installiert — brew install --cask google-chrome"
  brew install --cask google-chrome
fi
ok "Google Chrome.app vorhanden"

# ─── 4. Python-venv + Crawler installieren ────────────────────────────────────
say "Python venv + Crawler-Code installieren"
if [[ ! -d .venv ]]; then
  "$PYBIN" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -e . --quiet
ok "venv: $(python --version), Pakete installiert"

# ─── 5. .env vorbereiten ──────────────────────────────────────────────────────
say ".env prüfen"
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    warn ".env aus .env.example angelegt — JETZT noch Werte eintragen:"
    echo ""
    echo "    nano $FB_DIR/.env"
    echo ""
    echo "  Benötigt:"
    echo "    SUPABASE_URL"
    echo "    SUPABASE_SERVICE_ROLE_KEY"
    echo "    ANTHROPIC_API_KEY"
    echo ""
    NEEDS_ENV=1
  else
    err ".env.example fehlt im Repo — manuell anlegen"
    exit 1
  fi
else
  ok ".env vorhanden"
fi

# ─── 6. groups.json prüfen ────────────────────────────────────────────────────
say "groups.json prüfen"
if grep -q "REPLACE_ME" src/groups.json 2>/dev/null; then
  warn "src/groups.json enthält noch REPLACE_ME-Platzhalter — pflegen mit:"
  echo ""
  echo "    nano $FB_DIR/src/groups.json"
  echo ""
  NEEDS_GROUPS=1
else
  ok "groups.json ohne Platzhalter"
fi

# ─── 7. Status-Bericht + nächste Schritte ─────────────────────────────────────
echo ""
echo -e "${B}═══ Setup-Status ═══${X}"
echo ""
if [[ "${NEEDS_ENV:-0}" == "1" || "${NEEDS_GROUPS:-0}" == "1" ]]; then
  echo -e "${Y}Manuell zu erledigen:${X}"
  [[ "${NEEDS_ENV:-0}"    == "1" ]] && echo "  • .env mit Secrets füllen"
  [[ "${NEEDS_GROUPS:-0}" == "1" ]] && echo "  • src/groups.json mit echten FB-Group-IDs"
  echo ""
  echo -e "${B}Danach:${X}"
else
  echo -e "${G}Alle Configs sind da. Nächste Schritte:${X}"
fi
echo ""
echo "  ${B}1)${X} launchd-Jobs installieren (Chrome + Crawler + Tab-Refresh):"
echo "      $FB_DIR/scripts/launchd/install.sh"
echo ""
echo "  ${B}2)${X} Vom Hauptmac per Screen Sharing aufs mini einloggen:"
echo "      open vnc://\$(hostname).local"
echo "      → in Chrome bei Facebook einloggen"
echo "      → pro überwachte Gruppe einen Tab öffnen (Sortierung: 'Most recent')"
echo ""
echo "  ${B}3)${X} Logs live mitlesen:"
echo "      tail -f ~/Library/Logs/home4u/fb-crawler.out.log"
echo ""
