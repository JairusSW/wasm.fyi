"""Mirror small campaign status/skip notes without scanning SDK build trees."""
import argparse
import importlib.util
import json
import pathlib
import re
import shlex
import subprocess
import time

spec = importlib.util.spec_from_file_location(
    "capture_publisher", pathlib.Path(__file__).with_name("publish-host-captures.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def transfers(campaign, source):
    name, remote = source.split("=", 1)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
        raise ValueError("Invalid machine name")
    host, directory = remote.split(":", 1)
    if not directory.startswith("/") or host.startswith("-"):
        raise ValueError("Expected host:/absolute/campaign")
    mirror = campaign / "machines" / name
    ssh = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o ControlMaster=no -o ControlPath=" + shlex.quote("/tmp/wasmfyi-" + name + "-%C")
    commands = []
    for subdirectory in ("status", "failure-notes"):
        destination = mirror / subdirectory
        destination.mkdir(parents=True, exist_ok=True)
        filters = ["--include=*.json", "--exclude=*"]
        origin = directory.rstrip("/") + ("/failure-notes/" if subdirectory == "failure-notes" else "/")
        commands.append((name, subdirectory, ["rsync", "-a", *filters, "-e", ssh,
                                              host + ":" + origin, str(destination) + "/"]))
    return commands


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign-directory", type=pathlib.Path, required=True)
    parser.add_argument("--source", action="append", required=True)
    parser.add_argument("--interval", type=float, default=0)
    args = parser.parse_args()
    while True:
        for source in args.source:
            for name, kind, command in transfers(args.campaign_directory, source):
                try:
                    result = publisher.run_sync(command, timeout=30)
                    print(json.dumps({"machine": name, "kind": kind, "exit": result.returncode,
                                      "stderr": result.stderr.decode(errors="replace")[-500:]}), flush=True)
                except (OSError, subprocess.TimeoutExpired) as error:
                    print(json.dumps({"machine": name, "kind": kind, "error": str(error)}), flush=True)
        if args.interval <= 0:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
