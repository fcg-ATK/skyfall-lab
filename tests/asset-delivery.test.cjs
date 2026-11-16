'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

const sourceRoot = path.join(__dirname, '../dist');
const builderPath = path.join(__dirname, '../tools/prepare-assets.cjs');
const requiredAssets = [
  'assets/mobile-building.glb',
  'assets/pc-fragments.bin',
  'assets/pc-fragments.json',
  'assets/mobile-building.json',
];

function isolatedAssets(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyfall-asset-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  for (const name of requiredAssets) {
    fs.copyFileSync(path.join(sourceRoot, name), path.join(root, name));
  }
  return root;
}

test('compressed delivery preserves every original byte and cuts required transfer by at least 60%', (t) => {
  assert.ok(fs.existsSync(builderPath), 'asset compression builder must exist');
  const { prepareAssets } = require(builderPath);
  const root = isolatedAssets(t);
  const originals = requiredAssets.map(name => fs.readFileSync(path.join(root, name)));

  const result = prepareAssets(root);

  let rawBytes = 0;
  let compressedBytes = 0;
  for (const [index, name] of requiredAssets.entries()) {
    const original = originals[index];
    const compressed = fs.readFileSync(path.join(root, name + '.gz'));
    assert.deepEqual(gunzipSync(compressed), original, `${name} must decompress byte-for-byte`);
    assert.deepEqual(fs.readFileSync(path.join(root, name)), original, `${name} fallback must remain unchanged`);
    rawBytes += original.length;
    compressedBytes += compressed.length;
  }
  assert.ok(compressedBytes < rawBytes * 0.4, `${compressedBytes} compressed bytes must be below 40% of ${rawBytes}`);
  assert.equal(result.rawBytes, rawBytes);
  assert.equal(result.compressedBytes, compressedBytes);
  assert.deepEqual(result.assets.map(asset => asset.path), requiredAssets);
});

test('rebuilding compressed delivery produces identical files', (t) => {
  assert.ok(fs.existsSync(builderPath), 'asset compression builder must exist');
  const { prepareAssets } = require(builderPath);
  const root = isolatedAssets(t);
  prepareAssets(root);
  const first = requiredAssets.map(name => fs.readFileSync(path.join(root, name + '.gz')));

  prepareAssets(root);

  for (const [index, name] of requiredAssets.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(root, name + '.gz')), first[index], name);
  }
});
