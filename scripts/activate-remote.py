#!/usr/bin/python3 -I
"""Root-owned activation command; CI supplies only a static API and frontend."""
import hashlib
import fcntl
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

INCOMING = pathlib.Path('/var/lib/wasmfyi-deploy/incoming')
RELEASES = pathlib.Path('/opt/wasmfyi/releases')
CURRENT = pathlib.Path('/opt/wasmfyi/current')
MAX_BYTES = 160 * 1024 * 1024
MAX_FILES = 4096
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def validate_revision(value):
    if not re.fullmatch(r'[a-f0-9]{40}', value):
        raise ValueError('Expected one full Git commit SHA')
    return value


def copy_file(source, name, destination, budget):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError('Release contains a non-regular file')
        budget['files'] -= 1
        if budget['files'] < 0 or metadata.st_size > budget['bytes']:
            raise ValueError('Release exceeds size limits')
        digest = hashlib.sha256()
        with os.fdopen(descriptor, 'rb', closefd=False) as incoming:
            with open(destination, 'xb') as output:
                while True:
                    chunk = incoming.read(1024 * 1024)
                    if not chunk:
                        break
                    budget['bytes'] -= len(chunk)
                    if budget['bytes'] < 0:
                        raise ValueError('Release exceeds size limits')
                    output.write(chunk)
                    digest.update(chunk)
        os.chmod(destination, 0o644)
        return digest.hexdigest()
    finally:
        os.close(descriptor)


def copy_tree(source, destination, budget, depth=0):
    if depth > 16:
        raise ValueError('Release directory nesting exceeds limits')
    destination.mkdir(mode=0o755)
    for name in os.listdir(source):
        metadata = os.stat(name, dir_fd=source, follow_symlinks=False)
        if stat.S_ISDIR(metadata.st_mode):
            descriptor = os.open(name, DIRECTORY_FLAGS, dir_fd=source)
            try:
                copy_tree(descriptor, destination / name, budget, depth + 1)
            finally:
                os.close(descriptor)
        else:
            copy_file(source, name, destination / name, budget)


def stage(revision):
    validate_revision(revision)
    parent = os.open(INCOMING, DIRECTORY_FLAGS)
    try:
        source = os.open(revision, DIRECTORY_FLAGS, dir_fd=parent)
    finally:
        os.close(parent)
    temporary = pathlib.Path(tempfile.mkdtemp(prefix='.github-' + revision + '-', dir=RELEASES))
    try:
        budget = {'bytes': MAX_BYTES, 'files': MAX_FILES}
        binary_sha = copy_file(source, 'wasmfyi', temporary / 'wasmfyi', budget)
        with open(temporary / 'wasmfyi', 'rb') as binary:
            header = binary.read(20)
        if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or header[18:20] != b'\x3e\x00':
            raise ValueError('Expected a Linux amd64 API binary')
        descriptor = os.open('frontend', DIRECTORY_FLAGS, dir_fd=source)
        try:
            copy_tree(descriptor, temporary / 'frontend', budget)
        finally:
            os.close(descriptor)
        for name in ('index.html', '404.html'):
            if not (temporary / 'frontend' / name).is_file():
                raise ValueError('Missing frontend application shell')
        (temporary / 'commit').write_text(revision + '\n')
        (temporary / 'release.json').write_text(json.dumps({'commit': revision, 'binarySha256': binary_sha}) + '\n')
        os.chmod(temporary / 'wasmfyi', 0o755)
        os.chmod(temporary, 0o755)
        destination = RELEASES / ('github-' + revision + '-' + str(time.time_ns()))
        temporary.rename(destination)
        return destination
    except Exception:
        shutil.rmtree(temporary)
        raise
    finally:
        os.close(source)


def switch(target):
    link = CURRENT.with_name('current.ci-next')
    try:
        link.unlink()
    except FileNotFoundError:
        pass
    link.symlink_to(target)
    link.replace(CURRENT)


def restart():
    subprocess.run(['/bin/systemctl', 'restart', 'wasmfyi.service'], check=True)


def ready():
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=1) as response:
                if response.status == 200 and json.load(response).get('ready') is True:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('New API did not become ready')


def activate(target, restart_service=restart, check_ready=ready):
    previous = CURRENT.resolve(strict=True)
    switch(target)
    try:
        restart_service()
        check_ready()
    except Exception:
        switch(previous)
        restart_service()
        raise


def main():
    if len(sys.argv) != 2:
        raise ValueError('Expected one full Git commit SHA')
    revision = validate_revision(sys.argv[1])
    os.sched_setaffinity(0, {0, 1})
    with open('/run/lock/wasmfyi-deployment.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        activate(stage(revision))
    print('Deployed ' + revision)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
