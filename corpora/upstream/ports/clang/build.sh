#!/usr/bin/env bash
set -euo pipefail
source_dir=${1:?LLVM source checkout required}
output=${2:?Wasm output path required}
sdk=${WASI_SDK:?set WASI_SDK}
port_dir=$(cd "$(dirname "$0")" && pwd)
[[ $(git -C "$source_dir" rev-parse HEAD) == 5dc09c94393510bc8d042a9f07382b53e845c0f2 ]]
git -C "$source_dir" apply "$port_dir/compat.patch"
build_root=$(dirname "$source_dir")/clang-build
cmake -S "$source_dir/llvm" -B "$build_root/native" -G Ninja \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS='-include cstdint -include string' \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS=clang \
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_ENABLE_THREADS=OFF -DLLVM_ENABLE_LIBXML2=OFF
cmake --build "$build_root/native" --target llvm-tblgen clang-tblgen --parallel 3
emulation='-DBINJI_HACK -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID'
cmake -S "$source_dir/llvm" -B "$build_root/wasi" -G Ninja \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DUNIX=ON \
  -DCMAKE_TOOLCHAIN_FILE="$sdk/share/cmake/wasi-sdk-p1.cmake" \
  -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_C_FLAGS="$emulation" \
  -DCMAKE_CXX_FLAGS="$emulation -include exception -include type_traits" \
  -DCMAKE_EXE_LINKER_FLAGS='-lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid -Wl,-z,stack-size=16777216' \
  -DLLVM_TABLEGEN="$build_root/native/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="$build_root/native/bin/clang-tblgen" \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS=clang \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_INCLUDE_UTILS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_GO_TESTS=OFF -DLLVM_ENABLE_BINDINGS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_BUILD_DOCS=OFF -DLLVM_ENABLE_THREADS=OFF -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_UNWIND_TABLES=OFF -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_BUILD_STATIC=ON -DCMAKE_SKIP_RPATH=ON \
  -DCMAKE_SKIP_INSTALL_RPATH=ON -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF \
  -DCLANG_ENABLE_ARCMT=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_BUILD_TOOLS=OFF
cmake --build "$build_root/wasi" --target clang --parallel 3
cp "$build_root/wasi/bin/clang" "$output"
