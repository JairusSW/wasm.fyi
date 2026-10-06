#!/usr/bin/env python3
"""Run an isolated built-service lifecycle using synthetic or existing producer exports.
No benchmark execution, qualification, deployment or performance claims.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen
from urllib.parse import quote


def encoded(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


@contextmanager
def scratch_store():
    root = Path(tempfile.mkdtemp(prefix="wasmfyi-native-smoke-"))
    try:
        yield root
    except BaseException:
        print(f"Failed lifecycle store and logs retained at {root}", file=sys.stderr, flush=True)
        raise
    else:
        shutil.rmtree(root)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--producer-binary", type=Path, help="Producer CLI used to independently verify the existing report")
    parser.add_argument("--source-report", type=Path, help="Existing sealed report matching the export")
    parser.add_argument("--fixture", type=Path, default=Path(__file__).resolve().parent.parent / "service/testdata/site-v2")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--export", type=Path, help="Keep a new portable backup and frozen expectations after validation")
    mode.add_argument("--recover", type=Path, help="Validate an exported bundle without importing its source fixture")
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("Validation requires Python assertions; do not use -O or PYTHONOPTIMIZE")
    if args.recover and (args.source_report or args.producer_binary):
        parser.error("Recovery must use only its portable bundle, without source evidence")
    if bool(args.source_report) != bool(args.producer_binary):
        parser.error("Use --source-report and --producer-binary together")
    binary = str(args.binary.resolve())
    if not args.recover:
        manifest = json.loads((args.fixture / "manifest.json").read_bytes())
        if args.source_report:
            subprocess.run([str(args.producer_binary.resolve()), "verify-report", "--dir", str(args.source_report.resolve())], check=True, timeout=300, capture_output=True)
            assert manifest["verification"] == "source-recomputed"
            assert manifest["sourceReportSha256"] == digest((args.source_report / "data.json").read_bytes())
            assert manifest["sourceSealSha256"] == digest((args.source_report / "checksums.json").read_bytes())
        objects_root = args.fixture / "objects"
        assert objects_root.is_dir() and not objects_root.is_symlink()
        def object_bytes(identifier, count, kind):
            assert re.fullmatch("[a-f0-9]{64}", identifier)
            ceiling = 16 << 20 if kind == "binary" else 256 << 10
            assert isinstance(count, int) and 0 <= count <= ceiling
            path = objects_root / identifier
            info = path.lstat()
            assert stat.S_ISREG(info.st_mode) and info.st_size == count
            with path.open("rb") as stream:
                body = stream.read(ceiling + 1)
            assert len(body) == count and digest(body) == identifier
            return body
        descriptors = list(manifest["objects"])
        inventory_ids = set()
        payloads = {}
        for page in manifest.get("inventoryPages", []):
            body = object_bytes(page["sha256"], page["bytes"], "inventory")
            assert len(body) == page["bytes"] and digest(body) == page["sha256"]
            inventory = json.loads(body)
            assert inventory["schema"] == 1 and len(inventory["objects"]) == page["objects"]
            assert sum(o["bytes"] for o in inventory["objects"]) == page["contentBytes"]
            assert page["sha256"] not in inventory_ids
            inventory_ids.add(page["sha256"])
            payloads[page["sha256"]] = {"bytes": page["bytes"], "kind": "inventory"}
            descriptors.extend(inventory["objects"])
        for o in descriptors:
            body = object_bytes(o["sha256"], o["bytes"], o["kind"])
            assert len(body) == o["bytes"] and digest(body) == o["sha256"]
            assert o["sha256"] not in payloads
            payloads[o["sha256"]] = o
        job = {"schema": 2, "session": "native-smoke", "machine": "isolated", "corpus": "corpus-0001", "attempt": "synthetic",
               "plan": digest(b"synthetic smoke plan"), "configuredHarnessPin": "0509a0a323f41c58a2f2db15a372fb2e63c692bf",
               "parentBundleSha256": digest(b"no archived tools in this synthetic fixture"), "status": "completed",
               "exports": [{"sha256": digest(encoded(manifest)), "manifest": manifest}]}
    token = "isolated-smoke-" + os.urandom(32).hex()
    env = {**os.environ, "WASMFYI_ADMIN_TOKEN": token}
    with scratch_store() as root:

        def command(*values):
            started = time.monotonic()
            print(f"Starting {values[0]}", file=sys.stderr, flush=True)
            # Recovery validates and synchronously copies the complete evidence
            # closure. Keep it bounded without imposing ordinary HTTP budgets.
            with (root / (str(values[0]) + ".command.log")).open("ab") as log:
                result = subprocess.run([binary, *map(str, values)], env=env, stdout=subprocess.PIPE, stderr=log, timeout=600)
            print(f"Finished {values[0]} in {time.monotonic() - started:.1f}s", file=sys.stderr, flush=True)
            if result.returncode:
                raise RuntimeError(f"{values[0]} failed ({result.returncode}): " + (root / (str(values[0]) + ".command.log")).read_text(errors="replace"))
            return result.stdout

        def exercise(data, callback):
            started = time.monotonic()
            print(f"Starting {data.name}/{callback.__name__}", file=sys.stderr, flush=True)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            with (root / (data.name + ".log")).open("wb") as log:
                process = subprocess.Popen([binary, "serve", "--data", str(data), "--listen", f"127.0.0.1:{port}"], env=env, stdout=log, stderr=log)
                try:
                    def call(path, method="GET", value=None, raw=False, download=False):
                        body = value if raw else encoded(value) if value is not None else None
                        headers = {"Authorization": "Bearer " + token}
                        if body is not None:
                            headers["Content-Type"] = "application/octet-stream" if raw else "application/json"
                        request = Request(f"http://127.0.0.1:{port}" + path, body, headers, method=method)
                        commit = method == "POST" and re.fullmatch(r"/admin/v1/(imports|plans)/[a-f0-9]{64}/commit", path)
                        budget = 300 if commit else 30
                        deadline = time.monotonic() + budget
                        while True:
                            try:
                                response = urlopen(request, timeout=max(0.1, deadline - time.monotonic()))
                                break
                            except HTTPError as error:
                                if error.code != 429:
                                    raise
                                retry = error.headers.get("Retry-After", "")
                                error.close()
                                assert retry.isdigit() and 1 <= int(retry) <= 30
                                if time.monotonic() + int(retry) >= deadline:
                                    raise TimeoutError("publisher retry exceeds request deadline")
                                time.sleep(int(retry))
                        with response:
                            if download:
                                hasher = hashlib.sha256()
                                size = 0
                                while True:
                                    chunk = response.read(64 * 1024)
                                    if not chunk:
                                        break
                                    size += len(chunk)
                                    assert size <= 1 << 30
                                    hasher.update(chunk)
                                assert size == int(response.headers["Content-Length"])
                                return {"sha256": hasher.hexdigest(), "bytes": size}
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
            print(f"Finished {data.name}/{callback.__name__} in {time.monotonic() - started:.1f}s", file=sys.stderr, flush=True)

        def pages(call, path):
            rows = []
            cursor = ""
            seen = set()
            total = None
            scope_revision = None
            returned = 0
            for _ in range(100000):
                page = call(path + ("&cursor=" + quote(cursor, safe="") if cursor else ""))
                if total is None:
                    total, scope_revision = page["total"], page["revision"]
                assert page["total"] == total and page["revision"] == scope_revision
                returned += len(page["items"])
                assert returned <= total
                rows.append(page)
                if page["complete"]:
                    assert returned == total
                    assert not page.get("nextCursor")
                    return rows
                cursor = page["nextCursor"]
                assert cursor and cursor not in seen
                seen.add(cursor)
            raise RuntimeError("pagination exceeded gate ceiling")

        frozen = json.loads((args.recover / "expected.json").read_bytes()) if args.recover else {}
        def import_and_read(call):
            identifier = call("/admin/v1/imports", "POST", job)["id"]
            uploaded = 0
            for _ in range(len(payloads) + 1):
                missing = call(f"/admin/v1/imports/{identifier}/missing")
                if not missing["items"]:
                    assert missing["complete"]
                    break
                for o in missing["items"]:
                    source = payloads[o["sha256"]]
                    assert source["bytes"] == o["bytes"] and source["kind"] == o["kind"]
                    call("/admin/v1/objects/" + o["sha256"], "PUT", object_bytes(o["sha256"], source["bytes"], source["kind"]), True)
                    uploaded += 1
                    if uploaded % 1000 == 0:
                        print(f"Uploaded {uploaded}/{len(payloads)} objects", file=sys.stderr, flush=True)
                    if o["sha256"] in inventory_ids:
                        call(f"/admin/v1/imports/{identifier}/inventories/{o['sha256']}", "POST")
            else:
                raise RuntimeError("missing-object import did not converge")
            print(f"Committing import after {uploaded} missing-object uploads", file=sys.stderr, flush=True)
            revision = call(f"/admin/v1/imports/{identifier}/commit", "POST")["revision"]
            print("Import committed; verifying idempotence and complete pages", file=sys.stderr, flush=True)
            assert call(f"/admin/v1/imports/{identifier}/commit", "POST")["revision"] == revision
            page = call("/api/v1/results?revision=" + revision + "&limit=1")
            assert page["total"] > 1 and len(page["items"]) == 1 and page["nextCursor"]
            frozen.update(revision=revision, page=page,
                          session=call("/api/v1/sessions/native-smoke?revision=" + revision),
                          history=call("/api/v1/history?revision=" + revision),
                          resultPages=pages(call,"/api/v1/results?revision="+revision+"&limit=100"),
                          historyPages=pages(call,"/api/v1/history?revision="+revision+"&limit=100"),
                          evidenceKind="producer-verified-existing-report" if args.source_report else "synthetic")
            if args.source_report:
                frozen["sourceVerification"] = {
                    "sourceReportSha256": manifest["sourceReportSha256"],
                    "sourceSealSha256": manifest["sourceSealSha256"],
                    "verifierBinarySha256": digest(args.producer_binary.read_bytes()),
                    "verification": "producer-cli-verify-report-exit-zero",
                }
            assert sum(len(p["items"]) for p in frozen["resultPages"]) == page["total"]
            frozen["downloads"] = []
            for descriptor in descriptors:
                if descriptor["kind"] != "record":
                    continue
                record = json.loads(object_bytes(descriptor["sha256"], descriptor["bytes"], descriptor["kind"]))
                if record["kind"] != "report-file":
                    continue
                file = record["data"]
                expected = {"sha256": file["sha256"], "bytes": file["bytes"]}
                assert call("/api/v1/files/"+record["id"]+"/download?revision="+revision, download=True) == expected
                frozen["downloads"].append({"id": record["id"], **expected})

        live = root / "live"
        if not args.recover:
            exercise(live, import_and_read)
        def verify(call):
            assert call("/api/v1/manifest")["revision"] == frozen["revision"]
            assert call("/api/v1/results?revision=" + frozen["revision"] + "&limit=1") == frozen["page"]
            cursor = frozen["page"]["nextCursor"]
            assert call("/api/v1/results?limit=1&cursor=" + quote(cursor, safe=""))["revision"] == frozen["revision"]
            assert call("/api/v1/sessions/native-smoke?revision=" + frozen["revision"]) == frozen["session"]
            assert call("/api/v1/history?revision=" + frozen["revision"]) == frozen["history"]
            if "resultPages" in frozen:
                assert pages(call,"/api/v1/results?revision="+frozen["revision"]+"&limit=100") == frozen["resultPages"]
                assert pages(call,"/api/v1/history?revision="+frozen["revision"]+"&limit=100") == frozen["historyPages"]
            for file in frozen.get("downloads", []):
                assert call("/api/v1/files/"+file["id"]+"/download?revision="+frozen["revision"], download=True) == {"sha256":file["sha256"],"bytes":file["bytes"]}

        backup = args.recover / "backup" if args.recover else root / "backup"
        if not args.recover:
            exercise(live, verify)
            command("backup", "--data", live, "--output", backup)
        command("verify-backup", "--data", backup)
        for action in ["restore", "rebuild"]:
            destination = root / action
            command(action, "--data", backup, "--output", destination)
            exercise(destination, verify)
        if args.export:
            args.export.mkdir(mode=0o700, parents=True, exist_ok=False)
            shutil.copytree(backup, args.export / "backup")
            (args.export / "expected.json").write_bytes(encoded(frozen))
            command("verify-backup", "--data", args.export / "backup")
        checks = ["graceful-shutdown", "backup-verification", "restore", "db-free-rebuild", "frozen-values", "cursor-key"]
        if "resultPages" in frozen:
            checks += ["complete-paged-results", "complete-paged-history"]
        if frozen.get("downloads"):
            checks += ["original-file-hashes"]
        if not args.recover:
            checks = ["http-import", "idempotence", "restart", *checks]
        print(json.dumps({"status": "passed", "system": platform.system(), "machine": platform.machine(), "checks": checks, "mode": "recover" if args.recover else "collect", "evidence": frozen.get("evidenceKind", "synthetic"), "association": "synthetic session/job; no benchmark execution or operator qualification"}))


if __name__ == "__main__":
    main()
