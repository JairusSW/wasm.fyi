#!/usr/bin/env bash
set -euo pipefail
cd "${1:-/src}"
[[ $(git rev-parse HEAD) == e51014f9c05aa65cbf203442d37fef7c12390015 ]]
if [[ $("${WASI_SDK_PATH:?set WASI_SDK_PATH}/bin/clang" --version | head -1) != 'clang version 15.0.7' ]]; then
  echo 'Ruby requires the pinned WASI SDK 19 compiler (Clang 15.0.7)' >&2
  exit 1
fi
if ! wasm-opt --version | grep -Eq '^wasm-opt version 108( \(version_108\))?$'; then
  echo 'Ruby requires Binaryen wasm-opt version 108' >&2
  exit 1
fi
ruby tool/downloader.rb -d tool -e gnu config.guess config.sub
./autogen.sh
mkdir build-wasi
cd build-wasi
../configure --host=wasm32-unknown-wasi --prefix=/wlr-rubies \
  --with-ext= --with-static-linked-ext --disable-install-doc \
  LDFLAGS='-Wl,--stack-first -Wl,-z,stack-size=16777216' \
  optflags=-O2 debugflags= wasmoptflags=-O2
make -j 2 ruby
