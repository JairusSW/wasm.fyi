#!/usr/bin/env python3
"""Restore the standalone interpreter SDK prerequisites inside the build lease.

Invoked through reservedBuildCommand by benchmark-libwasm-history.mjs. Shared
dependency installs have a commit-based receipt and survive per-SDK cleanup.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess


def run(*args):
    subprocess.run([str(a) for a in args], check=True, timeout=1800)


def checkout(path, repository, ref):
    if not (path / '.git').exists():
        run('git', 'init', path)
        run('git', '-C', path, 'remote', 'add', 'origin', repository)
    if not (path / '.wasmfyi-source.json').exists():
        run('git', '-C', path, 'fetch', '--depth', '1', 'origin', ref)
        run('git', '-C', path, 'checkout', '--detach', 'FETCH_HEAD')
    revision = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    receipt = {'repository': repository, 'ref': ref, 'revision': revision}
    saved = path / '.wasmfyi-source.json'
    if saved.exists() and json.loads(saved.read_text()) != receipt:
        raise RuntimeError('Dependency source identity changed: ' + str(path))
    saved.write_text(json.dumps(receipt) + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tool_root', type=Path)
    args = parser.parse_args()
    root = args.tool_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    source = root / 'libwasm-source'
    if not source.exists():
        run('git', 'init', '--bare', source)
        run('git', '-C', source, 'remote', 'add', 'origin', 'https://github.com/LadybirdBrowser/ladybird.git')
    # Git 2.25 requires the partial-clone extension before a bare filtered fetch.
    run('git', '-C', source, 'config', 'core.repositoryformatversion', '1')
    run('git', '-C', source, 'config', 'extensions.partialClone', 'origin')
    run('git', '-C', source, 'config', 'remote.origin.promisor', 'true')
    run('git', '-C', source, 'config', 'remote.origin.partialclonefilter', 'blob:none')
    assets = Path(__file__).resolve().parent / 'libwasm'
    project = root / 'libwasm-build-project'
    shutil.copytree(assets, project, dirs_exist_ok=True)
    deps = root / 'libwasm-deps'
    jobs = os.environ.get('WASMFYI_BUILD_JOBS', str(os.cpu_count() or 1))
    receipts = {}
    for name, repository, ref, flags in [
        ('fmt', 'https://github.com/fmtlib/fmt.git', '12.2.0', ['-DFMT_TEST=OFF', '-DFMT_DOC=OFF']),
        ('simdutf', 'https://github.com/simdutf/simdutf.git', 'v9.1.0', ['-DSIMDUTF_TESTS=OFF', '-DSIMDUTF_TOOLS=OFF', '-DSIMDUTF_BENCHMARKS=OFF']),
        ('fastfloat', 'https://github.com/fastfloat/fast_float.git', 'v8.2.10', None),
        ('mimalloc', 'https://github.com/microsoft/mimalloc.git', 'v2.2.7', None),
    ]:
        src = root / ('libwasm-' + name)
        receipt = checkout(src, repository, ref)
        receipts[name] = receipt
        if flags is None:
            continue
        built = deps / ('.' + name + '-built.json')
        if built.exists() and json.loads(built.read_text()) == receipt:
            continue
        build = root / 'libwasm-dependency-builds' / name
        run('cmake', '-S', src, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
            '-DCMAKE_POSITION_INDEPENDENT_CODE=ON', '-DBUILD_SHARED_LIBS=OFF',
            '-DCMAKE_INSTALL_PREFIX=' + str(deps), *flags)
        run('cmake', '--build', build, '--parallel', jobs)
        run('cmake', '--install', build)
        built.write_text(json.dumps(receipt) + '\n')
        shutil.rmtree(build)
    (root / 'libwasm-prerequisites.json').write_text(json.dumps(receipts, indent=2) + '\n')


if __name__ == '__main__':
    main()
