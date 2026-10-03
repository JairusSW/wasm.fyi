#!/usr/bin/env bash
set -euo pipefail
cd /src
[[ $(git rev-parse HEAD) == d0ee6801cc45748a8630a04723eb290fcff1a7bf ]]
[[ $(git -C yosys-src rev-parse HEAD) == fbab08acf14cc5e1fda6c33ba03094e348ea8953 ]]
# The pinned upstream recipe expects its SDK in the source tree.
ln -s "$WASI_SDK_PATH" wasi-sdk-19.0
# Keep the pinned source and compile flags; bound the native build concurrency.
sed 's/make -C yosys-build /make -j 2 -C yosys-build /' build.sh > source-build.sh
sh -ex source-build.sh
