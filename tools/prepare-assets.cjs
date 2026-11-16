'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

const requiredAssets = [
  'assets/mobile-building.glb',
  'assets/pc-fragments.bin',
  'assets/pc-fragments.json',
  'assets/mobile-building.json',
];

function prepareAssets(distRoot = path.resolve(__dirname, '../dist')) {
  const assets = requiredAssets.map(relative => {
    const file = path.join(distRoot, relative);
    const raw = fs.readFileSync(file);
    const compressed = gzipSync(raw, { level: 9 });
    // Keep the source as the fallback for browsers without native decompression.
    fs.writeFileSync(file + '.gz', compressed);
    return { path: relative, rawBytes: raw.length, compressedBytes: compressed.length };
  });
  return {
    assets,
    rawBytes: assets.reduce((sum, asset) => sum + asset.rawBytes, 0),
    compressedBytes: assets.reduce((sum, asset) => sum + asset.compressedBytes, 0),
  };
}

module.exports = { prepareAssets };

if (require.main === module) {
  const result = prepareAssets();
  for (const asset of result.assets) {
    process.stdout.write(`${asset.path}: ${asset.rawBytes} -> ${asset.compressedBytes} bytes\n`);
  }
  process.stdout.write(`Required assets: ${result.rawBytes} -> ${result.compressedBytes} bytes (${(100 * result.compressedBytes / result.rawBytes).toFixed(1)}%)\n`);
}
