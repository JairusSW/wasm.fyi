#!/usr/bin/env python3
"""Merge private dashboard settings received on stdin into the service environment."""
import os
import fcntl
import stat
import sys
import tempfile

ALLOWED = {
    "WASMFYI_GITHUB_CLIENT_ID", "WASMFYI_GITHUB_CLIENT_SECRET",
    "WASMFYI_ADMIN_GITHUB_LOGINS", "WASMFYI_DASHBOARD_ORIGIN",
    "WASMFYI_SESSION_SECRET_FILE", "WASMFYI_GEOIP_DIR",
}


def main():
    payload = sys.stdin.buffer.read(8193)
    if len(payload) > 8192:
        raise ValueError()
    settings = {}
    for item in payload.split(b"\0"):
        if not item:
            continue
        key, sep, value = item.decode("utf-8").partition("=")
        if not sep or key not in ALLOWED or key in settings or "\n" in value or "\r" in value:
            raise ValueError()
        settings[key] = value
    if not settings:
        return
    # Deployment cannot inherit a development bypass from an older environment.
    settings["WASMFYI_DEV_ADMIN"] = "0"
    # Serialize with deployment activation and other configuration updates.
    lock_fd = os.open("/run/lock/wasmfyi-deployment.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    path = "/etc/wasmfyi/environment"
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "r", encoding="utf-8") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise ValueError()
        lines = source.read(65537)
    if len(lines) > 65536:
        raise ValueError()
    retained = [line for line in lines.splitlines(keepends=True)
                if line.split("=", 1)[0].strip() not in settings]
    if retained and not retained[-1].endswith("\n"):
        retained[-1] += "\n"
    # systemd EnvironmentFile quoting: escape expansion-sensitive characters.
    def quote(value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$") + '"'
    retained.extend(key + "=" + quote(value) + "\n" for key, value in sorted(settings.items()))
    out_fd, temporary = tempfile.mkstemp(prefix=".dashboard-env-", dir="/etc/wasmfyi")
    try:
        os.fchmod(out_fd, 0o600)
        with os.fdopen(out_fd, "w", encoding="utf-8") as output:
            output.writelines(retained)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory_fd = os.open("/etc/wasmfyi", os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, UnicodeError):
        print("Cannot apply private dashboard settings; service environment unchanged unless replacement completed.", file=sys.stderr)
        sys.exit(1)
