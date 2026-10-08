#!/usr/bin/env bash
set -euo pipefail
history_root="${1:?History directory is required}"
harness_root="$history_root/frozen-harness"
site_root="${2:?Site directory is required}"
engine="${3:-all}"
if ! git -C "$harness_root" rev-parse HEAD >/dev/null 2>&1; then
  git -C "$harness_root" init -q
  git -C "$harness_root" add .
  git -C "$harness_root" -c user.name='Benchmark collector' \
    -c user.email=collector@localhost commit -qm 'Frozen benchmark harness'
fi
cd "$harness_root"
go build -o "$history_root/controller" ./cmd/wasmbench
cd "$site_root"
if [[ "$engine" == all ]]; then
  exec node scripts/benchmark-history-coordinator.mjs "$history_root" "$harness_root"
fi
exec node scripts/benchmark-go-history.mjs "$history_root" "$harness_root" "$engine"
