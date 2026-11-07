#!/bin/sh
# Install the current production CLI. No sudo, source builds, or Go module tags.
set -eu
umask 077
fail() { printf 'wasmfyi: %s\n' "$*" >&2; exit 1; }
for tool in curl tar awk uname mktemp; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"; done
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) fail 'Supported systems: Linux and macOS';; esac
case "$(uname -m)" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) fail 'Supported architectures: AMD64 and ARM64';; esac
base=${WASMFYI_DOWNLOAD_BASE:-https://wasm.fyi/cli}
case "$base" in https://*) ;; *) fail 'Download base must use HTTPS';; esac
install_root=${WASMFYI_INSTALL_DIR:-"$HOME/.wasmfyi"}
mkdir -p "$install_root/bin" "$install_root/versions"
work_dir=$(mktemp -d "$install_root/.install.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --connect-timeout 15 --max-time 180 "$1" -o "$2"; }
fetch "$base/latest.txt" "$work_dir/latest.txt"
revision=$(tr -d '\r\n' < "$work_dir/latest.txt")
case "$revision" in ''|*[!0-9a-f]*) fail 'Invalid release revision';; esac
[ "${#revision}" -eq 40 ] || fail 'Invalid release revision'
fetch "$base/$revision/SHA256SUMS" "$work_dir/SHA256SUMS"
binary="wasmfyi-$os-$arch.tar.gz"
for name in "$binary" assets.tar.gz; do
 fetch "$base/$revision/$name" "$work_dir/$name"
 expected=$(awk -v name="$name" '$2 == name {print $1}' "$work_dir/SHA256SUMS")
 case "$expected" in ''|*[!0-9a-f]*) fail "Missing or invalid checksum for $name";; esac
 [ "${#expected}" -eq 64 ] || fail "Invalid checksum for $name"
 if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$work_dir/$name" | awk '{print $1}')
 elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$work_dir/$name" | awk '{print $1}')
 else fail 'sha256sum or shasum is required'; fi
 [ "$actual" = "$expected" ] || fail "Checksum mismatch for $name; installation unchanged"
 # Only regular files and directories in the documented layout may be extracted.
 tar -tzf "$work_dir/$name" > "$work_dir/entries"
 while IFS= read -r entry; do
  case "$entry" in bin/|bin/wasmfyi|share/|share/wasmfyi/|share/wasmfyi/*) ;; *) fail 'Unexpected archive path';; esac
  case "/$entry/" in */../*|*/./*|*///*) fail 'Unsafe archive path';; esac
 done < "$work_dir/entries"
 tar -tvzf "$work_dir/$name" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit bad}' || fail 'Archive contains links or special files'
done
stage="$work_dir/release"
mkdir "$stage"
tar -xzf "$work_dir/$binary" -C "$stage"
tar -xzf "$work_dir/assets.tar.gz" -C "$stage"
[ -f "$stage/share/wasmfyi/scripts/local/worker.mjs" ] || fail 'Incomplete CLI assets'
[ -f "$stage/share/wasmfyi/build/404.html" ] || fail 'Missing local website'
chmod 755 "$stage/bin/wasmfyi"
[ "$("$stage/bin/wasmfyi" version)" = "wasmfyi $revision" ] || fail 'CLI version or platform verification failed'
destination="$install_root/versions/$revision"
if [ -e "$destination" ]; then
 [ -x "$destination/bin/wasmfyi" ] && [ "$("$destination/bin/wasmfyi" version)" = "wasmfyi $revision" ] || fail 'Existing version directory is incomplete'
else mv "$stage" "$destination"; fi
ln -s "../versions/$revision/bin/wasmfyi" "$work_dir/wasmfyi"
# Rename atomically: a failed download never replaces a working installation.
mv -f "$work_dir/wasmfyi" "$install_root/bin/wasmfyi"
printf '\nInstalled wasmfyi %s\n\n' "$revision"
printf 'Add to your shell profile:\n  export PATH="%s/bin:$PATH"\n\nThen run: wasmfyi doctor\n' "$install_root"
printf 'Benchmarking requires Node.js 22+ and the selected runtimes\047 build tools.\n'
