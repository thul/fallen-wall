#!/usr/bin/env bash
# Opens the TV page fullscreen. Started by the desktop autostart entry from install.sh.
URL="http://localhost:${PORT:-8080}/"

# Wait for the server (up to 60 s) so Chromium does not show an error page at boot.
for _ in $(seq 1 60); do curl -fs -o /dev/null "$URL" && break; sleep 1; done

# Older Pi OS names it chromium-browser, newer names it chromium.
BROWSER="$(command -v chromium-browser || command -v chromium)"

# autoplay flag: cannons can sound without anyone pressing a key.
# incognito: no "restore pages?" bubble after a power cut.
exec "$BROWSER" --kiosk --incognito --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 "$URL"
