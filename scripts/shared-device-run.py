"""Acquire the user's device wrapper; retry occupation and bounded work slices."""
import argparse
import fcntl
import json
import os
import pathlib
import signal
import subprocess
import sys
import time



OWNED_SLICE_SECONDS = 30 * 60
HANDOFF_SECONDS = 5 * 60


def campaign_schedule(command, environ=None):
    environ = os.environ if environ is None else environ
    if environ.get('WASMBENCH_SHARED_DEVICE_SCHEDULE'):
        return pathlib.Path(environ['WASMBENCH_SHARED_DEVICE_SCHEDULE'])
    # Existing detached coordinators also acquire the campaign schedule without
    # needing a restart. Find the frozen plan among command path ancestors.
    for argument in command:
        if not isinstance(argument, str) or not argument.startswith('/'):
            continue
        candidate = pathlib.Path(argument)
        for directory in (candidate, *candidate.parents):
            if (directory / 'source-plan.json').is_file() and (directory / 'collection-template.json').is_file():
                return directory / 'device-schedule.json'
    return None


def read_schedule(path):
    if path is None:
        return {'ownedSeconds': 0, 'breakUntil': 0}
    try:
        value = json.loads(path.read_text())
        return {'ownedSeconds': float(value.get('ownedSeconds', 0)),
                'breakUntil': float(value.get('breakUntil', 0))}
    except FileNotFoundError:
        return {'ownedSeconds': 0, 'breakUntil': 0}


def record_reservation(path, elapsed, exit_code, now):
    if path is None or exit_code == 75:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        value = read_schedule(path)
        value['ownedSeconds'] += max(0, elapsed)
        if value['ownedSeconds'] >= OWNED_SLICE_SECONDS or exit_code == 76:
            value['ownedSeconds'] = 0
            value['breakUntil'] = now + HANDOFF_SECONDS
        temporary = path.with_suffix('.tmp-' + str(os.getpid()))
        temporary.write_text(json.dumps(value) + '\n')
        temporary.replace(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repeat-slices', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('command required')
    home = pathlib.Path.home()
    wrapper = home / 'benchmark-lock.py'
    if not wrapper.is_file():
        parser.error('shared benchmark wrapper is missing; refusing to bypass it')
    schedule = campaign_schedule(command)
    child = None
    stopping = False

    def forward(signum, _):
        nonlocal stopping
        stopping = True
        if child is not None and child.poll() is None:
            child.send_signal(signum)

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    while not stopping:
        while not stopping:
            remaining = read_schedule(schedule)['breakUntil'] - time.time()
            if remaining <= 0:
                break
            (home / 'LOCK.md').read_text()
            time.sleep(min(10, remaining))
        if stopping:
            break
        # Reading the status informs waiting; only the wrapper acquires ownership.
        acquired_attempt = time.monotonic()
        child = subprocess.Popen(['python3', str(wrapper), '--owner', 'other-agent', '--', *command])
        code = child.wait()
        record_reservation(schedule, time.monotonic() - acquired_attempt, code, time.time())
        if stopping:
            return 130
        if code == 75:
            (home / 'LOCK.md').read_text()
            time.sleep(10)
        elif code == 76 and args.repeat_slices:
            print('Yielding shared device for five minutes after work slice.', flush=True)
            deadline = time.monotonic() + (0 if schedule is not None else HANDOFF_SECONDS)
            while not stopping and time.monotonic() < deadline:
                (home / 'LOCK.md').read_text()
                time.sleep(min(10, max(0, deadline - time.monotonic())))
        else:
            return code if code >= 0 else 128 - code

    return 130


if __name__ == '__main__':
    sys.exit(main())
