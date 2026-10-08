#!/usr/bin/env bash
set -euo pipefail
release="${1:?Staged release directory is required}"
[[ "$release" == /opt/wasmfyi/releases/* && -f "$release/frontend/index.html" ]]
export PATH=/root/.cargo/bin:/usr/local/go/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
export DEBIAN_FRONTEND=noninteractive
exec 9>/run/lock/wasmfyi-deployment.lock
flock -x 9
if ! command -v caddy >/dev/null; then
  systemctl mask caddy.service
  apt-get install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$release/caddy-key.asc"
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg "$release/caddy-key.asc"
  curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y --no-install-recommends caddy
fi
if [[ ! -x "$release/wasmfyi" ]]; then
  (cd "$release/source/service" && CGO_ENABLED=0 GOWORK=off GOMAXPROCS=2 GOFLAGS=-mod=readonly go build -p 2 -o "$release/wasmfyi" ./cmd/wasmfyi)
fi
getent passwd wasmfyi >/dev/null || adduser --system --group --home /var/lib/wasmfyi --no-create-home wasmfyi
install -d -m 755 /etc/wasmfyi /var/lib/wasmfyi /var/lib/wasmfyi-publisher /root/.ssh
if [[ ! -f /etc/wasmfyi/environment ]]; then
  python3 - <<'PY'
import os, secrets
path = '/etc/wasmfyi/environment'
with open(path, 'x') as output:
    output.write('WASMFYI_ADMIN_TOKEN=' + secrets.token_hex(32) + '\nGOMAXPROCS=2\n')
os.chmod(path, 0o600)
PY
fi
chown -R wasmfyi:wasmfyi /var/lib/wasmfyi
find "$release/frontend" -type d -exec chmod 755 {} +
find "$release/frontend" -type f -exec chmod 644 {} +
chmod 755 "$release/wasmfyi" "$release" /opt/wasmfyi /opt/wasmfyi/releases
install -m 644 "$release/source/service/wasmfyi.service" /etc/systemd/system/wasmfyi.service
install -d -m 755 /usr/local/lib/wasmfyi
install -m 644 "$release/source/scripts/publish-host-captures.py" /usr/local/lib/wasmfyi/publish-host-captures.py
install -m 644 "$release/source/service/wasmfyi-publisher.service" /etc/systemd/system/wasmfyi-publisher.service
install -m 644 "$release/source/service/Caddyfile.remote" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nCPUAffinity=0 1\nEnvironment=GOMAXPROCS=2\n' > /etc/systemd/system/caddy.service.d/wasmfyi.conf
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ln -s "$release" /opt/wasmfyi/current.next
mv -Tf /opt/wasmfyi/current.next /opt/wasmfyi/current
systemctl unmask caddy.service
systemctl daemon-reload
systemctl enable wasmfyi caddy wasmfyi-publisher
systemctl restart wasmfyi
for attempt in {1..60}; do
  curl --fail --silent http://127.0.0.1:8090/healthz >/dev/null && break
  sleep 1
done
curl --fail --silent http://127.0.0.1:8090/healthz
systemctl restart caddy wasmfyi-publisher
echo 'Remote site services started.'
