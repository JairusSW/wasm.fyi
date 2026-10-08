import test from 'node:test';
import assert from 'node:assert/strict';
import { isBinaryen130Version } from './lib/source-build-toolchains.mjs';

test('Lua accepts both canonical Binaryen 130 version banners', () => {
  assert.equal(isBinaryen130Version('wasm-opt version 130'), true);
  assert.equal(isBinaryen130Version('wasm-opt version 130 (version_130)\n'), true);
  for (const version of ['wasm-opt version 129', 'wasm-opt version 131',
    'wasm-opt version 1300', 'wasm-opt version 130 (version_131)',
    'wasm-opt version 130 (development)', 'other wasm-opt version 130']) {
    assert.equal(isBinaryen130Version(version), false, version);
  }
});
