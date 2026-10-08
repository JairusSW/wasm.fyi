#!/usr/bin/env python3
"""Bound intermediate-file growth while the historical coordinator is alive."""
import pathlib, subprocess, sys, time

root = pathlib.Path(sys.argv[1]).resolve()
node = sys.argv[2]
script = pathlib.Path(__file__).with_name('prune-history-builds.mjs').resolve()
while True:
    commands = subprocess.check_output(['ps', '-axo', 'args='], text=True)
    if not any('benchmark-history-coordinator.mjs' in line and str(root) in line for line in commands.splitlines()):
        break
    subprocess.run([node, str(script), str(root)], check=True)
    time.sleep(300)
