#!/usr/bin/env python3
"""Run an isolated built-service lifecycle using synthetic producer fixtures.
No benchmark execution, qualification, deployment or performance claims.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


def encoded(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=Path(__file__).resolve().parent.parent / "service/testdata/site-v2")
    args = parser.parse_args()
    binary = str(args.binary.resolve())
    manifest = json.loads((args.fixture / "manifest.json").read_bytes())
    payloads = {o["sha256"]: (args.fixture / "objects" / o["sha256"]).read_bytes() for o in manifest["objects"]}
    for o in manifest["objects"]:
        assert len(payloads[o["sha256"]]) == o["bytes"] and digest(payloads[o["sha256"]]) == o["sha256"]
    job = {"schema": 2, "session": "native-smoke", "machine": "isolated", "corpus": "corpus-0001", "attempt": "synthetic",
           "plan": digest(b"synthetic smoke plan"), "configuredHarnessPin": "0509a0a323f41c58a2f2db15a372fb2e63c692bf",
           "parentBundleSha256": digest(b"no archived tools in this synthetic fixture"), "status": "completed",
           "exports": [{"sha256": digest(encoded(manifest)), "manifest": manifest}]}
    token = "isolated-smoke-" + os.urandom(32).hex()
    env = {**os.environ, "WASMFYI_ADMIN_TOKEN": token}
    with tempfile.TemporaryDirectory(prefix="wasmfyi-native-smoke-") as temporary:
        root = Path(temporary)

        def command(*values):
            result = subprocess.run([binary, *map(str, values)], env=env, capture_output=True, timeout=60)
            if result.returncode:
                raise RuntimeError(f"{values[0]} failed ({result.returncode}): " + result.stderr.decode(errors="replace"))
            return result.stdout

        def exercise(data, callback):
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            with (root / (data.name + ".log")).open("wb") as log:
                process = subprocess.Popen([binary, "serve", "--data", str(data), "--listen", f"127.0.0.1:{port}"], env=env, stdout=log, stderr=log)
                try:
                    def call(path, method="GET", value=None, raw=False):
                        body = value if raw else encoded(value) if value is not None else None
                        headers = {"Authorization": "Bearer " + token}
                        if body is not None:
                            headers["Content-Type"] = "application/octet-stream" if raw else "application/json"
                        request = Request(f"http://127.0.0.1:{port}" + path, body, headers, method=method)
                        with urlopen(request, timeout=10) as response:
                            data = response.read((1 << 20) + 1)
                            assert len(data) <= 1 << 20
                            return json.loads(data)
                    deadline = time.monotonic() + 20
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError("service exited: " + (root / (data.name + ".log")).read_text())
                        try:
                            call("/api/v1/manifest")
                            break
                        except (URLError, ConnectionError):
                            if time.monotonic() >= deadline:
                                raise
                            time.sleep(0.025)
                    callback(call)
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    assert process.returncode == 0, (root / (data.name + ".log")).read_text()

        frozen = {}
        def import_and_read(call):
            identifier = call("/admin/v1/imports", "POST", job)["id"]
            for _ in range(len(payloads) + 1):
                missing = call(f"/admin/v1/imports/{identifier}/missing")
                if not missing["items"]:
                    assert missing["complete"]
                    break
                for o in missing["items"]:
                    call("/admin/v1/objects/" + o["sha256"], "PUT", payloads[o["sha256"]], True)
            else:
                raise RuntimeError("missing-object import did not converge")
            revision = call(f"/admin/v1/imports/{identifier}/commit", "POST")["revision"]
            assert call(f"/admin/v1/imports/{identifier}/commit", "POST")["revision"] == revision
            page = call("/api/v1/results?revision=" + revision + "&limit=1")
            assert page["total"] == 3 and len(page["items"]) == 1 and page["nextCursor"]
            frozen.update(revision=revision, page=page,
                          session=call("/api/v1/sessions/native-smoke?revision=" + revision),
                          history=call("/api/v1/history?revision=" + revision))
        live = root / "live"
        exercise(live, import_and_read)
        def verify(call):
            assert call("/api/v1/manifest")["revision"] == frozen["revision"]
            assert call("/api/v1/results?revision=" + frozen["revision"] + "&limit=1") == frozen["page"]
            cursor = frozen["page"]["nextCursor"]
            from urllib.parse import quote
            assert call("/api/v1/results?limit=1&cursor=" + quote(cursor, safe=""))["revision"] == frozen["revision"]
            assert call("/api/v1/sessions/native-smoke?revision=" + frozen["revision"]) == frozen["session"]
            assert call("/api/v1/history?revision=" + frozen["revision"]) == frozen["history"]
        exercise(live, verify)
        backup = root / "backup"
        command("backup", "--data", live, "--output", backup)
        command("verify-backup", "--data", backup)
        for action in ["restore", "rebuild"]:
            destination = root / action
            command(action, "--data", backup, "--output", destination)
            exercise(destination, verify)
        print(json.dumps({"status": "passed", "system": platform.system(), "machine": platform.machine(), "checks": ["http-import", "idempotence", "graceful-shutdown", "restart", "backup-verification", "restore", "db-free-rebuild", "frozen-values", "cursor-key"], "fixture": "synthetic; no benchmark execution"}))


if __name__ == "__main__":
    main()
