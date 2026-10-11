"""Single-sample corpus qualification via the embedding protocol; never publishes."""
import argparse
import hashlib
import json
import os
import pathlib
import selectors
import signal
import sys
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpora', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--engine', required=True)
    parser.add_argument('--backend', required=True)
    parser.add_argument('--timeout', type=float, default=300)
    parser.add_argument('--only')
    parser.add_argument('--time-budget', type=float, default=1800 if sys.platform == 'darwin' else float('inf'))
    parser.add_argument('--cpu', type=int)
    parser.add_argument('--retry-unsupported', action='store_true')
    parser.add_argument('--retry-failed', action='store_true')
    parser.add_argument('--persistent-adapter', action='store_true', help='reuse adapters that keep accepting requests after close; execution proof only')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('adapter command required')
    if args.cpu is not None:
        os.sched_setaffinity(0, {args.cpu})
    os.environ['GOMAXPROCS'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['RAYON_NUM_THREADS'] = '1'
    args.output.mkdir(parents=True, exist_ok=True)
    corpora = json.loads(args.corpora.read_text())
    process = None
    sequence = 0
    workload_deadline = None
    persistent_adapter = args.persistent_adapter
    stderr = (args.output / 'adapter-stderr.log').open('ab', buffering=0)
    records = []
    slice_deadline = time.monotonic() + args.time_budget

    def stop():
        nonlocal process
        if process is not None:
            # Reap an exited leader first: Darwin can return EPERM when
            # signalling a group whose final member is an unreaped corpse.
            process.poll()
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except PermissionError:
                if process.poll() is None:
                    raise
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
            # Also reap descendants when the adapter leader exited first.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except PermissionError:
                if process.poll() is None:
                    raise
            process.wait()
            process.stdout.close()
            process.stdin.close()
            process = None

    def interrupted(signum, frame):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)

    def request(method, **fields):
        nonlocal process, sequence
        if process is None:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=stderr, bufsize=0, env=os.environ.copy(), start_new_session=True)
        sequence += 1
        deadline = min(time.monotonic() + args.timeout, workload_deadline) if workload_deadline else time.monotonic() + args.timeout
        payload = memoryview((json.dumps({'version': 1, 'id': sequence, 'method': method, **fields}) + '\n').encode())
        os.set_blocking(process.stdin.fileno(), False)
        with selectors.DefaultSelector() as writer:
            writer.register(process.stdin, selectors.EVENT_WRITE)
            while payload:
                if not writer.select(max(0, deadline - time.monotonic())):
                    raise TimeoutError('adapter request write timeout')
                try:
                    size = os.write(process.stdin.fileno(), payload)
                    payload = payload[size:]
                except BlockingIOError:
                    pass
        data = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while b'\n' not in data:
                if not selector.select(max(0, deadline - time.monotonic())):
                    raise TimeoutError('adapter response timeout')
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError('adapter exited before a complete response')
                data.extend(chunk)
                if len(data) > 32 * 1024 * 1024:
                    raise RuntimeError('adapter response exceeds budget')
        response = json.loads(data)
        if response.get('version') != 1 or response.get('id') != sequence:
            raise RuntimeError('adapter protocol identity mismatch')
        return response

    def checkpoint():
        result = {'engine': args.engine, 'backend': args.backend, 'policy': {'samples': 1, 'operations': 1, 'warmup': 0, 'adapterProcessReuse': persistent_adapter},
                  'updated': time.time(), 'results': records}
        result['sets'] = {}
        for name, _ in corpora.items():
            selected = [r for r in records if r['set'] == name]
            result['sets'][name] = {'completed': len(selected), 'expected': len(corpora[name]),
                                   **{status: sum(r['status'] == status for r in selected) for status in ['ok', 'unsupported', 'failed']}}
        temporary = args.output / 'report.tmp'
        temporary.write_text(json.dumps(result, indent=2) + '\n')
        temporary.replace(args.output / 'report.json')

    try:
        description = request('describe')
        if description.get('status') != 'ok':
            raise RuntimeError('adapter description unavailable: ' + str(description))
        description = description['description']
        persistent_adapter = persistent_adapter or description.get('qualification_persistent_close') is True
        if description.get('runtime') != args.engine or description.get('backend') != args.backend:
            raise RuntimeError('measured engine/backend differs from qualification target: ' + str(description))
        (args.output / 'description.json').write_text(json.dumps(description, indent=2) + '\n')
        for set_name, workloads in corpora.items():
            for original in workloads:
                if args.only and args.only not in original['id']:
                    continue
                workload = json.loads(json.dumps(original))
                workload['args'] = [str(n) for n in workload.get('args', [])]
                workload['oracle']['expected'] = [str(n) for n in workload['oracle'].get('expected', [])]
                path = pathlib.Path(workload['artifact'])
                if hashlib.sha256(path.read_bytes()).hexdigest() != workload['sha256']:
                    raise RuntimeError('artifact hash mismatch: ' + workload['id'])
                identity = hashlib.sha256(json.dumps([set_name, workload], sort_keys=True).encode()).hexdigest()
                file = args.output / (identity + '.json')
                if file.exists():
                    previous = json.loads(file.read_text())
                    if previous['status'] == 'ok' or previous['status'] == 'unsupported' and not args.retry_unsupported or previous['status'] == 'failed' and not args.retry_failed:
                        records.append(previous)
                        continue
                if time.monotonic() >= slice_deadline:
                    checkpoint()
                    return 76
                row = {'set': set_name, 'workload': workload['id'], 'artifactSha256': workload['sha256'], 'phases': [], 'status': 'failed'}
                workload_deadline = time.monotonic() + min(args.timeout, 300)
                try:
                    prepared = request('prepare', prepare={'artifact': str(path), 'artifact_sha256': workload['sha256'],
                                                           'workload': workload, 'profile': 'timing'})
                    if prepared.get('status') != 'ok':
                        row.update(status='unsupported' if prepared.get('status') == 'unsupported' else 'failed', reason=prepared.get('reason', 'prepare failed'))
                    else:
                        phases = ['compile'] if workload['oracle']['kind'] == 'component_compile_only' or set_name == 'compile' and workload.get('provenance', {}).get('scope') != 'compile-and-instantiate' else ['compile', 'instantiate', 'first-call', 'steady']
                        row['status'] = 'ok'
                        for phase in phases:
                            response = request('run', run={'scenario': phase, 'samples': 1, 'operations': 1, 'warmup': 0})
                            if response.get('status') == 'ok':
                                samples = response.get('samples', [])
                                if len(samples) != 1 or not samples[0].get('verified') or samples[0].get('warmup') or samples[0].get('operations') != 1:
                                    raise RuntimeError('missing single verified execution sample')
                                if [str(n) for n in samples[0].get('result', [])] != workload['oracle']['expected']:
                                    raise RuntimeError('independent scalar oracle mismatch')
                                row['phases'].append({'phase': phase, 'status': 'ok'})
                            else:
                                status = 'unsupported' if response.get('status') == 'unsupported' else 'failed'
                                row['phases'].append({'phase': phase, 'status': status, 'reason': response.get('reason', 'run failed')})
                                row.update(status=status, reason=response.get('reason', 'run failed'))
                                break
                    closed = request('close')
                    if closed.get('status') != 'ok':
                        raise RuntimeError('adapter did not close the workload cleanly')
                    if not persistent_adapter or row['status'] == 'failed':
                        stop()
                except Exception as error:
                    row.update(status='failed', reason=str(error))
                    stop()
                file.write_text(json.dumps(row, indent=2) + '\n')
                records.append(row)
                checkpoint()
                print(json.dumps({'engine': args.engine, 'set': set_name, 'workload': row['workload'], 'status': row['status'], 'reason': row.get('reason')}), flush=True)
        checkpoint()
    finally:
        stop()
        stderr.close()


if __name__ == '__main__':
    sys.exit(main())
