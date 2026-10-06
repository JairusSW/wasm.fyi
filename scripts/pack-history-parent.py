"""Deterministic representation of verified historical tool bytes; never execute them."""
import argparse
import gzip
import json
from pathlib import Path
import sys
import tarfile
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("--describe", action="store_true")
parser.add_argument("--source")
parser.add_argument("--output")
args = parser.parse_args()
if args.describe:
    if args.source or args.output:
        parser.error("description accepts no source or output")
    print(json.dumps({"format": "source-tools-tar-gzip-v1", "python": sys.version.split()[0],
                      "zlib": zlib.ZLIB_RUNTIME_VERSION, "permissions": "directories-and-tool-files-0755-metadata-0644",
                      "timestamps": "zero", "owners": "zero"}, separators=(",", ":")))
    raise SystemExit(0)
if not args.source or not args.output:
    parser.error("source and output required")
root = Path(args.source)
files = [root / "metadata.json"] + sorted((root / "tools").rglob("*"), key=lambda p: p.relative_to(root).as_posix())
if len(files) > 100000:
    raise ValueError("historical parent file inventory exceeds ceiling")
with open(args.output, "xb") as target, gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as compressed:
    with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
        # Include only regular files and their required directories. Empty
        # incidental directories and filesystem mtimes do not alter identity.
        emitted = set()
        for path in files:
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError("historical parent contains nonregular source")
            if path.is_dir():
                continue
            relative = path.relative_to(root).as_posix()
            parents = list(Path(relative).parents)[:-1]
            for parent in reversed(parents):
                name = parent.as_posix()
                if name not in emitted:
                    info = tarfile.TarInfo(name)
                    info.type, info.mode = tarfile.DIRTYPE, 0o755
                    archive.addfile(info)
                    emitted.add(name)
            info = tarfile.TarInfo(relative)
            info.size = path.stat().st_size
            info.mode = 0o644 if relative == "metadata.json" else 0o755
            with path.open("rb") as source:
                archive.addfile(info, source)
