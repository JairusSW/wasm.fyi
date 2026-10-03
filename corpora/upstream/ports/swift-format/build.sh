#!/usr/bin/env bash
set -euo pipefail
source_dir=${1:?source checkout required}
output=${2:?output path required}
port_dir=$(cd "$(dirname "$0")" && pwd)
[[ $(git -C "$source_dir" rev-parse HEAD) == 92097d54ac3be47738fe77e38c918e9aabce0302 ]]
cp "$port_dir/Package.resolved" "$source_dir/Package.resolved"
# Use the Linux Swift compiler, whose backend includes WebAssembly. The Apple
# compiler at the same version crashes while targeting this SDK.
docker run --rm --platform linux/amd64 --memory=8g --cpus=2 -v "$source_dir:/src" -w /src \
  swift@sha256:cd45c27b3abc42310c33cfaf3008b18156cbdc9187834c9617e8f43a26d2675c \
  bash -ec 'swift sdk install https://download.swift.org/swift-6.3.3-release/wasm-sdk/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz --checksum cabfa08b73bb8ac783927ecd15fa386e99d0c139c5f232445067bcf58379cae7
    swift build --product swift-format --swift-sdk swift-6.3.3-RELEASE_wasm --force-resolved-versions -c release -j 2'
cp "$source_dir/.build/release/swift-format.wasm" "$output"
