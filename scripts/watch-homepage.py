#!/usr/bin/env python3
"""Refresh static homepage files after any benchmark publication, off HTTP paths."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request


def revision(api):
    with urllib.request.urlopen(api.rstrip('/') + '/api/summary', timeout=10) as response:
        return json.load(response)['revision']


def needs_bake(frontend, current_revision):
    try:
        return json.loads((frontend / 'homepage-revision.json').read_text())['revision'] != current_revision
    except (OSError, ValueError, KeyError):
        return True


def refresh(args):
    frontend = args.current.resolve(strict=True) / 'frontend'
    if not (frontend / '.homepage-baker.mjs').is_file():
        return False
    if not needs_bake(frontend, revision(args.api)):
        return False
    # Do not hold the deployment lock while waiting for a measurement batch.
    if not args.locked and args.benchmark_lock.is_file():
        subprocess.run([sys.executable, str(args.benchmark_lock), '--wait', '--owner',
                        'wasmfyi: static homepage publication', '--', sys.executable,
                        __file__, '--locked', '--current', str(args.current), '--api', args.api,
                        '--node', args.node, '--deployment-lock', str(args.deployment_lock)], check=True)
        return True
    with args.deployment_lock.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False  # Deployment wins; the next timer checks the new release.
        frontend = args.current.resolve(strict=True) / 'frontend'
        if not needs_bake(frontend, revision(args.api)):
            return False
        subprocess.run([args.node, str(frontend / '.homepage-baker.mjs'), str(frontend)],
                       env={**os.environ, 'WASMFYI_PRERENDER_API_ORIGIN': args.api},
                       timeout=180, check=True)
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current', type=Path, default=Path('/opt/wasmfyi/current'))
    parser.add_argument('--api', default='http://127.0.0.1:8090')
    parser.add_argument('--node', default='/usr/local/lib/wasmfyi-node')
    parser.add_argument('--deployment-lock', type=Path, default=Path('/run/lock/wasmfyi-deployment.lock'))
    parser.add_argument('--benchmark-lock', type=Path, default=Path('/root/benchmark-lock.py'))
    parser.add_argument('--locked', action='store_true')
    refresh(parser.parse_args())


if __name__ == '__main__':
    main()
