#!/usr/bin/env bash
set -euo pipefail
cd /src
[[ $(git rev-parse HEAD) == e51014f9c05aa65cbf203442d37fef7c12390015 ]]
ruby tool/downloader.rb -d tool -e gnu config.guess config.sub
./autogen.sh
mkdir build-wasi
cd build-wasi
../configure --host=wasm32-unknown-wasi --prefix=/wlr-rubies \
  --with-ext= --with-static-linked-ext --disable-install-doc \
  LDFLAGS='-Wl,--stack-first -Wl,-z,stack-size=16777216' \
  optflags=-O2 debugflags= wasmoptflags=-O2
make -j 2 ruby
