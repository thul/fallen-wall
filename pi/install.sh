#!/usr/bin/env bash
# One-time setup on Raspberry Pi OS (desktop version). Run as your normal user, not root:
#   bash ~/fallen-wall/pi/install.sh
# Then reboot. The server starts at boot and Chromium opens the TV page fullscreen.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"

if ! command -v node >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y nodejs
fi
NODE="$(command -v node)"

# Server: systemd service, starts at boot, restarts if it crashes.
sudo tee /etc/systemd/system/fallen-wall.service >/dev/null <<EOF
[Unit]
Description=Fallen Wall server
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$NODE server.js
Restart=always
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now fallen-wall

# Kiosk: open the TV page when the desktop starts.
chmod +x "$APP_DIR/pi/kiosk.sh"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/fallen-wall-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Fallen Wall kiosk
Exec=$APP_DIR/pi/kiosk.sh
EOF

# Keep the TV from going black after 10 minutes.
sudo raspi-config nonint do_blanking 1 || echo "Could not disable screen blanking; do it in raspi-config > Display Options."

echo
echo "Done. Reboot with: sudo reboot"
echo "Admin code: $(cat "$APP_DIR/data/admin-token.txt" 2>/dev/null || echo 'see: journalctl -u fallen-wall')"
echo "Admin page: http://$(hostname -I | awk '{print $1}'):8080/admin"
