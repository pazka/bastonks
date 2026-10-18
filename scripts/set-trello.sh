#!/usr/bin/env bash
# OWNER ONLY — writes the Trello secrets into the env file. Interactive, hidden input; nothing is printed,
# logged or passed on a command line (values travel through the environment of awk only).
# Usage (on the box): sudo bash -c 'cd /srv/bastonks && bash scripts/set-trello.sh ./bastonks.env'
#
# Where to get them (Trello, logged in as the board owner):
#   - API key: https://trello.com/power-ups/admin → your Power-Up → API key
#   - Token:   from the key page, "Token" link; grant READ access only (scope=read), expiration "never"
#   - Board id: the 8-character code in the board URL (trello.com/b/<code>/…) or the 24-hex board id
set -euo pipefail
umask 077
file="${1:-./bastonks.env}"
[ -f "$file" ] || { echo "env file not found: $file (create it from .env.example first)" >&2; exit 1; }

ask() { # name, prompt, regex
  local v
  while true; do
    read -r -s -p "$2: " v </dev/tty; echo >/dev/tty
    if [[ "$v" =~ $3 ]]; then printf -v "$1" '%s' "$v"; return; fi
    echo "  that does not look right (expected $4), try again" >/dev/tty
  done
}
ask KEY "Trello API key" '^[0-9a-f]{32}$' "32 hex characters"
ask TOKEN "Trello token (read-only)" '^[A-Za-z0-9]{60,128}$' "60-128 letters/digits"
ask BOARD "Board id or short code" '^[A-Za-z0-9]{8,32}$' "8-32 letters/digits"

tmp="$(mktemp "$(dirname "$file")/.bastonks.env.XXXXXX")"
TK="$KEY" TT="$TOKEN" TB="$BOARD" awk '
  BEGIN { k = ENVIRON["TK"]; t = ENVIRON["TT"]; b = ENVIRON["TB"] }
  /^TRELLO_KEY=/      { print "TRELLO_KEY=\x27" k "\x27"; sk = 1; next }
  /^TRELLO_TOKEN=/    { print "TRELLO_TOKEN=\x27" t "\x27"; st = 1; next }
  /^TRELLO_BOARD_ID=/ { print "TRELLO_BOARD_ID=\x27" b "\x27"; sb = 1; next }
  { print }
  END {
    if (!sk) print "TRELLO_KEY=\x27" k "\x27"
    if (!st) print "TRELLO_TOKEN=\x27" t "\x27"
    if (!sb) print "TRELLO_BOARD_ID=\x27" b "\x27"
  }' "$file" > "$tmp"
chmod 600 "$tmp"
chown --reference="$file" "$tmp" 2>/dev/null || true
mv -f "$tmp" "$file"
unset KEY TOKEN BOARD
echo "Trello secrets written to $file (mode 600). Restart: sudo hosh-deploy deploy bastonks <current tag>"
