#!/usr/bin/env python3
"""Repair cached Wasmtime 24 bindings without changing a live coordinator's state."""
import json
import pathlib
import subprocess
import sys
import time

root = pathlib.Path(sys.argv[1]).resolve()
node = sys.argv[2]
script = pathlib.Path(__file__).with_name('repair-history-release.mjs').resolve()
while True:
    processes = subprocess.check_output(['ps', '-axo', 'args='], text=True).splitlines()
    live = any('benchmark-history-coordinator.mjs' in p and str(root) in p for p in processes)
    status_file = root / 'wasmtime-history-status.json'
    if status_file.exists():
        status = json.loads(status_file.read_text())
        tags = sorted({e.get('ref', '') for e in status.get('errors', [])
                       if e.get('ref', '').startswith('v24.0.')})
        for tag in tags:
            repair = root / 'repairs' / ('wasmtime-' + tag)
            if (repair / 'completion.json').exists():
                continue
            if any('repair-history-release.mjs' in p and str(root) in p and tag in p for p in processes):
                continue
            # A failed attempt is left for diagnosis; never spin on build failures.
            attempt = repair / 'watcher-attempt.json'
            if attempt.exists():
                continue
            repair.mkdir(parents=True, exist_ok=True)
            attempt.write_text(json.dumps({'tag': tag, 'status': 'running'}) + '\n')
            with (repair / 'watcher.log').open('a') as log:
                result = subprocess.run([node, str(script), str(root), 'wasmtime', tag],
                                        cwd=script.parent.parent, stdout=log, stderr=log)
            attempt.write_text(json.dumps({'tag': tag, 'exitCode': result.returncode,
                                          'status': 'completed' if result.returncode == 0 else 'failed'}) + '\n')
    if not live:
        break
    time.sleep(30)
