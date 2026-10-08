#!/usr/bin/env python3
"""Apply verified SDK reuse while the existing collector stays alive."""
import pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1]).resolve();node=sys.argv[2]
script=pathlib.Path(__file__).with_name('reuse-active-history-sdks.mjs').resolve()
while True:
    commands=subprocess.check_output(['ps','-axo','args='],text=True)
    if not any('benchmark-history-coordinator.mjs' in line and str(root) in line for line in commands.splitlines()):break
    subprocess.run([node,str(script),str(root)],check=True)
    time.sleep(10)
