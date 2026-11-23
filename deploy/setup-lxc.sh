#!/usr/bin/env bash
# One-time (and re-runnable) provisioning of an Ubuntu 24.04 LXC for U1 Maker Hub.
# Run as root inside the container:
#   ssh root@<lxc-ip> 'bash -s' < deploy/setup-lxc.sh
#
# Installs Node 22 + pnpm, the libraries OrcaSlicer needs even in CLI mode,
# OrcaSlicer itself (extracted AppImage in /opt/orcaslicer), a service user and
# the systemd unit. It does not deploy the app: run deploy/deploy.sh for that.
set -euo pipefail

ORCA_VERSION="${ORCA_VERSION:-2.4.2}"
ORCA_URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCA_VERSION}.AppImage"
APP_DIR=/opt/u1-maker-hub
DATA_DIR=/var/lib/u1-maker-hub
SERVICE_USER=u1hub
export DEBIAN_FRONTEND=noninteractive

echo "==> locale"
locale-gen en_US.UTF-8 >/dev/null
update-locale LANG=en_US.UTF-8

echo "==> base packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends curl ca-certificates git xz-utils rsync >/dev/null

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ $(node -v) != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable

echo "==> OrcaSlicer runtime libraries (needed even for the headless CLI)"
apt-get install -y -qq --no-install-recommends \
  libgtk-3-0t64 libwebkit2gtk-4.1-0 libgl1 libglu1-mesa libegl1 libopengl0 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libmspack0t64 libsecret-1-0 \
  libsoup-3.0-0 libsm6 libice6 libwayland-egl1 >/dev/null

echo "==> OrcaSlicer ${ORCA_VERSION}"
if ! /opt/orcaslicer/AppRun --help 2>/dev/null | grep -q "OrcaSlicer-${ORCA_VERSION}"; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/orca.AppImage" "$ORCA_URL"
  chmod +x "$tmp/orca.AppImage"
  (cd "$tmp" && ./orca.AppImage --appimage-extract >/dev/null)
  rm -rf /opt/orcaslicer
  mv "$tmp/squashfs-root" /opt/orcaslicer
  rm -rf "$tmp"
fi
/opt/orcaslicer/AppRun --help | head -1

echo "==> service user and directories"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 700 "$DATA_DIR"

echo "==> systemd unit"
cat >/etc/systemd/system/u1-maker-hub.service <<'UNIT'
[Unit]
Description=U1 Maker Hub (MakerWorld browser, Snapmaker U1 slicing and control)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=u1hub
Group=u1hub
WorkingDirectory=/opt/u1-maker-hub
Environment=NODE_ENV=production
Environment=HOSTNAME=0.0.0.0
Environment=PORT=3000
# Tokens, settings, downloads, jobs and favorites live here, outside the app dir.
Environment=DATA_DIR=/var/lib/u1-maker-hub
# OrcaSlicer writes its own config under $HOME.
Environment=HOME=/var/lib/u1-maker-hub
Environment=SLICER_APP=/opt/orcaslicer
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable u1-maker-hub >/dev/null 2>&1

echo "==> done. Deploy the app with deploy/deploy.sh from your machine."
