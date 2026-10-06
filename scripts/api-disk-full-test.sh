#!/bin/sh
# Exhaust only a disposable, explicitly bounded container tmpfs.
set -eu
site_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(docker info --format '{{.Architecture}} {{.OSType}}')" in
  'aarch64 linux'|'arm64 linux') test_arch=arm64 ;;
  'x86_64 linux'|'amd64 linux') test_arch=amd64 ;;
  *) echo 'A native Linux Docker engine is required.' >&2; exit 1 ;;
esac
scratch=$(mktemp -d)
image="wasmfyi-disk-full:$(basename "$scratch" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  # CID files belong to this private scratch directory. Stop only containers
  # created by this invocation if the runner was interrupted.
  for cid_file in "$scratch"/*.cid; do
    if [ -f "$cid_file" ]; then
      docker container rm --force "$(cat "$cid_file")" >/dev/null 2>&1 || true
    fi
  done
  # Remove only this invocation's tag; never force-remove shared images.
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
# A static, trimmed binary needs no external base image or host-path mounts.
# runtime.Caller fixture paths become module-relative under -trimpath.
(cd "$site_root/service" && CGO_ENABLED=0 GOFLAGS=-mod=readonly GOWORK=off GOOS=linux GOARCH="$test_arch" go test -trimpath -c -o "$scratch/store.test" ./internal/store)
cp -R "$site_root/service/testdata" "$scratch/testdata"
cat > "$scratch/Dockerfile" <<'DOCKERFILE'
FROM scratch
COPY ["store.test", "/tests/store.test"]
COPY ["testdata", "/github.com/JairusSW/wasm.fyi/service/testdata"]
ENTRYPOINT ["/tests/store.test"]
DOCKERFILE
docker build --network none --pull=false --platform "linux/$test_arch" --tag "$image" "$scratch"
for gate in TestKernelDiskExhaustionRefusesNestedDirectory TestKernelDiskExhaustionPreservesPublicationAndRecovery TestKernelWALExhaustionRecovery; do
  docker run --rm --pull=never --cidfile "$scratch/$gate.cid" --network none --read-only --cpus 1 --memory 512m \
  --user 65534:65534 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 \
  --tmpfs /data:rw,nosuid,nodev,size=32m,mode=1777 \
  --env WASMFYI_ENOSPC_ROOT=/data \
  --entrypoint /tests/store.test "$image" \
  -test.run "^$gate$" -test.v
done
