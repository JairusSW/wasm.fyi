"""Wizard linked-module execution proof; no phase timing is published."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from driver import build_driver, inspect

binary, backend = sys.argv[1:3]
mode = {'v3-interpreter': 'v3-int', 'fast-interpreter': 'int', 'spc': 'spc'}[backend]
runtime = {'v3-interpreter': 'wizard-v3-int', 'fast-interpreter': 'wizard-fast-int', 'spc': 'wizard-spc'}[backend]
feature_flags = {
    'v3-interpreter': ['--ext:custom-page-sizes', '--ext:legacy-eh', '--ext:stack-switching', '--ext:threads', '--ext:wide-arithmetic'],
    'fast-interpreter': ['--ext:legacy-eh', '--ext:stack-switching', '--ext:threads', '--ext:wide-arithmetic'],
    'spc': ['--ext:legacy-eh', '--ext:stack-switching', '--ext:wide-arithmetic'],
}[backend]
prepared = directory = driver = expected_words = result_types = None


def close():
    global directory, prepared
    if directory: directory.cleanup()
    directory = prepared = None


for line in sys.stdin:
    request = json.loads(line)
    response = {'version': 1, 'id': request['id']}
    try:
        method = request['method']
        if method == 'describe':
            response['description'] = {'runtime': runtime, 'runtime_version': '399357ce20b8330ddc1888a93cceb0d4cf3762de', 'backend': backend, 'embedding': 'Wizard linker with native Virgil host callbacks', 'abis': ['core'], 'scenarios': ['compile', 'instantiate', 'first-call', 'steady'], 'effective_configuration': {'purpose': 'single-sample execution proof; linked oracle driver adds overhead, never used for phase latency', 'artifact': 'original corpus module is unchanged; typed numeric and memory values forwarded to independent host oracle', 'mode': mode}}
        elif method == 'prepare':
            close(); prepared = request['prepare']; w = prepared['workload']
            if prepared['profile'] != 'timing' or w['abi'] != 'core': raise ValueError('unsupported: core timing qualification required')
            if w.get('host_profile', '') not in ['', 'identity-v1', 'assemblyscript-abort-v1', 'threads-defined-v1']: raise ValueError('unsupported: host import profile')
            if w['oracle']['kind'] not in ['exact_u64', 'exact_vectors']: raise ValueError('unsupported: oracle contract')
            artifact = Path(prepared['artifact']); data = artifact.read_bytes()
            if hashlib.sha256(data).hexdigest() != prepared['artifact_sha256']: raise ValueError('artifact hash mismatch')
            directory = tempfile.TemporaryDirectory(prefix='wizard-proof-')
            driver = Path(directory.name) / 'qualification.wasm'
            compiled, expected_words = build_driver(data, w, artifact.stem)
            driver.write_bytes(compiled)
            types, functions, _, exports = inspect(data)
            result_types = types[functions[exports[w['export']][1]]][1]
        elif method == 'run':
            run = request['run']; w = prepared['workload']
            if (run['samples'], run['operations'], run['warmup']) != (1, 1, 0): raise ValueError('single-sample qualification only')
            started = time.monotonic_ns()
            process = subprocess.run([binary, '--mode=' + mode, *feature_flags, '--invoke=qualification', prepared['artifact'], str(driver)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=290)
            output = process.stdout.decode(errors='replace')
            if process.returncode != 0: raise RuntimeError('Wizard execution failed: ' + (process.stderr.decode(errors='replace') + output)[-1800:])
            if 'WIZARD_QUALIFIED' not in output.splitlines(): raise RuntimeError('Wizard omitted verified execution marker')
            words = [int(line.split()[1]) & 0xffffffff for line in output.splitlines() if line.startswith('WIZARD_WORD ')]
            if words != expected_words: raise RuntimeError('independent scalar/memory oracle mismatch')
            result, offset = [], 0
            if w['oracle']['kind'] == 'exact_u64':
                for kind in reversed(result_types):
                    value = words[offset]; offset += 1
                    if kind in [b'\x7e', b'\x7c']: value |= words[offset] << 32; offset += 1
                    result.insert(0, str(value))
            response['samples'] = [{'index': 0, 'warmup': False, 'verified': True, 'operations': 1, 'elapsed_ns': time.monotonic_ns() - started, 'result': result, 'sample_type': 'individual_operation'}]
        elif method == 'close': close()
        else: raise ValueError('unsupported: method')
        response['status'] = 'ok'
    except Exception as error:
        response.update(status='unsupported' if str(error).startswith('unsupported:') else 'error', reason=str(error))
    print(json.dumps(response), flush=True)
