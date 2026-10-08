#!/usr/bin/env bash
set -euo pipefail
cache_root="${1:?Toolchain cache directory}"
source_root="$cache_root/zstd-1.5.5-source"
build_root="$cache_root/zstd-1.5.5-pic-build"
sdk_root="$cache_root/zstd-1.5.5-pic"
if [[ -f "$sdk_root/lib/libzstd.a" && -f "$sdk_root/receipt.json" ]]; then exit 0; fi
mkdir -p "$source_root"
if [[ ! -d "$source_root/.git" ]]; then
 git -C "$source_root" init -q
 git -C "$source_root" remote add origin https://github.com/facebook/zstd.git
fi
git -C "$source_root" fetch --depth 1 origin refs/tags/v1.5.5
git -C "$source_root" checkout --detach FETCH_HEAD
cmake -S "$source_root/build/cmake" -B "$build_root" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DZSTD_BUILD_SHARED=OFF -DZSTD_BUILD_STATIC=ON -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF -DCMAKE_INSTALL_PREFIX="$sdk_root"
cmake --build "$build_root" --target libzstd_static -j 2
cmake --install "$build_root"
python3 - "$source_root" "$sdk_root" <<'PY'
import pathlib,subprocess,json,hashlib,sys
source,sdk=map(pathlib.Path,sys.argv[1:]);revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
(sdk/'receipt.json').write_text(json.dumps({'repository':'facebook/zstd','tag':'v1.5.5','revision':revision,'positionIndependent':True,'librarySha256':hashlib.sha256((sdk/'lib/libzstd.a').read_bytes()).hexdigest()},indent=2)+'\n')
PY
