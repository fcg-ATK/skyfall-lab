'use strict';
// Exercise the real Three.js buffers and the particle simulation. WebGL shader
// compilation, point silhouettes and perceived density need browser visual QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const physics = require('../dist/physics.js');
const dist = path.resolve(__dirname, '../dist');
const context = vm.createContext({ console, Float32Array, Uint16Array, Int32Array, Uint8Array });
context.window = context;
vm.runInContext(fs.readFileSync(path.join(dist, 'three-local.js'), 'utf8'), context);
if (fs.existsSync(path.join(dist, 'powder.js')))
  vm.runInContext(fs.readFileSync(path.join(dist, 'powder.js'), 'utf8'), context);
const T = context.THREE;

function fixture() {
  assert.equal(typeof context.SkyfallPowder?.create, 'function', 'powder factory must exist');
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(43, .6, .3, 600);
  camera.position.set(24, 18, 37); camera.lookAt(0, 7, 0); camera.updateMatrixWorld(true);
  const powder = context.SkyfallPowder.create(scene);
  const point = new T.Vector3(0, 20, 0), direction = new T.Vector3(0, 0, -1);
  const batches = []; scene.traverse(node => { if (node.isPoints) batches.push(node); });
  assert.equal(batches.length, 1, 'thousands of grains share one points batch');
  return { scene, camera, powder, point, direction, batch: batches[0] };
}
function positions(batch) {
  return Array.from(batch.geometry.attributes.position.array.slice(0, batch.geometry.drawRange.count * 3));
}
function meanAxis(batch, axis) {
  const p = positions(batch); let sum = 0;
  for (let i = axis; i < p.length; i += 3) sum += p[i];
  return sum / (p.length / 3);
}

test('quality limits bound repeated emissions without allocating extra GPU batches', () => {
  const { powder, batch, point, direction, camera, scene } = fixture();
  const geometry = batch.geometry, material = batch.material;
  const positionArray = geometry.attributes.position.array;
  for (const [quality, expected] of [['low', 1400], ['balanced', 3000], ['high', 5000]]) {
    powder.reset(); powder.setQuality(physics.qualityProfile(quality));
    powder.emit(point, { direction, energy: 1, count: 9000, spread: .7 });
    powder.render(camera, 720, 2);
    assert.equal(powder.stats().active, expected);
    assert.equal(geometry.drawRange.count, expected);
  }
  for (let i = 0; i < 200; i++) {
    powder.emit(point, { direction, energy: 1, count: 90, spread: .5 });
    powder.step(1 / 120); powder.render(camera, 720, 2);
  }
  assert.ok(powder.stats().active <= 5000);
  powder.setQuality('low');
  assert.ok(powder.stats().active <= 1400, 'downgrade immediately retires excess particles');
  assert.ok(geometry.drawRange.count <= 1400, 'already submitted draw also respects the reduced budget');
  powder.setQuality('high'); powder.render(camera, 720, 2);
  assert.equal(batch.geometry, geometry); assert.equal(batch.material, material);
  assert.equal(batch.geometry.attributes.position.array, positionArray);
  assert.equal(scene.children.length, 1);
  assert.equal(material.blending, T.NormalBlending, 'concrete grains must not glow additively');
  assert.equal(material.depthTest, true);
});

test('penetration carries most powder forwards while an upper-floor emission falls immediately', () => {
  const { powder, batch, point, direction, camera } = fixture();
  const originalPoint = point.clone(), originalDirection = direction.clone();
  powder.emit(point, { direction, energy: 1.4, count: 600, spread: .15 });
  powder.step(.3); powder.render(camera, 720);
  assert.ok(meanAxis(batch, 2) < -2, 'the visible spray continues along the shot direction');
  assert.ok(point.equals(originalPoint) && direction.equals(originalDirection));
  powder.reset();
  powder.emit(point, { direction, energy: 1, count: 600, spread: .2, falling: true });
  powder.render(camera, 720); const start = positions(batch);
  powder.step(.4); powder.render(camera, 720); const after = positions(batch);
  assert.equal(after.length, start.length);
  for (let i = 1; i < after.length; i += 3)
    assert.ok(after[i] < start[i] - .4, 'every unsupported grain falls, rather than floating as a smoke layer');
  assert.ok(meanAxis(batch, 1) < 18.5);
});

test('paused and malformed timesteps leave particle positions and lifetimes unchanged', () => {
  const { powder, batch, point, direction, camera } = fixture();
  powder.emit(point, { direction, energy: 1, count: 250, spread: .3 });
  powder.step(.15); powder.render(camera, 720, 1.5);
  const before = positions(batch), active = powder.stats().active;
  for (const dt of [0, 0, NaN, -1, Infinity]) {
    powder.step(dt); powder.render(camera, 720, 1.5);
    assert.deepEqual(positions(batch), before);
    assert.equal(powder.stats().active, active);
  }
  powder.step(.2); powder.render(camera, 720);
  assert.notDeepEqual(positions(batch), before);
});

test('a full pool reclaims its oldest grains and a long elapsed frame expires all of them', () => {
  const { powder, batch, direction, camera } = fixture();
  powder.setQuality('low');
  powder.emit(new T.Vector3(0, 20, 0), { direction, count: 100, spread: 0 });
  powder.emit(new T.Vector3(100, 20, 0), { direction, count: 1300, spread: 0 });
  powder.emit(new T.Vector3(200, 20, 0), { direction, count: 10, spread: 0 });
  powder.render(camera, 720);
  const p = positions(batch); let oldest = 0, middle = 0, newest = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < 10) oldest++;
    else if (p[i] < 110) middle++;
    else newest++;
  }
  assert.deepEqual([oldest, middle, newest], [90, 1300, 10]);
  powder.step(4.1); powder.render(camera, 720);
  assert.equal(powder.stats().active, 0); assert.equal(batch.geometry.drawRange.count, 0);
  assert.equal(batch.visible, false);
});

test('ground contact stops vertical motion, spreads slowly, then fades completely', () => {
  const { powder, batch, direction, camera } = fixture();
  powder.emit(new T.Vector3(0, .25, 0), { direction, energy: 1, count: 400, spread: 0, falling: true });
  powder.step(.25); powder.render(camera, 720); const settled = positions(batch);
  assert.ok(settled.length > 0, 'landing leaves a short visible low spread');
  powder.step(.15); powder.render(camera, 720); const spread = positions(batch);
  assert.equal(spread.length, settled.length);
  for (let i = 0; i < spread.length; i += 3) {
    assert.ok(spread[i + 1] >= .005 && spread[i + 1] <= .1, 'grains stay on the ground surface');
    assert.equal(spread[i + 1], settled[i + 1], 'settled grains cannot bounce back up');
    assert.ok(Math.hypot(spread[i] - settled[i], spread[i + 2] - settled[i + 2]) < .5);
  }
  powder.step(1); powder.render(camera, 720);
  assert.equal(powder.stats().active, 0);
});

test('reset hides submitted grains immediately and starts the next burst cleanly', () => {
  const { powder, batch, point, direction, camera } = fixture();
  powder.emit(point, { direction, count: 700, spread: 1 }); powder.render(camera, 720);
  assert.equal(batch.visible, true);
  powder.reset();
  assert.equal(batch.visible, false); assert.equal(batch.geometry.drawRange.count, 0);
  assert.equal(powder.stats().active, 0);
  powder.render(camera, 720); assert.equal(batch.geometry.drawRange.count, 0);
  powder.emit(point, { direction, count: 17, spread: 0 }); powder.render(camera, 720);
  assert.equal(batch.geometry.drawRange.count, 17);
});

test('empty bursts are no-ops and zero directions or nonfinite options cannot poison the buffers', () => {
  const { powder, batch, point, camera } = fixture();
  powder.emit(point, { count: 0 });
  powder.emit(new T.Vector3(NaN, 2, 0), { count: 100 });
  assert.equal(powder.stats().active, 0);
  powder.emit(point, { direction: new T.Vector3(), count: 100, spread: NaN, energy: Infinity });
  powder.step(.1); powder.render(camera, NaN, Infinity);
  assert.equal(powder.stats().active, 100);
  for (const attribute of Object.values(batch.geometry.attributes))
    assert.ok(Array.from(attribute.array.slice(0, 100 * attribute.itemSize)).every(Number.isFinite));
});
