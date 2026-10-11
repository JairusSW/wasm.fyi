#!/usr/bin/env python3
"""Activate a frontend-only release without copying or modifying databases."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request


def summary():
    request = urllib.request.Request("http://127.0.0.1:8090/api/summary", headers={"X-Real-IP": "127.0.0.1"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return {p["id"] for p in json.load(response)["platforms"]}


def ready():
    request = urllib.request.Request("http://127.0.0.1:8090/healthz", headers={"X-Real-IP": "127.0.0.1"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response).get("ready") is True


def switch(current, release):
    temporary = current.parent / ("current-frontend-" + str(os.getpid()))
    temporary.symlink_to(release)
    os.replace(temporary, current)


def activate(frontend, expected):
    frontend = Path(frontend).resolve(strict=True)
    if Path("/opt/wasmfyi/staging") not in frontend.parents:
        raise ValueError("Frontend must be staged under /opt/wasmfyi/staging")
    for name in ["index.html", "404.html"]:
        if not (frontend / name).is_file():
            raise ValueError("Incomplete frontend build")
    if any(p.is_symlink() for p in frontend.rglob("*")):
        raise ValueError("Frontend build must not contain symlinks")
    with open("/run/lock/wasmfyi-deployment.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = Path("/opt/wasmfyi/current")
        old = current.resolve(strict=True)
        binary = old / "wasmfyi"
        if hashlib.sha256(binary.read_bytes()).hexdigest() != expected:
            raise ValueError("Running API differs; use a full deployment")
        platforms = summary()
        if not platforms or not ready():
            raise ValueError("Existing API is not ready")
        release = old.parent / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-frontend")
        release.mkdir()
        os.link(binary, release / "wasmfyi")
        shutil.copytree(frontend, release / "frontend")
        try:
            switch(current, release)
            subprocess.run(["systemctl", "restart", "wasmfyi.service"], check=True, timeout=45)
            until = time.monotonic() + 120
            while time.monotonic() < until:
                try:
                    if ready() and summary() == platforms:
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(.2)
            else:
                raise RuntimeError("Frontend deployment readiness check failed")
        except BaseException:
            switch(current, old)
            subprocess.run(["systemctl", "restart", "wasmfyi.service"], check=True, timeout=45)
            raise
        receipt = {"status": "deployed", "release": str(release), "previousRelease": str(old),
                   "apiSha256": expected, "databaseReplaced": False, "apiBinaryChanged": False,
                   "publisherRestarted": False, "canonicalPlatforms": sorted(platforms)}
        (release / "deployment.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise InterruptedError("Frontend deployment interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    activate(sys.argv[1], sys.argv[2])
