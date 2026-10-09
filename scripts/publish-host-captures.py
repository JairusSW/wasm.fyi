"""Publish completed captures independently of the laptop; never launch benchmarks."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, required=True)
    parser.add_argument("--state", type=pathlib.Path, required=True)
    parser.add_argument("--hub")
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    ledger = args.state / "published.json"
    seen = set(json.loads(ledger.read_text()) if ledger.exists() else [])
    unchanged = {}
    token = os.environ["WASMFYI_ADMIN_TOKEN"]
    plan = json.loads((args.root / "release-five-20261008/source-plan.json").read_text())
    allowed = {
        (engine, pin["tag"] if pin.get("tag") else pin["revision"], pin["targetWeek"])
        for pin in plan["pins"] for engine in pin["configurations"]
    }
    hub = args.state / "hub"
    while True:
        if args.hub:
            hub.mkdir(exist_ok=True)
            ssh = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPersist=24h -o ControlPath=/tmp/wasmfyi-publisher-hub-%C"
            try:
                result = subprocess.run(
                    ["rsync", "-a", "--include=captures/", "--include=captures/*.json", "--exclude=*",
                     "-e", ssh, args.hub + ":/home/hub/.cache/wasm-fyi/release-five-20261008/", str(hub) + "/"],
                    capture_output=True, timeout=30,
                )
                if result.returncode:
                    print("Hub sync will retry:", result.stderr.decode()[-500:], flush=True)
            except (OSError, subprocess.TimeoutExpired) as error:
                print("Hub sync will retry:", str(error), flush=True)
        paths = list((args.root / "release-five-20261008/captures").glob("*.json"))
        paths += list((hub / "captures").glob("*.json"))
        for pattern in ("*/performance-*.json", "*/compile-*.json", "*/lifecycle-*.json"):
            paths += list((args.root / "features-seven-20261008").glob(pattern))
        for pattern in ("*/performance-*.json", "*/compile-*.json", "*/lifecycle-*.json"):
            paths += list((args.state / "hub-features").glob(pattern))
        published = 0
        for path in paths:
            try:
                before = path.stat()
                signature = (before.st_mtime_ns, before.st_size)
                if unchanged.get(str(path)) == signature:
                    continue
                body = path.read_bytes()
                if signature != (path.stat().st_mtime_ns, path.stat().st_size):
                    continue
                sha = hashlib.sha256(body).hexdigest()
                if sha in seen:
                    unchanged[str(path)] = signature
                    continue
                capture = json.loads(body)
                rows, source = capture.get("results", []), capture.get("source", {})
                ref = source.get("ref") if source.get("kind") == "release" else source.get("revision")
                if not rows or (rows[0]["engine"], ref, source.get("asOf")) not in allowed:
                    continue
                if any(row["engine"] in ("deno", "wasm2js", "wasm2rs") for row in rows):
                    continue
                # Main captures keep five samples. Feature captures keep five in
                # each of three independent launches, without replaying compatibility logs.
                expected = 15 if (args.root / "features-seven-20261008" in path.parents or args.state / "hub-features" in path.parents) else 5
                if any(row.get("latencyStatus") == "ok" and
                       (row.get("timingSamples") != expected or len(row.get("samplesNs", [])) != expected)
                       for row in rows):
                    raise ValueError("missing retained timing samples")
                request = urllib.request.Request(
                    "http://127.0.0.1:8090/api/captures", data=body, method="POST",
                    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request, timeout=15) as response:
                    receipt = json.load(response)
                    if response.status != 200 or len(receipt.get("id", "")) != 64:
                        raise ValueError("invalid durable publication receipt")
                seen.add(sha)
                unchanged[str(path)] = signature
                published += 1
                temporary = ledger.with_suffix(".tmp")
                temporary.write_text(json.dumps(sorted(seen)) + "\n")
                temporary.replace(ledger)
            except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
                print("Publication will retry:", path.name, str(error), flush=True)
        print(json.dumps({"published": published, "total": len(seen), "updated": time.time()}), flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
