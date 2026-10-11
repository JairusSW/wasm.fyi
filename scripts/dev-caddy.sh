#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in caddy go pnpm openssl curl python3; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool. Install prerequisites first (macOS: brew install caddy)." >&2
    exit 1
  fi
done

# Keep the token and benchmark database private and reusable across restarts.
umask 077
state="$PWD/.wasmfyi/local"
mkdir -p "$state"
source "$PWD/scripts/dashboard-env.sh"
if [[ ! -f "$state/admin-token" ]]; then
  openssl rand -hex 32 > "$state/admin-token"
fi
export WASMFYI_ADMIN_TOKEN="${WASMFYI_ADMIN_TOKEN:-$(cat "$state/admin-token")}"
data_directory="${WASMFYI_DATA_DIR:-$(if [[ -f "$state/data-directory" ]]; then cat "$state/data-directory"; else echo "$state/data"; fi)}"
caddy validate --config service/Caddyfile.local --adapter caddyfile
(cd service && GOFLAGS=-mod=readonly GOWORK=off go build -o "$state/wasmfyi" ./cmd/wasmfyi)

pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$state/wasmfyi" serve --data "$data_directory" --listen "127.0.0.1:$WASMFYI_LOCAL_API_PORT" \
  --trusted-proxies 127.0.0.1/32 &
pids+=("$!")
# Launch Vite directly so cleanup owns its process.
node scripts/frontend-assets.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$WASMFYI_LOCAL_VITE_PORT" --strictPort &
pids+=("$!")
wait_http() {
  local url="$1" attempt pid
  for ((attempt=0; attempt<${WASMFYI_STARTUP_ATTEMPTS:-7200}; attempt++)); do
    for pid in "${pids[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" || return "$?"
        return 1
      fi
    done
    if curl --fail --silent --max-time 1 "$url" >/dev/null; then return 0; fi
    sleep 0.5
  done
  echo "Timed out waiting for $url" >&2
  return 1
}
# Do not expose a proxy that returns 502 while Vite is still starting.
echo "Starting benchmark database…"
wait_http "http://127.0.0.1:$WASMFYI_LOCAL_API_PORT/healthz"
wait_http http://127.0.0.1:5174/@vite/client
XDG_CONFIG_HOME="$state/caddy/config" XDG_DATA_HOME="$state/caddy/data" \
  caddy run --config service/Caddyfile.local --adapter caddyfile &
pids+=("$!")
wait_http "http://localhost:$WASMFYI_LOCAL_PORT/healthz"
echo "Website: http://localhost:$WASMFYI_LOCAL_PORT | API health: http://localhost:$WASMFYI_LOCAL_PORT/healthz"
echo "Local publisher token: $state/admin-token (or set WASMFYI_ADMIN_TOKEN)"
echo "Ctrl+C stops all three services. API data persists in $data_directory."
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || exit "$?"
      echo "A local service stopped; shutting down the remaining services." >&2
      exit 1
    fi
  done
  sleep 1
done
