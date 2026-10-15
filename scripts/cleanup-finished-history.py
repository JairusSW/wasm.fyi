#!/usr/bin/env python3
"""Delete finished campaign SDKs/logs, under the builders' measurement lease.

Only planned source uses with durable completion AND published workload captures
qualify. Reused weeks need captures for aliasing, never their SDK, so raw captures
and all progress/error ledgers are retained. Unknown/incomplete SDKs fail closed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def clean_name(value):
    return re.sub(r'[^a-zA-Z0-9.-]', '_', value)


def build_paths(root, pin, config):
    engine, kind, ref = pin['engine'], pin['targetType'], pin.get('tag') or pin['revision']
    if engine in ('wago', 'wazero', 'wasm2go'):
        return [root / 'builds' / clean_name(engine + '-' + (pin.get('revision') or ref))]
    if engine == 'libwasm':
        return [root / 'libwasm-builds' / pin['revision'][:12]]
    backend = ('wizard-native' if engine == 'wizard' and config in ('wizard-fast-int', 'wizard-spc')
               else 'wasmtime' if engine == 'wasmtime'
               else 'wasmer-singlepass' if engine == 'wasmer' and config == 'wasmer-cranelift'
               else config)
    paths = [root / 'sdk-builds' / clean_name('-'.join((backend, kind, ref)))]
    if engine == 'wasmer' and config == 'wasmer-cranelift':
        paths.append(root / 'sdk-builds' / clean_name('-'.join((config, kind, ref))))
    return paths


def required_uses(root, plan, template):
    uses = {}
    boundary = template.get('historyNotBefore', '')
    for pin in plan['pins']:
        if pin.get('status') != 'planned' or pin['targetWeek'][:10] < boundary:
            continue
        for config in pin['configurations']:
            for path in build_paths(root, pin, config):
                uses.setdefault(path, []).append((pin, config))
    return uses


def completed_keys(root):
    paths = [root / 'build-status.json', root / 'libwasm-status.json', *root.glob('*-history-status.json')]
    return {row['pinKey'] for path in paths for row in (read_json(path, {}) or {}).get('completed', [])}


def pin_key(pin, config):
    backend = pin['engine'] if pin['engine'] in ('wago', 'wazero', 'wasm2go') else config
    return '|'.join((backend, pin['targetType'], pin.get('tag') or pin['revision'], pin['targetWeek']))


def published_workloads(root, ledger):
    seen = set(read_json(ledger, []))
    journal = ledger.with_suffix('.journal')
    if journal.exists():
        seen.update(journal.read_text().splitlines())
    workloads = {}
    for path in (root / 'captures').glob('*.json'):
        body = path.read_bytes()
        capture = json.loads(body)
        rows = capture.get('results', [])
        if capture.get('featureCompatibility') is True and rows and all(str(r.get('workload', '')).startswith('features/') for r in rows):
            capture.pop('featureCompatibility')
            body = json.dumps(capture, separators=(',', ':')).encode()
        if hashlib.sha256(body).hexdigest() not in seen:
            continue
        source = capture.get('source', {})
        for row in rows:
            key = (row.get('engine'), source.get('revision'), source.get('asOf'))
            workloads.setdefault(key, set()).add(row.get('workload'))
    return workloads


def finished(uses, completed, published, workloads):
    return all(pin_key(pin, config) in completed and workloads <= published.get(
        (config, pin.get('revision'), pin['targetWeek']), set()) for pin, config in uses)


def process_paths(root):
    """Open files, executables, cwd, and argv protect active users of any SDK/log."""
    paths = []
    for proc in Path('/proc').glob('[0-9]*'):
        if proc.name == str(os.getpid()):
            continue
        try:
            for token in (proc / 'cmdline').read_bytes().split(b'\0'):
                value = token.decode(errors='replace')
                if value.startswith('/'):
                    paths.append(Path(value).resolve())
            for link in [proc / 'cwd', proc / 'exe', *(proc / 'fd').iterdir()]:
                try:
                    paths.append(link.resolve(strict=True))
                except (FileNotFoundError, PermissionError, OSError):
                    pass
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    return paths


def safe_candidate(root, path, active):
    return (path.parent in [root / n for n in ('sdk-builds', 'builds', 'libwasm-builds')]
            and path.is_dir() and not path.is_symlink()
            and path.resolve() == path and not any(p == path or path in p.parents for p in active))


def sweep(root, ledger, apply=False):
    # Never reclaim a lock: the campaign's existing lock implementation owns
    # stale-owner recovery. Atomic mkdir is the only acquisition operation.
    lock = root / 'measurement-lock'
    try:
        lock.mkdir()
    except FileExistsError:
        return {'status': 'busy', 'removed': []}
    try:
        (lock / 'owner').write_text(str(os.getpid()))
        plan = read_json(root / 'source-plan.json')
        template = read_json(root / 'collection-template.json')
        completed = completed_keys(root)
        workloads = {w['id'] for w in template['workloads']}
        active = process_paths(root)
        current = read_json(root / 'coordinator-status.json', {})
        current_engine = current.get('current') if current.get('status') == 'running' else None
        current_configs = {config for pin in plan['pins'] if pin['engine'] == current_engine
                           for config in pin['configurations']}
        pending_features = set((read_json(root / 'feature-sdk-retention.json', {}) or {}).get(
            'pendingConfigurations', []))
        candidates = {path: uses for path, uses in required_uses(root, plan, template).items()
                      if safe_candidate(root, path, active)
                      and not any(pin['engine'] == current_engine for pin, _ in uses)
                      and not any(config in pending_features for _, config in uses)
                      and all(pin_key(pin, config) in completed for pin, config in uses)}
        published = published_workloads(root, ledger) if candidates else {}
        removed, eligible = [], []
        for path, uses in candidates.items():
            if any(pin['engine'] == current_engine for pin, _ in uses):
                continue  # Protect gaps between the current engine's locked commands.
            if not safe_candidate(root, path, active) or not finished(uses, completed, published, workloads):
                continue
            eligible.append(str(path))
            if apply:
                shutil.rmtree(path)
                removed.append(str(path))
        # Logs outside SDKs are discarded only once their engine has moved on.
        # Never follow directory symlinks or remove an open file.
        logs = list(root.glob('*.log'))
        for directory in (root / 'engine-builds').glob('*'):
            if directory.is_dir() and not directory.is_symlink():
                logs.extend(directory.rglob('*.log'))
        for path in logs:
            if path.is_symlink() or path.resolve() != path or path in active:
                continue
            if current_engine:
                if path.parent == root and (path.name.startswith(current_engine + '-') or path.name == 'build.log'):
                    continue
                if path.parent != root and any(path.relative_to(root / 'engine-builds').parts[0].startswith(c + '-')
                                               for c in current_configs):
                    continue
            eligible.append(str(path))
            if apply:
                path.unlink(missing_ok=True)
                removed.append(str(path))
        return {'status': 'complete', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'eligible': eligible, 'removed': removed}
    finally:
        if (lock / 'owner').read_text() == str(os.getpid()):
            shutil.rmtree(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    previous_status = None
    last_cleanup = None
    while True:
        try:
            result = sweep(root, args.ledger, args.apply)
            if result.get('removed') or not args.watch:
                print(json.dumps(result), flush=True)
        except Exception as error:
            result = {'status': 'error', 'error': str(error)}
            print(json.dumps(result), flush=True)
            if not args.watch:
                raise
        if args.apply and (result.get('status') != 'busy' or previous_status != 'busy'):
            # A small current receipt, never an accumulating log.
            if result.get('removed'):
                last_cleanup = {'at': result['at'], 'removed': result['removed']}
            if last_cleanup:
                result['lastCleanup'] = last_cleanup
            target = root / 'sdk-cleanup-status.json'
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(result) + '\n')
            temporary.replace(target)
        previous_status = result.get('status')
        if not args.watch:
            return
        time.sleep(0.5 if result.get('status') == 'busy' else 30)


if __name__ == '__main__':
    main()
