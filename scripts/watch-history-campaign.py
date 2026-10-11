#!/usr/bin/env python3
"""Durable Linux campaign watcher; never restart over a surviving worker/build."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen


def process_rows():
    rows = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            command = (entry / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            if stat[0] != 'Z' and command:
                rows.append((int(entry.name), int(stat[1]), command))
        except (OSError, IndexError):
            pass
    return rows


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


NETWORK_ERROR = re.compile(
    r'could not resolve (?:host|hostname)|temporary failure in name resolution|'
    r'failed to resolve (?:host|address)|EAI_AGAIN|ENOTFOUND|'
    r'network is unreachable|connection reset by peer|ECONNRESET|'
    r'failed to connect to (?:github\.com|index\.crates\.io|static\.crates\.io)|'
    r'RPC failed; curl (?:6|7|18|28|35|56)\b', re.I)


def retryable_network_errors(root):
    """Only unresolved pins in the configured history window may trigger retries."""
    boundary = read_json(root / 'collection-template.json').get('historyNotBefore', '')
    found = []
    paths = list(root.glob('*-history-status.json'))
    paths.extend([root / 'build-status.json', root / 'libwasm-status.json'])
    for path in paths:
        status = read_json(path)
        completed = {item.get('pinKey') for item in status.get('completed', []) if item.get('pinKey')}
        latest = {}
        for index, error in enumerate(status.get('errors', [])):
            latest[error.get('pinKey') or ('unkeyed', index)] = error
        for error in latest.values():
            key = error.get('pinKey')
            week = error.get('asOf') or (key.split('|')[-1] if key else '')
            if key in completed or (boundary and week and week[:10] < boundary):
                continue
            if NETWORK_ERROR.search(error.get('error', '')):
                found.append({'statusFile': path.name, **error})
    return found


def connectivity_verified():
    """Bounded HTTPS probes verify DNS and transport before restarting work."""
    try:
        for url in ['https://github.com/', 'https://index.crates.io/config.json']:
            with urlopen(Request(url, method='HEAD'), timeout=5) as response:
                if not 200 <= response.status < 400:
                    return False
        return True
    except (OSError, ValueError):
        return False


def progress_signature(root):
    paths = {root / name for name in ['build.log', 'coordinator.log', 'build-status.json', 'captures']}
    for pattern in ['*-history.log', '*-history-status.json',
                    'sdk-builds/*/*-build.log', 'builds/*/*-build.log', 'builds/*/build.log']:
        paths.update(root.glob(pattern))
    return tuple((str(path.relative_to(root)), path.stat().st_mtime_ns)
                 for path in sorted(paths) if path.exists())


def continuation_guard_state(root, processes, now=None):
    status = read_json(root / 'week-first-continuation-v5-status.json')
    if not status:
        return None
    pid = status.get('pid')
    expected = str(root / 'remote-week-first-continuation-v5.mjs')
    live = any(actual == pid and expected in command for actual, command in processes)
    stage = status.get('status')
    started = status.get('started')
    age = 0
    try:
        age = ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(started.replace('Z', '+00:00'))).total_seconds()
    except (TypeError, ValueError, AttributeError):
        pass
    terminal = stage in {'coordinator-terminal-awaiting-audit', 'coordinator-failed'} or str(stage).startswith('blocked-')
    expired = age >= 86400 and stage == 'waiting-latest-natural-boundary'
    needs_inspection = terminal or not live or expired
    return {'pid': pid, 'live': live, 'status': stage, 'queueAgeSeconds': round(age),
            'queueBudgetExpired': expired, 'needsInspection': needs_inspection,
            'action': 'inspect exact terminal/failure; preserve active jobs and canonical failure records' if needs_inspection else 'guard remains active'}


def small_continuation_state(root, processes, now=None):
    status = read_json(root / 'oct4-small-continuation-status.json')
    if not status:
        return None
    pid = status.get('pid')
    live = any(actual == pid and '/run/remote-oct4-small-continuation.mjs' in command
               for actual, command in processes)
    age = 0
    try:
        age = ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(
            status.get('startedAt', '').replace('Z', '+00:00'))).total_seconds()
    except (TypeError, ValueError, AttributeError):
        pass
    stage = status.get('status')
    expired = age >= 86400
    inspection = not live or expired or stage in {
        'capacity-needs-inspection', 'terminal-awaiting-oct4-audit'}
    return {'pid': pid, 'live': live, 'status': stage, 'engine': status.get('engine'),
            'queueAgeSeconds': round(age), 'queueBudgetExpired': expired,
            'needsInspection': inspection,
            'action': 'inspect durable unit and canonical errors; never replay good captures' if inspection else 'small-engine continuation active'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--node', required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    state_path = root / 'watcher-status.json'
    previous = read_json(state_path)
    restarts = previous.get('automaticRestarts', 0)
    network_restarts = previous.get('networkRestarts', 0)
    last_signature = None
    last_progress = time.monotonic()
    last_alias = 0
    known_descendants = set()
    while True:
        rows = process_rows()
        processes = [(pid, command) for pid, _, command in rows
                     if str(root) in command and pid != os.getpid()
                     and 'watch-history-campaign.py' not in command]
        campaign_pids = {pid for pid, _ in processes}
        while True:
            descendants = {pid for pid, parent, _ in rows if parent in campaign_pids}
            if descendants.issubset(campaign_pids):
                break
            campaign_pids.update(descendants)
        live_pids = {pid for pid, _, _ in rows}
        known_descendants.intersection_update(live_pids)
        known_descendants.update(campaign_pids)
        coordinators = [(pid, command) for pid, command in processes
                        if 'benchmark-history-coordinator.mjs' in command]
        active_jobs = [(pid, command) for pid, command in processes
                       if any(name in command for name in [
                           'benchmark-go-history.mjs', 'benchmark-engine-history.mjs',
                           'benchmark-libwasm-history.mjs', 'benchmark-history-worker.mjs',
                           'weekly-build.mjs', 'cargo ', 'rustc ', 'clang ', 'gcc ', 'go build'])]
        # Relative-path make/cargo children can survive their parent without the
        # campaign path in argv. Track descendants, and conservatively block a
        # restart over any compiler/build process whose ownership is uncertain.
        if not coordinators:
            for pid, _, command in rows:
                executable = Path(command.split(' ', 1)[0]).name
                if pid in known_descendants or executable in {
                    'make', 'ninja', 'cargo', 'rustc', 'clang', 'clang++', 'gcc',
                    'g++', 'cc1', 'cc1plus', 'javac', 'cmake'}:
                    if pid != os.getpid() and (pid, command) not in active_jobs:
                        active_jobs.append((pid, command))
        status = read_json(root / 'coordinator-status.json')
        signature = progress_signature(root)
        if signature != last_signature:
            last_progress = time.monotonic()
            last_signature = signature
        event = 'running' if coordinators else 'orphan-active' if active_jobs else 'terminal'
        network_errors = []
        idle = not coordinators and not active_jobs
        audit = status.get('status') == 'awaiting-completion-audit'
        network_ready = False
        if idle and audit and read_json(root / 'user-pause.json').get('status') != 'paused':
            network_errors = retryable_network_errors(root)
            if network_errors:
                event = 'network-retry-limit-needs-repair' if network_restarts >= 3 else 'waiting-for-connectivity'
                network_ready = network_restarts < 3 and connectivity_verified()
        if idle and read_json(root / 'user-pause.json').get('status') != 'paused' and (not audit or network_ready):
            if network_ready or restarts < 3:
                with (root / 'launcher.log').open('ab', buffering=0) as output:
                    child = subprocess.Popen([
                        args.node, str(root / 'site/scripts/benchmark-history-coordinator.mjs'),
                        str(root), str(root / 'frozen-harness')], cwd=root / 'site',
                        stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                        start_new_session=True,
                        preexec_fn=lambda: os.sched_setaffinity(0, range(os.cpu_count())))
                (root / 'coordinator.pid').write_text(str(child.pid) + '\n')
                if network_ready:
                    network_restarts += 1
                    event = 'restarted-network-failures'
                else:
                    restarts += 1
                    event = 'restarted-terminal-process'
            else:
                event = 'restart-limit-needs-repair'
        if time.monotonic() - last_alias > 300:
            try:
                alias_result = subprocess.run([args.node, str(root / 'site/scripts/link-history-aliases-when-idle.mjs'), str(root)],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
                if alias_result.returncode not in (0, 75):
                    print(json.dumps({'event':'alias-link-error', 'exitCode':alias_result.returncode}), flush=True)
            except (OSError, subprocess.TimeoutExpired) as error:
                print(json.dumps({'event':'alias-link-error', 'error':str(error)}), flush=True)
            last_alias = time.monotonic()
        guard = continuation_guard_state(root, processes)
        small_guard = small_continuation_state(root, [(pid, command) for pid, _, command in rows])
        snapshot = {
            'checkedAt': datetime.now(timezone.utc).isoformat(), 'watcherPid': os.getpid(),
            'event': event, 'coordinatorPids': [pid for pid, _ in coordinators],
            'activeJobPids': [pid for pid, _ in active_jobs], 'stage': status.get('current'),
            'secondsSinceLogProgress': round(time.monotonic() - last_progress),
            'needsInspection': time.monotonic() - last_progress > 900 or bool(guard and guard['needsInspection']) or bool(small_guard and small_guard['needsInspection']),
            'continuationGuard': guard,
            'smallEngineContinuation': small_guard,
            'automaticRestarts': restarts,
            'networkRestarts': network_restarts,
            'retryableNetworkErrors': len(network_errors),
        }
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(snapshot, indent=2) + '\n')
        temporary.replace(state_path)
        print(json.dumps(snapshot), flush=True)
        time.sleep(30)


if __name__ == '__main__':
    main()
