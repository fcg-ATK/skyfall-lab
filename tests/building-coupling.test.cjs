'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const {engine, T, context, advance} = require('./helpers/engine-harness.cjs');

// These use the real refined building and ordinary fire/step path. CPU pose
// checks cannot establish browser FPS or how convincing the rendered image is.
// Verify coherent intact movement and pose uploads while real bearing walls
// constrain how far a released patch can translate or rotate.
async function observeShot({weapon, yaw, aim}) {
  vm.runInContext('Math.random=(()=>{let n=719;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}})()', context);
  const game = await engine();
  game.orbit.yaw = yaw; Object.assign(game.aim, aim);
  const contact = game.traceAim().contacts[0];
  assert.ok(contact, 'ordinary aim must reach actual building triangles');
  assert.equal(game.fire(weapon), true);
  const weaponTargets=new Set(),wallTargets=[],impact=game.impact,fragmentImpact=game.fragmentImpact;
  game.impact=function(point,part){
    impact.call(this,point,part);
    for(const id of this.shotHits)weaponTargets.add(id);
    for(const target of this.parts)if(target.blast)weaponTargets.add(target.id);
  };
  game.fragmentImpact=function(event){const result=fragmentImpact.call(this,event);if(result.broken)wallTargets.push(event.targetPartId);return result;};
  const frames = [], rendered = new Set();
  let elapsed = 0;
  while (['flight', 'watch'].includes(game.state) && elapsed < 30) {
    game.step(1 / 30); elapsed += 1 / 30;
    const frame = [];
    for (const p of game.parts) {
      assert.ok([...p.node.position.toArray(), ...p.node.quaternion.toArray()].every(Number.isFinite), 'architectural poses remain finite throughout contact chains');
      if (p.gone) continue;
      const distance = p.node.position.distanceTo(p.rest);
      const up = new T.Vector3(0, 1, 0).applyQuaternion(p.node.quaternion);
      const restUp = new T.Vector3(0, 1, 0).applyQuaternion(p.restQ);
      const tilt = up.angleTo(restUp) * 180 / Math.PI;
      if (distance <= .08 && tilt <= .5) continue;
      frame.push({id:p.id, cell:p.cell, floor:p.floor, distance, tilt,
        position:p.node.position.clone(), deltaQ:p.node.quaternion.clone().multiply(p.restQ.clone().invert())});
      if (weaponTargets.has(p.id) || rendered.has(p.id) || distance <= .08 || tilt <= .5) continue;
      game.render();
      const shader = {uniforms:{}, vertexShader:T.ShaderLib.standard.vertexShader};
      game.structureDetail.batches[0].material.onBeforeCompile(shader);
      const poses = shader.uniforms.uStructurePoses.value.image.data;
      assert.equal(poses[p.id * 8 + 3], 1, 'the moving intact neighbor remains visible architecture');
      for (const [i, value] of p.node.position.toArray().entries())
        assert.ok(Math.abs(poses[p.id * 8 + i] - value) < 1e-5, 'batched architecture receives the moving neighbor position');
      for (const [i, value] of p.node.quaternion.toArray().entries())
        assert.ok(Math.abs(poses[p.id * 8 + 4 + i] - value) < 1e-6, 'batched architecture receives the moving neighbor rotation');
      rendered.add(p.id);
    }
    frames.push(frame);
  }
  assert.equal(game.shotHits[0], contact.object.userData.part.id);
  const moving = game.parts.filter(p => p.active && !p.gone).map(p => {
    const prior = frames.at(-31)?.find(frame => frame.id === p.id);
    return {id:p.id, position:p.node.position.toArray(), velocity:p.vel.toArray(), spin:p.spin.toArray(),
      lastSecondTravel:prior?p.node.position.distanceTo(prior.position):null};
  });
  assert.equal(game.state, 'ready', 'a local collapse settles and permits another normal shot: ' + JSON.stringify({elapsed,damage:game.damage,fractures:game.shotFractures,moving}));
  assert.ok(elapsed < 30, `wall-constrained contact chains must reach a physical end before the observation guard, got ${elapsed}`);
  assert.ok(!game.parts.some(p => p.active && !p.gone), 'ready must not conceal continuing architectural movement');
  assert.equal(new Set(game.shotFractures.map(e => e.id)).size, game.shotFractures.length, 'contact must not fracture one member twice');
  assert.equal(game.score,game.shotFractures.length*100+game.ammoBonus,'all direct and secondary physical fractures score once');
  assert.deepEqual(Array.from(game.shotFractures.filter(e=>e.cause==='fragment-impact'),e=>e.id),wallTargets,'secondary wall damage requires successful real fragment contacts');
  return {game, contact, frames, weaponTargets, rendered, elapsed};
}

function assertCoupledArea(shot) {
  const {game, frames, weaponTargets, rendered, contact} = shot;
  // A planned hit is a particular member, not every upper storey in its column.
  // Real bearing walls can arrest a balanced patch after about one degree of
  // rotation. Require a measurable tilt plus >8cm travel, not an open-air fall.
  const neighborMoves = frames.flat().filter(p => !weaponTargets.has(p.id) && p.distance > .08 && p.tilt > .5);
  assert.ok(neighborMoves.length, 'lost support must translate and tilt intact members outside the actual weapon target set');
  assert.ok(neighborMoves.some(p => rendered.has(p.id)), 'a non-direct moving member must reach the visible geometry batch before it fractures');
  const runs = new Map(); let longest = 0;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index].filter(p => p.distance > .08);
    for (let i = 0; i < frame.length; i++) for (let j = i + 1; j < frame.length; j++) {
      const a = frame[i], b = frame[j];
      if (a.floor !== b.floor || a.cell === b.cell || weaponTargets.has(a.id) && weaponTargets.has(b.id)) continue;
      const separation = game.parts[a.id].rest.distanceTo(game.parts[b.id].rest);
      if (separation < 3 || separation > 4 || a.deltaQ.angleTo(b.deltaQ) > .02 || Math.abs(a.position.distanceTo(b.position) - separation) > .06) continue;
      const key = a.id + ':' + b.id, prior = runs.get(key);
      const run = prior?.last === index - 1 ? prior.length + 1 : 1;
      runs.set(key, {last:index, length:run}); longest = Math.max(longest, run);
    }
  }
  assert.ok(longest >= 3, `adjacent intact cells including a non-direct neighbor must move coherently for at least 0.1 seconds, got ${longest} frames`);
  const remote = game.parts.filter(p => p.floor > 1 && Math.hypot(p.rest.x - contact.point.x, p.rest.z - contact.point.z) > 10);
  assert.ok(remote.some(p => !p.gone && !p.active && p.node.position.distanceTo(p.rest) < 1e-8 && p.node.quaternion.angleTo(p.restQ) < 1e-8), 'a healthy distant upper region survives in its original pose');
  assert.ok(game.damage < 70, 'one local failure must not erase the whole healthy building');
}

test('building coupling: the default meteor moves a visible coherent area beyond its directly targeted members', async () => {
  const shot = await observeShot({weapon:'meteor', yaw:.68, aim:{x:0, z:0, height:10, angle:0}});
  assertCoupledArea(shot);
  shot.game.reset(); advance(shot.game, .5);
  assert.equal(shot.game.state, 'ready');
  assert.equal(shot.game.damage, 0);
  assert.equal(shot.game.shots, 0);
  assert.ok(shot.game.parts.every(p => !p.gone && !p.active && p.node.visible && p.node.position.distanceTo(p.rest) < 1e-8 && p.node.quaternion.angleTo(p.restQ) < 1e-8), 'rebuilding removes every recruited connection and old motion');
});

test('building coupling: a normal center rocket draws intact adjacent bays into the local collapse', async () => {
  assertCoupledArea(await observeShot({weapon:'rocket', yaw:0, aim:{x:0, z:7, height:10, angle:0}}));
});

test('building coupling: precision contacts and their real secondary impacts preserve a supported residual', async () => {
  const {game, contact} = await observeShot({weapon:'ball', yaw:0, aim:{x:-1.7, z:7, height:10, angle:0}});
  assert.equal(game.shotHits.length, 2, 'the ball still penetrates two real structural members');
  assert.deepEqual(Array.from(game.shotFractures.filter(e=>e.cause==='impact'||e.cause==='penetration'),e=>e.id),Array.from(game.shotHits));
  assert.equal(game.shotFractures.filter(e=>e.cause==='blast').length,0,'a precision ball cannot schedule a lateral explosion');
  const healthy=game.parts.filter(p=>p.floor>2&&!p.gone&&Math.hypot(p.rest.x-contact.point.x,p.rest.z-contact.point.z)>10);
  assert.ok(healthy.some(p=>{
    const support=game.collapse.assessPart(p);
    return !p.active&&p.node.position.distanceTo(p.rest)<1e-8&&p.node.quaternion.angleTo(p.restQ)<1e-8&&support.anchored&&support.load<support.capacity;
  }),'a distant upper member retains its original pose and a healthy grounded bearing path');
});
