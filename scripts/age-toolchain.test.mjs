import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const recipe = new URL('../corpora/upstream/wago/corpus/workloads/applications/age/build.sh', import.meta.url);

async function runAgeRecipe(toolchain) {
  const root = await mkdtemp(join(tmpdir(), 'wasm-fyi-age-toolchain-'));
  try {
    const bin = join(root, 'bin'), source = join(root, 'age'), output = join(root, 'output');
    await Promise.all([bin, source, output].map(path => mkdir(path)));
    await copyFile(recipe, join(output, 'build.sh'));
    // Model the pinned checkout and the two Go banners. No compiler or network
    // access is needed to test the recipe's exact-version guard and commands.
    await writeFile(join(bin, 'git'), `#!/usr/bin/env bash
set -euo pipefail
case "$3 $4" in
  'rev-parse HEAD') echo b74dce4cdbe35b5e5f66c06d9612b72f89028758 ;;
  'status --porcelain') ;;
  *) exit 90 ;;
esac
`, { mode: 0o755 });
    await writeFile(join(bin, 'go'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == version ]]; then
  if [[ "$GOTOOLCHAIN" == auto ]]; then
    echo 'go version go1.27.0 linux/amd64'
  else
    echo 'go version go1.26.5 linux/amd64'
  fi
else
  [[ "$1 $2 $3" == 'build -trimpath -o' ]]
  [[ "$CGO_ENABLED $GOOS $GOARCH $GOFLAGS" == '0 wasip1 wasm -mod=readonly' ]]
  printf '%s\\n' "$5" >> "$AGE_BUILD_CALLS"
  printf 'fixture module\\n' > "$4"
fi
`, { mode: 0o755 });
    const calls = join(root, 'build-calls');
    const result = spawnSync('bash', [join(output, 'build.sh'), source], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOTOOLCHAIN: toolchain, AGE_BUILD_CALLS: calls }
    });
    return { ...result, builds: await readFile(calls, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('age refuses setup-go local selection of the older base toolchain', async () => {
  const result = await runAgeRecipe('local');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'build with Go 1.27.0\n');
  assert.equal(result.builds, '');
});

test('age accepts its pinned toolchain and builds both WASI commands', async () => {
  const result = await runAgeRecipe('auto');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.builds, './cmd/age\n./cmd/age-keygen\n');
});

test('CI restores automatic Go toolchain selection after setup-go', async () => {
  const workflow = await readFile(new URL('../.github/workflows/corpus.yml', import.meta.url), 'utf8');
  const step = workflow.match(/      - name: Build every corpus from source and check execution\n([\s\S]*?)(?=\n      - |$)/)?.[1];
  assert.ok(step, 'missing full corpus source build step');
  // setup-go@v6 exports GOTOOLCHAIN=local to subsequent steps. An override
  // here is required; setting it only on the job does not undo that export.
  assert.match(step, /(?:\n|^)        env:\s*\n(?:          [^\n]*\n)*?          GOTOOLCHAIN: ['"]?auto['"]?\s*(?:\n|$)|\bexport GOTOOLCHAIN=auto\b/);
});
