#!/usr/bin/env bash
# Deploys the current checkout to a Linux server or LXC and restarts the service.
#   DEPLOY_HOST=root@<container-ip> deploy/deploy.sh
#
# Copies the source (never ./data, node_modules or .next), installs dependencies
# with the locked versions, builds on the server, restarts systemd and waits for
# the app to answer. Run deploy/setup-lxc.sh once on a fresh container first.
set -euo pipefail

HOST="${DEPLOY_HOST:?Set DEPLOY_HOST, for example DEPLOY_HOST=root@<container-ip>}"
APP_DIR=/opt/u1-maker-hub
cd "$(dirname "$0")/.."

echo "==> syncing source to $HOST:$APP_DIR"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude data \
  --exclude '*.tsbuildinfo' --exclude .DS_Store \
  ./ "$HOST:$APP_DIR/"

echo "==> install, build, restart"
ssh "$HOST" "set -euo pipefail
  cd $APP_DIR
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack pnpm install --frozen-lockfile --reporter=silent
  corepack pnpm build >/tmp/u1-build.log 2>&1 || { tail -40 /tmp/u1-build.log; exit 1; }
  chown -R u1hub:u1hub $APP_DIR
  systemctl restart u1-maker-hub
  for i in \$(seq 1 30); do
    code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)
    [ \"\$code\" = 200 ] && { echo \"app answers 200 after \${i}s\"; exit 0; }
    sleep 1
  done
  echo 'app did not answer within 30s:'; journalctl -u u1-maker-hub -n 40 --no-pager; exit 1"
