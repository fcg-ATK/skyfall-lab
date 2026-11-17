'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { engine, T, context } = require('./helpers/engine-harness.cjs');

function seed() {
  vm.runInContext('Math.random=(()=>{let n=719;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}})()', context);
}

// A plane crossing alone cannot prove tunnelling: real facade openings and
// already broken cells are valid routes. Test the actual surviving triangles.
function rearMeshes(game) {
  const meshes = [];
  game.model.updateWorldMatrix(true, true);
  for (const part of game.parts) {
    if (part.cell >= 6 || part.gone || part.active) continue;
    part.node.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
  }
  return meshes;
}

// One chip with a known volume/velocity, using the production manager and
// actual GLB target. Rendering uses real typed geometry; GPU output is outside
// this CPU harness. A separate source avoids other released chips hiding the
// distinction between a heavy impact and many insignificant contacts.
function chip(game, { half = .25, x = -1.1232, y = 5.7337, z = -5.7, speed = 40 } = {}) {
  const scene = new T.Scene(), node = new T.Group();
  node.position.set(x, y, z);
  node.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  scene.add(node); scene.updateMatrixWorld(true);
  const source = { id: 9000, floor: 1, node, rest: node.position.clone(), restQ: node.quaternion.clone(), vel: new T.Vector3(), spin: new T.Vector3() };
  const sizes = { position: 9, normal: 9, uv: 6, color: 9, pieceId: 3 };
  const buffers = {}; let size = 0;
  for (const [name, length] of Object.entries(sizes)) {
    size = Math.ceil(size / 4) * 4;
    buffers[name] = { offset: size, length };
    size += length * (name === 'color' ? 1 : 4);
  }
  const bytes = new ArrayBuffer(size);
  new Float32Array(bytes, buffers.position.offset, 9).set([-half, -half, 0, half, -half, 0, 0, half, 0]);
  new Float32Array(bytes, buffers.normal.offset, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Uint8Array(bytes, buffers.color.offset, 9).fill(160);
  const descriptor = { version: 1, vertexCount: 3, triangleCount: 1, buffers,
    pieces: [{ id: 0, partId: source.id, kind: 'structure', center: [x, y, z], half: [half, half, half], firstVertex: 0, vertexCount: 3 }],
    materialRanges: [{ kind: 'structure', start: 0, count: 3 }] };
  const manager = context.SkyfallStructuralFragments.create(scene);
  manager.prepare([source], descriptor, bytes);
  const wall = game.parts.find(part => part.id === 26);
  const collider = context.SkyfallFragmentContact.create([wall]);
  const contacts = [];
  manager.setCollider(collider, event => {
    const result = game.fragmentImpact(event);
    contacts.push({ event, result });
    return result;
  });
  manager.release(source, { direct: false, energy: 0, velocity: new T.Vector3(0, 0, -speed) });
  return { manager, wall, contacts, collider };
}

test('rear-wall experience: an ordinary front rocket cannot send debris through intact rear triangles', async t => {
  seed();
  const game = await engine();
  const impact = game.fragmentImpact.bind(game);
  const contactCounts = { blocked: 0, breached: 0, rearFacadeBlocked: 0, rearFacadeBreached: 0, spentEnergy: 0 };
  game.fragmentImpact = event => {
    const outcome = impact(event);
    contactCounts[outcome.broken ? 'breached' : 'blocked']++;
    contactCounts.spentEnergy += outcome.spentEnergy || 0;
    if (event.point.z < -5.8 && Math.abs(event.normal.z) > .7)
      contactCounts[outcome.broken ? 'rearFacadeBreached' : 'rearFacadeBlocked']++;
    return outcome;
  };
  game.orbit.yaw = 0;
  Object.assign(game.aim, { x: 0, z: 7, height: 10, angle: 0 });
  assert.equal(game.traceAim().contacts[0].object.userData.part.id, 69);
  assert.equal(game.fire('rocket'), true);
  let previous = new Map(), elapsed = 0;
  const crossed = [], motionSnapshots = [];
  // Optional diagnosis may observe longer, without relaxing the normal
  // settlement assertion below. Keep even diagnostic runs finitely bounded.
  const diagnosticLimit = Number(process.env.REARWALL_DIAG_LIMIT);
  const observationLimit = Number.isFinite(diagnosticLimit) ? Math.min(20, Math.max(15, diagnosticLimit)) : 15;
  const captureMotion = () => ({ elapsed, state: game.state, damage: game.damage,
    stillTime: game.stillTime, damageQuietTime: game.damageQuietTime, fragmentStats: game.structuralFragments.stats(),
    members: game.parts.filter(part => part.active && !part.gone || motionSnapshots[0]?.members.some(member => member.id === part.id))
      .map(part => ({ id: part.id, floor: part.floor, phase: part.phase, active: part.active, gone: part.gone,
        position: part.node.position.toArray(), quaternion: part.node.quaternion.toArray(),
        velocity: part.vel.toArray(), spin: part.spin.toArray(), age: part.age })),
  });
  while (['flight', 'watch'].includes(game.state) && elapsed < observationLimit) {
    game.step(1 / 60);
    elapsed += 1 / 60;
    const current = game.structuralFragments.sample(null, 6000);
    const meshes = rearMeshes(game);
    for (const piece of current) {
      const before = previous.get(piece.id);
      if (!before || piece.settled || before.z <= -6.236 || piece.position.z > -6.236) continue;
      const delta = piece.position.clone().sub(before);
      const length = delta.length();
      if (length < 1e-8) continue;
      const hit = new T.Raycaster(before, delta.normalize(), 0, length).intersectObjects(meshes, false)
        .find(contact => contact.point.z < -5.8 && Math.abs(contact.face.normal.z) > .7);
      if (hit) crossed.push({ piece: piece.id, wall: hit.object.userData.part.id });
    }
    previous = new Map(current.map(piece => [piece.id, piece.position]));
    if (observationLimit > 12 && (!motionSnapshots.length && elapsed >= 12 - 1e-8 || motionSnapshots.length === 1 && elapsed >= 12.5 - 1e-8))
      motionSnapshots.push(captureMotion());
  }
  t.diagnostic(JSON.stringify({ damage: game.damage, elapsed, state: game.state, fractures: game.shotFractures.length, intactRearCrossings: crossed.length, ...contactCounts }));
  if (game.state !== 'ready') t.diagnostic(JSON.stringify({
    stillTime: game.stillTime, damageQuietTime: game.damageQuietTime, projectileVisible: game.projectile.visible,
    fragmentStats: game.structuralFragments.stats(),
    pendingBlasts: game.parts.filter(part => !part.gone && part.blast && Number.isFinite(part.delay)).map(part => part.id),
    movingMembers: game.parts.filter(part => part.active && !part.gone).map(part => ({
      id: part.id, floor: part.floor, phase: part.phase, position: part.node.position.toArray(),
      velocity: part.vel.toArray(), spin: part.spin.toArray(), displacement: part.node.position.distanceTo(part.rest),
    })),
  }));
  for (const snapshot of motionSnapshots) t.diagnostic(JSON.stringify({ motionSnapshot: snapshot }));
  if (motionSnapshots.length === 2) t.diagnostic(JSON.stringify({ halfSecondMotion: motionSnapshots[0].members.map(before => {
    const after = motionSnapshots[1].members.find(member => member.id === before.id);
    return { id: before.id, active: after?.active, gone: after?.gone,
      displacement: after ? Math.hypot(...after.position.map((value, index) => value - before.position[index])) : null,
      rotation: after ? new T.Quaternion().fromArray(before.quaternion).angleTo(new T.Quaternion().fromArray(after.quaternion)) : null };
  }) }));
  assert.equal(crossed.length, 0, `debris crossed intact rear triangles: ${JSON.stringify(crossed.slice(0, 6))}`);
  assert.equal(game.shotHits[0], 69, 'the ordinary projectile still reaches the selected facade');
  assert.equal(game.state, 'ready', 'contact resolution has a finite end and permits another shot');
  assert.ok(elapsed < 15, 'the collision-driven collapse must physically settle within its bounded observation window');
  assert.ok(game.parts.every(part=>part.gone||!part.active),'ready must represent an actual physical end, without frozen moving architecture');
  assert.ok(game.damage > 0 && game.damage < 50, `wall response preserves substantial surviving architecture, measured ${game.damage}%`);
  assert.equal(new Set(game.shotFractures.map(event => event.id)).size, game.shotFractures.length, 'each member breaks at most once');
});

test('rear-wall experience: a heavy real mesh impact breaks one local target using finite impact energy', async () => {
  seed();
  const game = await engine();
  const { manager, wall, contacts } = chip(game);
  manager.step(.08, []);
  assert.ok(contacts.length > 0, 'the actual wall mesh must create contact before damage');
  const { event, result } = contacts[0];
  assert.equal(event.targetPartId, 26);
  assert.ok(event.mass > 12 && event.normalSpeed > 3);
  assert.equal(wall.gone, true, 'a large energetic chunk must visibly fracture the contacted wall');
  assert.equal(result.broken, true);
  assert.ok(result.spentEnergy > 0 && result.spentEnergy <= event.kineticEnergy, 'wall failure spends finite available impact energy');
  assert.deepEqual(Array.from(game.shotFractures, fracture => fracture.id), [26], 'one local hit cannot clear an entire floor or facade');
});

test('rear-wall experience: a tiny fast chip hits and rebounds without becoming structural damage', async () => {
  seed();
  const game = await engine();
  const { manager, wall, contacts } = chip(game, { half: .025, speed: 60 });
  manager.step(.05, []);
  assert.equal(contacts.length, 1);
  assert.ok(contacts[0].event.mass < 1 && contacts[0].event.normalSpeed > 30, 'small real mass, despite a fast incoming speed');
  assert.equal(wall.gone, false);
  assert.equal(game.shotFractures.length, 0, 'visual chip impacts cannot accumulate member-sized damage');
  const piece = manager.sample(9000, 1)[0];
  assert.ok(piece.position.z > -6.24 && piece.velocity.z >= 0, 'an undamaged wall must still block the chip');
  for (let i = 0; i < 60; i++) manager.step(1 / 60, []);
  assert.equal(contacts.length, 1, 'resting/repeated overlap cannot award the same contact twice');
  assert.equal(game.shotFractures.length, 0);
});

test('rear-wall experience: an authored facade gap remains a physical miss and cannot damage its cell', async () => {
  seed();
  const game = await engine();
  // This ray crosses the live part26 envelope but no actual triangle; a cell
  // bounding box would turn this existing opening into an invented wall.
  const start = new T.Vector3(-1.4, 5.05, -5.7), direction = new T.Vector3(0, 0, -1);
  assert.equal(new T.Box3().setFromObject(game.parts[26].node).containsPoint(start), true, 'the gap is inside the live member broadphase bounds');
  assert.equal(new T.Raycaster(start, direction, 0, 1.4).intersectObjects(rearMeshes(game), false).length, 0);
  const { manager, wall, contacts } = chip(game, { half: .001, x: -1.4, y: 5.05, speed: 60 });
  manager.step(.03, []);
  assert.equal(contacts.length, 0, 'an actual gap must not emit wall impact events');
  assert.equal(wall.gone, false);
  assert.equal(game.shotFractures.length, 0);
  assert.ok(manager.sample(9000, 1)[0].position.z < -7.1, 'the missed chip keeps its ballistic travel through the opening');
});
