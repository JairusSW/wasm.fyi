#!/usr/bin/env bash
# Deploy the existing frontend build; compilation happens only on Remote.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:-root@remote}"
[[ -f build/index.html && -f build/404.html ]] || {
  echo 'Build the frontend before deploying.' >&2
  exit 1
}
release="/opt/wasmfyi/releases/$(date -u +%Y%m%dT%H%M%SZ)"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPersist=24h -o ControlPath=/tmp/wasmfyi-remote-%C)
transport='ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPersist=24h -o ControlPath=/tmp/wasmfyi-remote-%C'
ssh "${ssh_options[@]}" "$host" "mkdir -p '$release/source/scripts'"
rsync -az -e "$transport" service/ "$host:$release/source/service/"
rsync -az -e "$transport" build/ "$host:$release/frontend/"
for script in install-remote-site.sh install-remote-site.mjs publish-host-captures.py; do
  rsync -az -e "$transport" "scripts/$script" "$host:$release/source/scripts/$script"
done
ssh "${ssh_options[@]}" "$host" "nohup /usr/local/bin/node '$release/source/scripts/install-remote-site.mjs' '$release' > '$release/deployment.log' 2>&1 < /dev/null & echo \$! > '$release/deployment.pid'"
echo "Deployment queued on $host: $release/deployment.log"
echo "Watch: ssh $host tail -f $release/deployment.log"
