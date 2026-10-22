"""Publish completed captures independently of the laptop; never launch benchmarks."""
import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import signal
import subprocess
import time
import urllib.error
import urllib.request


def snapshot_allowed(source, before):
    """Keep weekly aliases by their snapshot date, regardless of source revision reuse."""
    return not before or source.get("asOf", "")[:10] < before


def run_sync(command, timeout=30, capture_output=True):
    """Bound the transfer and reap its SSH child when it times out."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE if capture_output else subprocess.DEVNULL,
                               stderr=subprocess.PIPE if capture_output else subprocess.DEVNULL,
                               start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command, process.returncode, stdout or b"", stderr or b"")
    except subprocess.TimeoutExpired:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            process.poll()
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                if process.poll() is None:
                    raise
            if sig == signal.SIGTERM:
                time.sleep(0.1)
        try:
            process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            # A detached descendant can still hold a captured pipe after the
            # original group has died. Closing our readers must also be bounded.
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
            process.wait(timeout=2)
        raise



def ssh_processes_in_service():
    """Only our systemd cgroup can contain masters deliberately created here."""
    try:
        group = pathlib.Path("/proc/self/cgroup").read_text()
    except OSError:
        return set()
    matches = set()
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = (entry / "cmdline").read_bytes().split(b"\0")
            if argv[0].split(b"/")[-1].startswith(b"ssh") and (entry / "cgroup").read_text() == group:
                matches.add(int(entry.name))
        except OSError:
            pass
    return matches


def ensure_ssh_master(host, control_path, state):
    """Create one deliberate service-owned master, separate from bounded transfers."""
    common = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
              "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
              "-o", "StrictHostKeyChecking=accept-new", "-o", "ControlPath=" + control_path]
    check_command = ["ssh", *common, "-O", "check", host]
    checked = run_sync(check_command, timeout=10)
    created = False
    if checked.returncode:
        before = ssh_processes_in_service()
        try:
            try:
                started = run_sync(["ssh", "-Nf", *common, "-o", "ControlMaster=yes",
                                    "-o", "ControlPersist=24h", host], timeout=20, capture_output=False)
                if started.returncode:
                    raise RuntimeError("SSH master startup failed: " + started.stderr.decode()[-500:])
            except subprocess.TimeoutExpired:
                # A master may have authenticated just before the deadline.
                checked = run_sync(check_command, timeout=10)
                if checked.returncode:
                    raise
            checked = run_sync(check_command, timeout=10)
            if checked.returncode or not re.search(rb"pid=(\d+)", checked.stderr + checked.stdout):
                raise RuntimeError("SSH master verification failed: " + checked.stderr.decode()[-500:])
            created = True
        except Exception:
            # Do not leave a newly forked, unverified connection behind. Match
            # exact new PIDs in our service cgroup; never terminate old masters.
            for pid in ssh_processes_in_service() - before:
                if pid in ssh_processes_in_service():
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            raise
    match = re.search(rb"pid=(\d+)", checked.stderr + checked.stdout)
    if checked.returncode or not match:
        raise RuntimeError("SSH master verification failed: " + checked.stderr.decode()[-500:])
    pid = int(match.group(1))
    os.kill(pid, 0)
    previous_path = state / "ssh-master.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    try:
        cgroup = pathlib.Path("/proc", str(pid), "cgroup").read_text().strip()
    except OSError:
        cgroup = None
    record = {"host": host, "controlPath": control_path, "pid": pid,
              "intentionalPersistentConnection": True, "controlPersist": "24h",
              "cgroup": cgroup, "checkedAt": time.time(),
              "createdAt": previous.get("createdAt", time.time()) if previous.get("pid") == pid else time.time()}
    temporary = previous_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(record, indent=2) + "\n")
    temporary.replace(previous_path)
    if created:
        print(json.dumps({"event": "ssh-master-created", "host": host, "pid": pid}), flush=True)
    return pid


def valid_sample_count(row, expected, adaptive=None, retain_recorded=False):
    n = row.get("timingSamples")
    samples = row.get("samplesNs", [])
    if (not isinstance(n, int) or isinstance(n, bool) or not isinstance(samples, list)
            or len(samples) != n or any(not isinstance(v, (int, float)) or isinstance(v, bool)
                                      or not math.isfinite(v) or v < 0 for v in samples)):
        return False
    if row.get("sampling", {}).get("method") == "feature-compatibility-v1":
        policy = row["sampling"]
        return (str(row.get("workload", "")).startswith("features/")
                and n == 1 and policy.get("groupSize") == 1
                and policy.get("maxSamples") == 1 and policy.get("warmup") == 0
                and policy.get("retainedStart") == 0
                and policy.get("stopReason") == "fixed-sample")
    if row.get("sampling", {}).get("method") == "same-process-stability-v1":
        policy = row["sampling"]
        cap = policy.get("maxSamples")
        phase_cap = 10 if row.get("phase") in ("compile", "instantiate") else 25
        return (isinstance(cap, int) and not isinstance(cap, bool)
                and cap in (phase_cap, 35) and row.get("phase") in ("compile", "instantiate", "first-call", "steady")
                and 5 <= n <= cap and n % 5 == 0
                and policy.get("groupSize") == 5 and policy.get("warmup") == 0)
    if retain_recorded:
        # Older DB captures keep their original vector count and absent policy;
        # never manufacture current adaptive metadata or admit correctness probes.
        return (not row.get("sampling") and 0 < n <= 4096
                and not str(row.get("workload", "")).startswith("features/"))
    if adaptive is True or isinstance(adaptive, dict) and adaptive.get("maxSamples") in (10, 25, 35):
        return False
    if adaptive:
        return adaptive.get("minLaunches", 3) * 5 <= n <= adaptive.get("maxLaunches", 10) * 5 and n % 5 == 0
    return n == expected


def publication_ledger(path):
    seen = set(json.loads(path.read_text()) if path.exists() else [])
    journal = path.with_suffix(".journal")
    if journal.exists():
        for entry in journal.read_bytes().splitlines():
            if re.fullmatch(rb"[a-f0-9]{64}", entry):
                seen.add(entry.decode("ascii"))
    return seen


def remember_publication(path, digest):
    """Persist one receipt with a constant-size write, before acknowledging it."""
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("invalid publication digest")
    journal = path.with_suffix(".journal")
    created = not journal.exists()
    prefix = b""
    if journal.exists() and journal.stat().st_size:
        with journal.open("rb") as previous:
            previous.seek(-1, os.SEEK_END)
            if previous.read(1) != b"\n":
                prefix = b"\n"
    with journal.open("ab") as stream:
        stream.write(prefix + (digest + "\n").encode("ascii"))
        stream.flush()
        os.fsync(stream.fileno())
    if created:
        descriptor = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def compact_publication_ledger(path, seen):
    """One atomic snapshot per batch; the journal survives until it is durable."""
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as stream:
        json.dump(sorted(seen), stream, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    descriptor = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    with path.with_suffix(".journal").open("wb") as stream:
        stream.flush()
        os.fsync(stream.fileno())


def source_pin_allowlist(*plans):
    """Combine explicit publication pins without changing a running collection plan."""
    return {
        (engine, pin["tag"] if pin.get("tag") else pin["revision"], pin["targetWeek"])
        for plan in plans for pin in plan["pins"]
        if pin.get("revision") and pin.get("status") in ("planned", "reused", None)
        for engine in pin["configurations"]
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, required=True)
    parser.add_argument("--state", type=pathlib.Path, required=True)
    parser.add_argument("--hub")
    parser.add_argument("--api-url", default="http://127.0.0.1:8090")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--campaign", default="release-five-20261008")
    parser.add_argument("--capture-directory", action="append", type=pathlib.Path, default=[],
                        help="additional synced capture directory; may be repeated")
    parser.add_argument("--capture-glob", default="*.json", help="capture filename filter before reading bodies")
    parser.add_argument("--extra-source-plan", action="append", type=pathlib.Path, default=[],
                        help="additional explicit publication pins; collection plan stays frozen")
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    ledger = args.state / "published.json"
    seen = publication_ledger(ledger)
    unchanged = {}
    token = os.environ["WASMFYI_ADMIN_TOKEN"]
    snapshot_before = os.environ.get("WASMFYI_SNAPSHOT_BEFORE", "")
    if snapshot_before:
        datetime.date.fromisoformat(snapshot_before)
    if pathlib.Path(args.campaign).name != args.campaign or args.campaign in (".", ".."):
        parser.error("campaign must be a directory name")
    campaign = args.root / args.campaign
    plan = json.loads((campaign / "source-plan.json").read_text())
    template_path = campaign / "collection-template.json"
    collection = json.loads(template_path.read_text()).get("collection", {}) if template_path.exists() else {}
    adaptive = collection.get("adaptiveSampling")
    retain_recorded = collection.get("retainRecordedSamples") is True
    allowed = source_pin_allowlist(plan, *(json.loads(path.read_text()) for path in args.extra_source_plan))
    hub = args.state / "hub"
    while True:
        if args.hub:
            hub.mkdir(exist_ok=True)
            ssh = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new -o ControlMaster=no -o ControlPath=/tmp/wasmfyi-publisher-hub-%C"
            try:
                ensure_ssh_master(args.hub, "/tmp/wasmfyi-publisher-hub-%C", args.state)
                result = run_sync(
                    ["rsync", "-a", "--include=captures/", "--include=captures/*.json", "--exclude=*",
                     "-e", ssh, args.hub + ":/home/hub/.cache/wasm-fyi/" + args.campaign + "/", str(hub) + "/"],
                    timeout=30,
                )
                if result.returncode:
                    print("Hub sync will retry:", result.stderr.decode()[-500:], flush=True)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                print("Hub sync will retry:", str(error), flush=True)
        paths = list((campaign / "captures").glob(args.capture_glob))
        paths += list((hub / "captures").glob(args.capture_glob))
        for directory in args.capture_directory:
            paths += list(directory.glob(args.capture_glob))
        for pattern in (() if args.campaign != "release-five-20261008" else ("*/performance-*.json", "*/compile-*.json", "*/lifecycle-*.json")):
            paths += list((args.root / "features-seven-20261008").glob(pattern))
        for pattern in (() if args.campaign != "release-five-20261008" else ("*/performance-*.json", "*/compile-*.json", "*/lifecycle-*.json")):
            paths += list((args.state / "hub-features").glob(pattern))
        published = 0
        for path in paths:
            try:
                before = path.stat()
                signature = (before.st_mtime_ns, before.st_size)
                if unchanged.get(str(path)) == signature:
                    continue
                if before.st_size == 0:
                    # Synced placeholders are not captures or publication receipts.
                    # Reconsider them as soon as a writer replaces or fills them.
                    print("Awaiting nonempty capture:", path.name, flush=True)
                    unchanged[str(path)] = signature
                    continue
                body = path.read_bytes()
                if signature != (path.stat().st_mtime_ns, path.stat().st_size):
                    continue
                capture = json.loads(body)
                # Early feature workers emitted a redundant transport marker.
                # Keep their original files; the row policy carries the durable
                # compatibility identity accepted by the strict capture API.
                if capture.get("featureCompatibility") is True and capture.get("results") and all(
                        str(row.get("workload", "")).startswith("features/") for row in capture["results"]):
                    capture.pop("featureCompatibility")
                    body = json.dumps(capture, separators=(",", ":")).encode()
                sha = hashlib.sha256(body).hexdigest()
                if sha in seen:
                    unchanged[str(path)] = signature
                    continue
                rows, source = capture.get("results", []), capture.get("source", {})
                if not snapshot_allowed(source, snapshot_before):
                    unchanged[str(path)] = signature
                    continue
                ref = source.get("ref") if source.get("kind") == "release" else source.get("revision")
                if not rows or (rows[0]["engine"], ref, source.get("asOf")) not in allowed:
                    # Plans stay fixed for this process. An excluded immutable
                    # capture needs no more JSON reads until its file changes.
                    unchanged[str(path)] = signature
                    continue
                if any(row["engine"] in ("deno", "wasm2js", "wasm2rs") for row in rows):
                    continue
                # Frozen fixed-sample plans retain their recipe. New adaptive
                # main runs retain ordered same-process groups under their declared phase cap.
                expected = 15 if (args.root / "features-seven-20261008" in path.parents or args.state / "hub-features" in path.parents) else 5
                recorded = (retain_recorded and source.get("kind") in ("release", "snapshot")
                            and bool(re.fullmatch(r"[a-f0-9]{40}", source.get("revision", ""))))
                if any(row.get("latencyStatus") == "ok" and
                       not valid_sample_count(row, expected, adaptive if expected == 5 else None, recorded)
                       for row in rows):
                    raise ValueError("missing retained timing samples")
                request = urllib.request.Request(
                    args.api_url.rstrip("/") + "/api/captures", data=body, method="POST",
                    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "X-Real-IP": "127.0.0.1"},
                )
                with urllib.request.urlopen(request, timeout=15) as response:
                    receipt = json.load(response)
                    if response.status != 200 or len(receipt.get("id", "")) != 64:
                        raise ValueError("invalid durable publication receipt")
                remember_publication(ledger, sha)
                seen.add(sha)
                unchanged[str(path)] = signature
                published += 1
                # Leave room in the authenticated write budget for other hosts.
                time.sleep(0.02)

            except urllib.error.HTTPError as error:
                print("Publication will retry:", path.name, str(error), flush=True)
                if error.code == 429:
                    try:
                        retry = float(error.headers.get("Retry-After", "1"))
                    except (ValueError, TypeError):
                        retry = 1
                    time.sleep(max(1, min(30, retry)))
            except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
                print("Publication will retry:", path.name, str(error), flush=True)
        if published:
            compact_publication_ledger(ledger, seen)
        print(json.dumps({"published": published, "total": len(seen), "updated": time.time()}), flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
