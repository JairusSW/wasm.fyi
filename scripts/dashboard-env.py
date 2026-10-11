#!/usr/bin/env python3
"""Emit whitelisted private dashboard settings as NUL-separated assignments.

No shell evaluation, variable expansion, logging of secrets or token settings.
Used only by dashboard-env.sh; this program's output contains credentials.
"""
import os
import stat
import sys

ALLOWED = {
    "WASMFYI_GITHUB_CLIENT_ID", "WASMFYI_GITHUB_CLIENT_SECRET",
    "WASMFYI_ADMIN_GITHUB_LOGINS", "WASMFYI_DASHBOARD_ORIGIN",
    "WASMFYI_SESSION_SECRET_FILE", "WASMFYI_GEOIP_DIR",
    "WASMFYI_DEV_ADMIN", "WASMFYI_LOCAL_PORT", "WASMFYI_LOCAL_API_PORT", "WASMFYI_LOCAL_VITE_PORT",
}

def main():
    path = sys.argv[1]
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 8192:
            raise ValueError("Dashboard environment file must be an owned, private regular file (chmod 600).")
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            fd = -1
            content = handle.read(8193)
        settings = {}
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, value = line.partition("=")
            key = key.strip()
            if not separator or key not in ALLOWED or key in settings:
                raise ValueError("Invalid or unrecognized dashboard environment setting.")
            value = value.strip()
            if value.startswith(('"', "'")):
                if len(value) < 2 or value[-1] != value[0]:
                    raise ValueError("Invalid quoted dashboard environment setting.")
                value = value[1:-1]
            if "\x00" in value or len(value) > 2048:
                raise ValueError("Invalid dashboard environment value.")
            settings[key] = value
        sys.stdout.buffer.write(b"".join((key + "=" + value).encode() + b"\x00" for key, value in settings.items()))
    finally:
        if fd >= 0:
            os.close(fd)

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, UnicodeError):
        print("Cannot load private dashboard environment file; check ownership, chmod 600 and supported KEY=value syntax.", file=sys.stderr)
        sys.exit(1)
