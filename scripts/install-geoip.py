#!/usr/bin/env python3
"""Install official DB-IP Lite MMDBs atomically; no visitor IP leaves the server."""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import sys


def install(directory, month):
    datetime.datetime.strptime(month, "%Y-%m")
    directory = Path(directory)
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise ValueError("GeoIP directory must not be a symlink")
    receipt = directory / "dbip-receipt.json"
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    files = {}
    for kind, limit in [("city", 512 * 1024 * 1024), ("asn", 64 * 1024 * 1024)]:
        destination = directory / f"dbip-{kind}-lite.mmdb"
        if destination.is_symlink():
            raise ValueError("GeoIP database must not be a symlink")
        old = previous.get("files", {}).get(kind, {})
        if previous.get("month") == month and destination.is_file():
            if hashlib.sha256(destination.read_bytes()).hexdigest() == old.get("sha256"):
                files[kind] = old
                continue
        url = f"https://download.db-ip.com/free/dbip-{kind}-lite-{month}.mmdb.gz"
        compressed = tempfile.NamedTemporaryFile(dir=directory, delete=False)
        unpacked = tempfile.NamedTemporaryFile(dir=directory, delete=False)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "wasm.fyi GeoIP installer"})
            with urllib.request.urlopen(request, timeout=60) as response:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise ValueError("Compressed GeoIP database exceeds size limit")
                    compressed.write(chunk)
            compressed.close()
            digest, size = hashlib.sha256(), 0
            with gzip.open(compressed.name, "rb") as source:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("GeoIP database exceeds size limit")
                    digest.update(chunk)
                    unpacked.write(chunk)
            unpacked.flush()
            os.fsync(unpacked.fileno())
            unpacked.close()
            with open(unpacked.name, "rb") as source:
                source.seek(max(0, size - 131072))
                if b"\xab\xcd\xefMaxMind.com" not in source.read():
                    raise ValueError("Downloaded file lacks MMDB metadata")
            os.chmod(unpacked.name, 0o644)
            os.replace(unpacked.name, destination)
            files[kind] = {"url": url, "sha256": digest.hexdigest(), "bytes": size}
        finally:
            compressed.close()
            unpacked.close()
            for name in [compressed.name, unpacked.name]:
                Path(name).unlink(missing_ok=True)
    result = {"provider": "DB-IP Lite", "month": month, "license": "CC BY 4.0",
              "attribution": "https://db-ip.com", "files": files}
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as target:
        json.dump(result, target, indent=2)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    os.chmod(target.name, 0o644)
    os.replace(target.name, receipt)
    print(json.dumps(result))


if __name__ == "__main__":
    install(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else datetime.date.today().strftime("%Y-%m"))
