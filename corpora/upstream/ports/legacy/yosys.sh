#!/usr/bin/env bash
set -euo pipefail
cd "${1:-/src}"
[[ $(git rev-parse HEAD) == d0ee6801cc45748a8630a04723eb290fcff1a7bf ]]
[[ $(git -C yosys-src rev-parse HEAD) == fbab08acf14cc5e1fda6c33ba03094e348ea8953 ]]
if [[ $("${WASI_SDK_PATH:?set WASI_SDK_PATH}/bin/clang" --version | head -1) != 'clang version 15.0.7' ]]; then
  echo 'Yosys requires the pinned WASI SDK 19 compiler (Clang 15.0.7)' >&2
  exit 1
fi
# The pinned upstream recipe expects its SDK in the source tree.
ln -s "$WASI_SDK_PATH" wasi-sdk-19.0
# Keep the pinned source and compile flags; bound the native build concurrency.
sed 's/make -C yosys-build /make -j 2 -C yosys-build /' build.sh > source-build.sh
# The parent corpus SDK is for newer ports. Exporting it here makes upstream's
# relative WASI_SDK assignment leak into make, where the working directory changes.
unset WASI_SDK
sh -ex source-build.sh
