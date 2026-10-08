#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in caddy go pnpm openssl curl; do
  command -v "$tool" >/dev/null || { echo "Missing $tool"; exit 1; }
done
umask 077
state="$PWD/.wasmfyi/local"
mkdir -p "$state"
if [[ ! -f "$state/admin-token" ]]; then openssl rand -hex 32 > "$state/admin-token"; fi
export WASMFYI_ADMIN_TOKEN="${WASMFYI_ADMIN_TOKEN:-$(cat "$state/admin-token")}"
data_directory="${WASMFYI_DATA_DIR:-$(if [[ -f "$state/data-directory" ]]; then cat "$state/data-directory"; else echo "$state/data"; fi)}"
(cd service && GOFLAGS=-mod=readonly GOWORK=off go build -o "$state/wasmfyi-production" ./cmd/wasmfyi)
pnpm build
caddy validate --config service/Caddyfile.production-local --adapter caddyfile
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$state/wasmfyi-production" serve --data "$data_directory" --frontend "$PWD/build" \
  --listen 127.0.0.1:8090 --trusted-proxies 127.0.0.1/32 &
pids+=("$!")
wait_http() {
  local url="$1" attempt pid
  for ((attempt=0; attempt<600; attempt++)); do
    for pid in "${pids[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" || return "$?"; return 1; fi
    done
    if curl --fail --silent --max-time 1 "$url" >/dev/null; then return 0; fi
    sleep 0.2
  done
  echo "Timed out waiting for $url" >&2
  return 1
}
wait_http http://127.0.0.1:8090/healthz
XDG_CONFIG_HOME="$state/caddy-production/config" XDG_DATA_HOME="$state/caddy-production/data" \
  caddy run --config service/Caddyfile.production-local --adapter caddyfile &
pids+=("$!")
wait_http http://localhost:8080/healthz
echo "Production build: http://localhost:8080"
echo "Dataset: $data_directory | compact benchmark database"
echo "Ctrl+C stops Go and Caddy; data persists."
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" || exit "$?"; exit 1; fi
  done
  sleep 1
done
