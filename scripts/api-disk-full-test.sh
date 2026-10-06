#!/bin/sh
# Exhaust only a disposable, explicitly bounded container tmpfs.
set -eu
site_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(docker info --format '{{.Architecture}} {{.OSType}}')" in
  'aarch64 linux'|'arm64 linux') test_arch=arm64 ;;
  'x86_64 linux'|'amd64 linux') test_arch=amd64 ;;
  *) echo 'A native Linux Docker engine is required.' >&2; exit 1 ;;
esac
image='python@sha256:ddb0207ae1f0356c2b724d740769b0c5f5f51cc54a0525178f721825f78fe74c'
image_platform=$(docker image inspect "$image" --format '{{.Architecture}} {{.Os}}')
if [ "$image_platform" != "$test_arch linux" ]; then
  echo "The installed pinned image must match the native engine ($test_arch linux); found $image_platform." >&2
  exit 1
fi
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT HUP INT TERM
(cd "$site_root/service" && GOFLAGS=-mod=readonly GOWORK=off GOOS=linux GOARCH="$test_arch" go test -c -o "$scratch/store.test" ./internal/store)
for gate in TestKernelDiskExhaustionPreservesPublicationAndRecovery TestKernelWALExhaustionRecovery; do
  docker run --rm --network none --read-only --cpus 1 --memory 512m \
  --user 65534:65534 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 \
  --tmpfs /data:rw,nosuid,nodev,size=32m,mode=1777 \
  --env WASMFYI_ENOSPC_ROOT=/data \
  --mount "type=bind,src=$scratch/store.test,dst=/tests/store.test,readonly" \
  --mount "type=bind,src=$site_root/service/testdata,dst=$site_root/service/testdata,readonly" \
  --entrypoint /tests/store.test "$image" \
  -test.run "^$gate$" -test.v
done
