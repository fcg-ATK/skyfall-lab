'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { T, context, root } = require('./helpers/engine-harness.cjs');
const manifest = require('../dist/assets/mobile-building.json');
const descriptor = require('../dist/assets/pc-fragments.json');
const raw = fs.readFileSync(path.join(root, 'assets/pc-fragments.bin'));
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

async function setup() {
  const model = (await new T.GLTFLoader().loadAsync('assets/mobile-building.glb')).scene;
  const originalParts = manifest.pieces.map(data => {
    const node = model.getObjectByName(data.nodeName);
    return { ...data, node, rest: node.position.clone(), restQ: node.quaternion.clone(),
      restScale: node.scale.clone(), vel: new T.Vector3(), spin: new T.Vector3() };
  });
  const result = context.SkyfallStructureDetail.refine(originalParts, descriptor, buffer, model,
    { floorHeights: manifest.floorHeights });
  for (const part of result.parts) {
    part.active = part.gone = false;
    part.phase = 'intact';
  }
  return { ...result, model, originalParts };
}

test('refinement preserves every authored triangle and assigns every fragment to its smaller live owner', async () => {
  const { parts, descriptor: refined, model, originalParts } = await setup();
  assert.equal(parts.length, 144);
  assert.ok(originalParts.every(part => !part.node.parent));
  assert.equal(refined.pieces.length, descriptor.pieces.length);
  let vertices = 0;
  const ids = new Set(parts.map(part => part.id));
  for (const fragment of refined.pieces) {
    assert.ok(ids.has(fragment.partId));
    assert.equal(fragment.sourcePartId, descriptor.pieces[fragment.id].partId);
    assert.equal(fragment.firstVertex, descriptor.pieces[fragment.id].firstVertex);
  }
  for (const part of parts) part.node.traverse(mesh => {
    if (!mesh.isMesh) return;
    vertices += mesh.geometry.attributes.position.count;
    assert.ok(parts.includes(mesh.userData.part));
    assert.ok(mesh.geometry.attributes.uv && mesh.geometry.attributes.normal && mesh.geometry.attributes.color);
  });
  assert.equal(vertices, descriptor.vertexCount);
  const bounds = new T.Box3();
  for (const part of parts) bounds.union(new T.Box3().setFromObject(part.node));
  for (let axis = 0; axis < 3; axis++) {
    const name = ['x', 'y', 'z'][axis];
    assert.ok(Math.abs(bounds.min[name] - descriptor.provenance.worldBounds.min[axis]) < .0001);
    assert.ok(Math.abs(bounds.max[name] - descriptor.provenance.worldBounds.max[axis]) < .0001);
  }
});

test('refined building has continuous grounded load paths and remains stable before firing', async () => {
  const { parts } = await setup();
  const events = [];
  const solver = context.SkyfallCollapse.create(parts, {
    floorHeights: manifest.floorHeights,
    fracture: (part, contact) => { events.push(contact); part.gone = true; },
  });
  for (let frame = 0; frame < 90; frame++) solver.step(1 / 30);
  assert.equal(events.length, 0);
  assert.ok(parts.every(part => !part.active && !part.gone));
  for (const part of parts) {
    assert.equal(solver.assessPart(part).anchored, true);
    assert.ok(part.node.position.distanceTo(part.rest) < .00001);
  }
});

test('small-section release keeps exact fragment ownership and reset restores all poses', async () => {
  const { parts, descriptor: refined, model } = await setup();
  const manager = context.SkyfallStructuralFragments.create(model);
  manager.prepare(parts, refined, buffer);
  const chosen = parts.find(part => part.floor === 2 && part.cell === 0);
  const expected = refined.pieces.filter(piece => piece.partId === chosen.id).length;
  chosen.node.position.x += 1;
  chosen.node.rotation.z = .25;
  model.updateMatrixWorld(true);
  const released = manager.release(chosen, { direct: true, weapon: 'ball', direction: new T.Vector3(0, 0, -1) });
  assert.equal(released, expected);
  assert.equal(manager.stats().active, expected);
  assert.ok(model.children.filter(mesh => mesh.name.startsWith('ActualPCFragments_')).every(mesh => mesh.material.visible));
  for (const part of parts) {
    part.node.position.copy(part.rest);
    part.node.quaternion.copy(part.restQ);
    part.node.visible = true;
    part.active = part.gone = false;
  }
  manager.reset();
  assert.equal(manager.stats().active, 0);
  assert.ok(parts.every(part => part.node.position.equals(part.rest) && part.node.quaternion.equals(part.restQ)));
});

test('two visible material batches follow section poses while hidden proxies remain raycastable', async () => {
  const { parts, rendering, model } = await setup();
  assert.equal(rendering.batches.length, 2);
  const proxies = parts.flatMap(part => part.node.children);
  assert.ok(proxies.every(mesh => !mesh.material.visible));
  assert.ok(rendering.batches.every(mesh => mesh.material.visible));
  const ray = new T.Raycaster(new T.Vector3(0, 9, 30), new T.Vector3(0, 0, -1));
  const hits = ray.intersectObjects(proxies, false);
  assert.ok(hits.length > 0);
  assert.ok(parts.includes(hits[0].object.userData.part));

  const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader };
  rendering.batches[0].material.onBeforeCompile(shader);
  const poses = shader.uniforms.uStructurePoses.value.image.data;
  const part = hits[0].object.userData.part;
  part.node.position.x += .7;
  part.node.rotation.z = .3;
  rendering.update();
  assert.ok(Math.abs(poses[part.id * 8] - part.node.position.x) < .00001);
  assert.ok(Math.abs(poses[part.id * 8 + 6] - part.node.quaternion.z) < .00001);
  part.gone = true;
  rendering.update();
  assert.equal(poses[part.id * 8 + 3], 0);
  part.gone = false;
  rendering.update();
  assert.equal(poses[part.id * 8 + 3], 1);

  const highlight = context.SkyfallTargetHighlight.create(parts);
  const color = rendering.batches[0].material.color.clone();
  highlight.update(true);
  rendering.update();
  assert.notDeepEqual(rendering.batches[0].material.color, color);
  highlight.update(false);
  rendering.update();
  assert.deepEqual(rendering.batches[0].material.color, color);
  rendering.setQuality({ shadows: false });
  assert.ok(rendering.batches.every(mesh => !mesh.castShadow));
});
