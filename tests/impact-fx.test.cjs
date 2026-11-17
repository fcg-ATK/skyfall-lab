'use strict';
// Real Three.js CPU checks; no WebGL context, shader compilation or visual QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const physics = require('../dist/physics.js');
const dist = path.resolve(__dirname, '../dist');
const context = vm.createContext({ console, Uint8Array, Uint8ClampedArray, Float32Array, Uint16Array, Uint32Array,
  document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
  }) }) },
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(dist, 'three-local.js'), 'utf8'), context);
if (fs.existsSync(path.join(dist, 'impact-fx.js')))
  vm.runInContext(fs.readFileSync(path.join(dist, 'impact-fx.js'), 'utf8'), context);
const T = context.THREE;
function fixture() {
  assert.equal(typeof context.SkyfallImpactFX?.create, 'function', 'impact FX factory must exist');
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(43, 1, .3, 600);
  camera.position.set(24, 18, 37); camera.lookAt(0, 7, 0); camera.updateMatrixWorld(true);
  const fx = context.SkyfallImpactFX.create(scene);
  const point = new T.Vector3(0, 7, 0), direction = new T.Vector3(0, 0, -1);
  return { scene, camera, fx, point, direction };
}
function resources(scene) {
  const geometry = new Set(), material = new Set(), texture = new Set(); let meshes = 0, slots = 0;
  scene.traverse(node => {
    if (!node.isMesh) return;
    meshes++; geometry.add(node.geometry); material.add(node.material);
    assert.ok(node.isInstancedMesh, 'every burst layer shares a fixed instance allocation');
    slots += node.instanceMatrix.count;
    for (const uniform of Object.values(node.material.uniforms || {}))
      if (uniform.value?.isTexture) texture.add(uniform.value);
  });
  return { meshes, slots, geometry, material, texture };
}
function visibleCount(scene) {
  let count = 0; scene.traverse(n => { if (n.isInstancedMesh && n.visible) count += n.count; }); return count;
}

test('repeated penetrating impacts reuse bounded GPU resources and reset removes every instance', () => {
  const { fx, scene, camera, point, direction } = fixture();
  const initial = resources(scene);
  assert.ok(initial.meshes < 8 && initial.meshes > 0);
  assert.ok(initial.slots <= 256, 'mobile impact pool stays under 256 quads');
  assert.ok(initial.texture.size <= 1, 'all thermal/smoke layers share one small generated texture');
  for (let i = 0; i < 500; i++) {
    fx.burst(point, direction, i % 3 ? 'rocket' : 'meteor', 1);
    fx.step(1 / 120); fx.render(camera);
  }
  const after = resources(scene);
  assert.deepEqual(after, initial, 'no per-hit mesh, material, geometry, texture or allocation growth');
  assert.ok(fx.stats().active <= initial.slots);
  assert.ok(visibleCount(scene) > 0);
  fx.reset();
  assert.equal(visibleCount(scene), 0, 'reset hides old effects without waiting for the next render');
  assert.equal(fx.stats().active, 0);
  fx.render(camera);
  assert.equal(visibleCount(scene), 0);
});

test('flash, flame, shock and smoke follow separate finite lifetimes', () => {
  const { fx, camera, point, direction } = fixture();
  fx.burst(point, direction, 'rocket'); fx.render(camera);
  assert.ok(fx.stats().layers.flash > 0);
  assert.ok(fx.stats().layers.fire > 0);
  assert.ok(fx.stats().layers.shock > 0);
  assert.equal(fx.stats().layers.smoke, 0, 'dark smoke starts after the flash');
  fx.step(.06); fx.render(camera);
  assert.equal(fx.stats().layers.flash, 0, 'white core must end at 50 ms');
  assert.ok(fx.stats().layers.fire > 0);
  fx.step(.18); fx.render(camera);
  assert.ok(fx.stats().layers.smoke > 0);
  assert.ok(fx.stats().layers.smoke <= 4, 'smoke must leave the facade readable');
  fx.step(.4); fx.render(camera);
  assert.equal(fx.stats().layers.fire, 0, 'fireball cools within 600 ms');
  assert.equal(fx.stats().layers.shock, 0, 'pressure ring ends within 400 ms');
  fx.step(4); fx.render(camera);
  assert.equal(fx.stats().active, 0, 'large frame gaps also retire particles');
});

test('steel ball makes directional grit and sparks without an explosive fireball', () => {
  const { fx, scene, camera, point, direction } = fixture();
  const savedPoint = point.clone(), savedDirection = direction.clone();
  fx.burst(point, direction, 'ball'); fx.step(.1); fx.render(camera);
  assert.equal(fx.stats().layers.flash, 0); assert.equal(fx.stats().layers.fire, 0);
  assert.equal(fx.stats().layers.shock, 0); assert.ok(fx.stats().layers.sparks >= 8);
  assert.ok(point.equals(savedPoint) && direction.equals(savedDirection), 'caller vectors remain unchanged');
  const sparks = scene.getObjectByName('impact_sparks'), matrix = new T.Matrix4(), position = new T.Vector3();
  assert.ok(sparks?.count >= 8);
  let forward = 0;
  for (let i = 0; i < sparks.count; i++) {
    sparks.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix).sub(point);
    if (position.dot(direction) > .1) forward++;
  }
  assert.ok(forward >= sparks.count * .5, 'most hot debris continues along the incoming trajectory');
});

test('meteor has a larger thermal envelope and low quality reduces live pool limits', () => {
  const { fx, scene, camera, point, direction } = fixture();
  function fireEnvelope(weapon) {
    fx.reset(); fx.burst(point, direction, weapon); fx.step(.18); fx.render(camera);
    const heat = scene.getObjectByName('impact_heat'), m = new T.Matrix4(), scale = new T.Vector3(); let max = 0;
    for (let i = 0; i < heat.count; i++) { heat.getMatrixAt(i, m); scale.setFromMatrixScale(m); max = Math.max(max, scale.x); }
    return max;
  }
  assert.ok(fireEnvelope('meteor') > fireEnvelope('rocket') * 1.35);
  fx.reset(); fx.setQuality(physics.qualityProfile('high'));
  for (let i = 0; i < 20; i++) fx.burst(point, direction, 'meteor');
  const high = fx.stats().active;
  fx.setQuality(physics.qualityProfile('low')); fx.render(camera);
  assert.ok(fx.stats().active < high, 'quality downgrade trims existing live particles');
  const low = fx.stats().active;
  for (let i = 0; i < 20; i++) fx.burst(point, direction, 'meteor');
  assert.ok(fx.stats().active <= low, 'subsequent bursts respect the reduced pool');
  const allocated = resources(scene);
  fx.setQuality(physics.qualityProfile('high'));
  assert.deepEqual(resources(scene), allocated, 'quality changes never allocate extra GPU resources');
});

test('zero direction and malformed frame input cannot poison instance matrices', () => {
  const { fx, scene, camera, point } = fixture();
  fx.burst(point, new T.Vector3(), 'rocket', 1);
  fx.step(NaN); fx.step(-1); fx.render(camera);
  scene.traverse(n => {
    if (!n.isInstancedMesh) return;
    assert.ok(Array.from(n.instanceMatrix.array.slice(0, n.count * 16)).every(Number.isFinite));
    assert.equal(n.material.depthWrite, false);
  });
  fx.step(4); fx.render(camera); assert.equal(visibleCount(scene), 0);
});

test('rocket pressure and concrete spall stay compact enough to show the contact opening', () => {
  const { fx, scene, camera, point, direction } = fixture();
  fx.burst(point, direction, 'rocket'); fx.step(.08); fx.render(camera);
  const smoke = scene.getObjectByName('impact_smoke');
  assert.ok(smoke.count > 0, 'brief pale spall starts while the impact fire is still present');
  for (let i = 0; i < smoke.count; i++) {
    assert.equal(smoke.geometry.attributes.aEffect.getZ(i), 1, 'early spall is powdered concrete, not black smoke');
    assert.ok(smoke.geometry.attributes.aEffect.getY(i) < .2, 'spall must remain translucent');
  }
  fx.step(.28); fx.render(camera);
  const ring = scene.getObjectByName('impact_shock'), matrix = new T.Matrix4(), size = new T.Vector3();
  ring.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix);
  assert.ok(size.x <= 9, 'pressure cue stays close to the compact rocket footprint');
});

test('real support release emits a finite pale seam puff without a second explosion or new GPU resources', () => {
  const { fx, scene, camera, point } = fixture(), initial = resources(scene);
  assert.equal(typeof fx.structuralRelease, 'function');
  fx.structuralRelease({ point, energy: 0 }); fx.render(camera);
  assert.equal(visibleCount(scene), 0, 'no release energy produces no dust');
  fx.structuralRelease({ point, energy: 1 }); fx.step(.12); fx.render(camera);
  const live = fx.stats().layers;
  assert.ok(live.smoke > 0 && live.smoke <= 3);
  assert.equal(live.fire + live.flash + live.shock + live.sparks, 0);
  const smoke = scene.getObjectByName('impact_smoke');
  for (let i = 0; i < smoke.count; i++) {
    assert.equal(smoke.geometry.attributes.aEffect.getZ(i), 1);
    assert.ok(smoke.geometry.attributes.aEffect.getY(i) < .2);
  }
  for (let i = 0; i < 400; i++) fx.structuralRelease({ point, energy: 1 });
  assert.deepEqual(resources(scene), initial);
  assert.ok(fx.stats().active <= 10, 'release puffs share the existing smoke limit');
  fx.step(2); fx.render(camera); assert.equal(visibleCount(scene), 0);
  fx.structuralRelease({ point, energy: 1 }); fx.reset();
  assert.equal(fx.stats().active, 0);
});
