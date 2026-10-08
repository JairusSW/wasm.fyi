#!/usr/bin/env python3
"""Install an official LLVM SDK in the benchmark cache without sudo."""
import hashlib, json, os, pathlib, subprocess, sys

root = pathlib.Path(sys.argv[1]).resolve()
docker = sys.argv[2] if len(sys.argv) > 2 else None
version = sys.argv[3] if len(sys.argv) > 3 else '22.1.8'
checksums = {'22.1.8': 'df0e1ecf16caf3489a272a5eea4eec9b0d82878f6477fa309504f918a0006384', '20.1.8': '1ead36b3dfcb774b57be530df42bec70ab2d239fbce9889447c7a29a4ddc1ae6'}
checksum = checksums[version]
url = f'https://github.com/llvm/llvm-project/releases/download/llvmorg-{version}/LLVM-{version}-Linux-X64.tar.xz'
if docker == '-': docker = None
sdk = root / ('llvm-' + version)
receipt = sdk / 'receipt.json'
if receipt.exists() and (sdk / 'bin/llvm-tblgen').exists():
    print('LLVM SDK already installed:', sdk)
    sys.exit(0)
root.mkdir(parents=True, exist_ok=True)
archive = root / ('LLVM-' + version + '-Linux-X64.tar.xz')
if not archive.exists():
    partial = pathlib.Path(str(archive) + '.part')
    subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--continue-at', '-', '--max-time', '3600', url, '-o', str(partial)], check=True)
    partial.rename(archive)
digest = hashlib.sha256()
with archive.open('rb') as stream:
    for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
        digest.update(chunk)
if digest.hexdigest() != checksum:
    raise RuntimeError('Official LLVM release checksum mismatch')
with subprocess.Popen(['tar', '-tJf', str(archive)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True) as listing:
    prefix = listing.stdout.readline().strip().split('/')[0]
    listing.terminate()
    listing.wait()
if not prefix.startswith('LLVM-') or '..' in prefix:
    raise RuntimeError('Unexpected LLVM archive layout')
sdk.mkdir(parents=True, exist_ok=True)
subprocess.run(['tar', '-xJf', str(archive), '-C', str(sdk), '--strip-components=1', '--no-same-owner', '--no-same-permissions', '--wildcards', prefix + '/bin/*', prefix + '/include/*', prefix + '/lib/*'], check=True)
command = [str(sdk / 'bin/llvm-config'), '--version']
env = os.environ.copy()
env['LD_LIBRARY_PATH'] = str(sdk / 'lib') + ':' + env.get('LD_LIBRARY_PATH', '')
if docker:
    command = ['docker', 'exec', '-e', 'LD_LIBRARY_PATH=' + str(sdk / 'lib'), docker] + command
actual = subprocess.check_output(command, text=True, env=env).strip()
if actual != version or not (sdk / 'lib/libLLVMCore.a').exists():
    raise RuntimeError('Extracted LLVM SDK failed compiler/version validation')
receipt.write_text(json.dumps({'version': actual, 'url': url, 'archiveSha256': checksum, 'sdk': str(sdk), 'layout': 'complete-binaries-headers-libraries-v2'}, indent=2) + '\n')
archive.unlink()
print('LLVM SDK installed:', sdk)
