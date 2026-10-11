# Source after setting private `state`; this file does not start any process.
load_dashboard_env() {
  local dashboard_state="$1" dashboard_temp dashboard_entry dashboard_key
  dashboard_temp="$(mktemp "$dashboard_state/dashboard-env.XXXXXX")"
  chmod 600 "$dashboard_temp"
  if ! python3 "$PWD/scripts/dashboard-env.py" "$PWD/local.env" > "$dashboard_temp"; then
    rm -f "$dashboard_temp"
    return 1
  fi
  while IFS= read -r -d '' dashboard_entry; do
    dashboard_key="${dashboard_entry%%=*}"
    # Explicitly exported caller environment always wins over the file.
    if ! printenv "$dashboard_key" >/dev/null; then export "$dashboard_entry"; fi
  done < "$dashboard_temp"
  rm -f "$dashboard_temp"
  export WASMFYI_DEV_ADMIN="${WASMFYI_DEV_ADMIN:-1}"
  export WASMFYI_LOCAL_PORT="${WASMFYI_LOCAL_PORT:-8788}"
  export WASMFYI_LOCAL_API_PORT="${WASMFYI_LOCAL_API_PORT:-8789}"
  export WASMFYI_LOCAL_VITE_PORT="${WASMFYI_LOCAL_VITE_PORT:-8790}"
  local dashboard_port
  for dashboard_port in "$WASMFYI_LOCAL_PORT" "$WASMFYI_LOCAL_API_PORT" "$WASMFYI_LOCAL_VITE_PORT"; do
    if [[ ! "$dashboard_port" =~ ^[0-9]{4,5}$ ]] || ((10#$dashboard_port < 1024 || 10#$dashboard_port > 65535)); then
      echo "Local dashboard ports must be between 1024 and 65535." >&2
      return 1
    fi
  done
  if ((10#$WASMFYI_LOCAL_PORT == 10#$WASMFYI_LOCAL_API_PORT || 10#$WASMFYI_LOCAL_PORT == 10#$WASMFYI_LOCAL_VITE_PORT || 10#$WASMFYI_LOCAL_API_PORT == 10#$WASMFYI_LOCAL_VITE_PORT)); then
    echo "Local dashboard ports must be distinct." >&2
    return 1
  fi
  export WASMFYI_DASHBOARD_ORIGIN="${WASMFYI_DASHBOARD_ORIGIN:-http://localhost:$WASMFYI_LOCAL_PORT}"
  export WASMFYI_SESSION_SECRET_FILE="${WASMFYI_SESSION_SECRET_FILE:-$dashboard_state/session-secret}"
  if [[ -z "${WASMFYI_GEOIP_DIR:-}" && -f "$dashboard_state/geoip/dbip-city-lite.mmdb" ]]; then
    export WASMFYI_GEOIP_DIR="$dashboard_state/geoip"
  fi
}
load_dashboard_env "$state"
