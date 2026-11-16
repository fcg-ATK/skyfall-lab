'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '../dist/assets');

test('PC fragment binary covers every source piece and uses the shared runtime layout', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(folder, 'pc-fragments.json')));
  const raw = fs.readFileSync(path.join(folder, 'pc-fragments.bin'));
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const mobile = JSON.parse(fs.readFileSync(path.join(folder, 'mobile-building.json')));
  const partIds = new Set(mobile.pieces.map(p => p.id));
  assert.equal(doc.version, 1);
  assert.equal(doc.pieces.length, 5633);
  assert.equal(doc.triangleCount * 3, doc.vertexCount);
  const arrays = {};
  let priorEnd = 0;
  for (const [name, components] of Object.entries({ position: 3, normal: 3, uv: 2, color: 3, pieceId: 1 })) {
    const record = doc.buffers[name];
    const Type = name === 'color' ? Uint8Array : Float32Array;
    assert.equal(record.offset % 4, 0, name);
    assert.equal(record.length, doc.vertexCount * components, name);
    assert.ok(record.offset >= priorEnd);
    priorEnd = record.offset + record.length * Type.BYTES_PER_ELEMENT;
    assert.ok(priorEnd <= buffer.byteLength);
    arrays[name] = new Type(buffer, record.offset, record.length);
  }
  let vertex = 0;
  const seenParts = new Set();
  const seenMeshes = new Set();
  for (const [id, piece] of doc.pieces.entries()) {
    assert.equal(piece.id, id);
    assert.ok(partIds.has(piece.partId));
    seenParts.add(piece.partId);
    seenMeshes.add(piece.sourceMesh);
    assert.equal(piece.firstVertex, vertex);
    assert.equal(piece.vertexCount % 3, 0);
    assert.ok(piece.vertexCount >= 12);
    if (piece.kind === 'glass') assert.equal(piece.vertexCount, 24, 'closed triangular prism, eight triangles');
    for (const value of [...piece.center, ...piece.half]) assert.ok(Number.isFinite(value));
    for (let i = vertex; i < vertex + piece.vertexCount; i++) {
      assert.equal(arrays.pieceId[i], id);
      let normalLength = 0;
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = arrays.position[i * 3 + axis];
        assert.ok(Number.isFinite(coordinate));
        assert.ok(Math.abs(coordinate) <= piece.half[axis] + 0.0001);
        normalLength += arrays.normal[i * 3 + axis] ** 2;
      }
      assert.ok(Math.abs(normalLength - 1) < 0.001);
      assert.ok(Number.isFinite(arrays.uv[i * 2]) && Number.isFinite(arrays.uv[i * 2 + 1]));
    }
    if (piece.kind === 'structure') {
      let inclinedCap = false;
      for (let i = vertex; i < vertex + piece.vertexCount; i += 3) {
        const color = arrays.color.subarray(i * 3, i * 3 + 3);
        const normal = arrays.normal.subarray(i * 3, i * 3 + 3);
        if (color[0] === 64 && color[1] === 64 && color[2] === 59 && Array.from(normal).filter(n => Math.abs(n) > 0.02).length >= 2) inclinedCap = true;
      }
      assert.ok(inclinedCap, `${piece.sourceMesh} retains an actual inclined fracture cap`);
    } else {
      const edges = new Map();
      let volume = 0;
      for (let i = vertex; i < vertex + piece.vertexCount; i += 3) {
        const points = [0, 1, 2].map(v => Array.from(arrays.position.subarray((i + v) * 3, (i + v) * 3 + 3)));
        const keys = points.map(v => v.join(','));
        for (let e = 0; e < 3; e++) {
          const key = [keys[e], keys[(e + 1) % 3]].sort().join('|');
          edges.set(key, (edges.get(key) || 0) + 1);
        }
        const [a, b, c] = points;
        volume += (a[0] * (b[1]*c[2]-b[2]*c[1]) + a[1] * (b[2]*c[0]-b[0]*c[2]) + a[2] * (b[0]*c[1]-b[1]*c[0])) / 6;
      }
      assert.ok(Array.from(edges.values()).every(n => n === 2), 'glass prism has no open edge');
      assert.ok(volume > 1e-9, 'glass prism has real thickness and outward winding');
    }
    vertex += piece.vertexCount;
  }
  assert.equal(vertex, doc.vertexCount);
  assert.equal(seenParts.size, 48);
  assert.equal(seenMeshes.size, 3425);
  assert.deepEqual(doc.materialRanges.map(r => r.kind), ['structure', 'glass']);
  assert.equal(doc.materialRanges[0].start, 0);
  assert.equal(doc.materialRanges[1].start, doc.materialRanges[0].count);
  assert.equal(doc.materialRanges.reduce((n, r) => n + r.count, 0), doc.vertexCount);
  assert.ok(doc.provenance.maxParentBoundsErrorMeters < 0.016);
  // The intact mobile asset has its own decimation, with a 1.6 cm bounds shift.
  assert.ok(doc.provenance.maxPartBoundsErrorMeters < 0.035);
  assert.equal(doc.provenance.sourceMeshesOmitted, 0);
  assert.equal(doc.provenance.newBoundaryEdges, 0);
});
