'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { engine, T, context, advance } = require('./helpers/engine-harness.cjs');

// Actual refined GLB geometry, ordinary aim/fire/step flow. The harness does
// not render pixels; pose-texture checks below cover the CPU rendering contract.
async function shotAt(x, height, weapon = 'rocket') {
  vm.runInContext('Math.random=(()=>{let n=719;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}})()', context);
  const game = await engine();
  game.orbit.yaw = 0;
  Object.assign(game.aim, { x, z: 7, height, angle: 0 });
  const contact = game.traceAim().contacts[0];
  assert.ok(contact, 'the selected facade must contain a real triangle');
  const target = contact.object.userData.part;
  assert.equal(game.fire(weapon), true);
  const weaponTargets=new Set(),bridgeSnapshots=[],wallTargets=[],impact=game.impact,fragmentImpact=game.fragmentImpact;
  game.impact=function(point,part){
    const before=this.shotHits.length;impact.call(this,point,part);
    for(const id of this.shotHits)weaponTargets.add(id);
    for(const p of this.parts)if(p.blast)weaponTargets.add(p.id);
    if(this.shotHits.length>before)bridgeSnapshots.push({contactId:part.id,bridges:this.collapse.diagnostics().flatMap(row=>row.bridgeSpans).map(bridge=>({...bridge,anchors:[...bridge.anchors],bearing:this.collapse.assessPart(bridge.id)}))});
  };
  game.fragmentImpact=function(event){const result=fragmentImpact.call(this,event);if(result.broken)wallTargets.push(event.targetPartId);return result;};
  const activeIds = new Set(), activeFloors = new Set(),motionSamples=[],renderedMotion=new Set();
  let elapsed = 0, firstCompression = false, preContactTilt = 0, renderedLean = false;
  const up = new T.Vector3(), restUp = new T.Vector3();
  // Real wall contacts can spend several seconds carrying/sliding an intact
  // patch before its next compression. Bound the observation, not the physics.
  while (['flight', 'watch'].includes(game.state) && elapsed < 30) {
    game.step(1 / 30);
    elapsed += 1 / 30;
    firstCompression ||= game.shotFractures.some(event => event.cause === 'compression');
    for (const part of game.parts) {
      assert.ok([...part.node.position.toArray(), ...part.node.quaternion.toArray()].every(Number.isFinite), 'all structural poses stay finite');
      if (!part.active || part.gone) continue;
      activeIds.add(part.id);
      activeFloors.add(part.floor);
      up.set(0, 1, 0).applyQuaternion(part.node.quaternion);
      restUp.set(0, 1, 0).applyQuaternion(part.restQ);
      const tilt = up.angleTo(restUp) * 180 / Math.PI,drop=part.rest.y-part.node.position.y;
      motionSamples.push({id:part.id,drop,tilt});
      if(!firstCompression)preContactTilt = Math.max(preContactTilt, tilt);
      const visibleDescent=drop>.03&&tilt>.5&&!renderedMotion.has(part.id);
      if ((!firstCompression&&!renderedLean&&tilt>5)||visibleDescent) {
        game.render();
        const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader };
        game.structureDetail.batches[0].material.onBeforeCompile(shader);
        const poses = shader.uniforms.uStructurePoses.value.image.data;
        assert.equal(poses[part.id * 8 + 3], 1, 'leaning architecture remains visible before it breaks');
        for (const [index, value] of part.node.quaternion.toArray().entries())
          assert.ok(Math.abs(poses[part.id * 8 + 4 + index] - value) < 1e-6, 'visible batch must use the actual leaning quaternion');
        for (const [index, value] of part.node.position.toArray().entries())
          assert.ok(Math.abs(poses[part.id * 8 + index] - value) < 1e-5, 'visible batch must use the actual descending position');
        if(visibleDescent)renderedMotion.add(part.id);
        if(!firstCompression&&tilt>5)renderedLean = true;
      }
    }
  }
  const directCells = [...new Set([...weaponTargets].map(id=>game.parts[id].cell))].sort((a, b) => a - b);
  assert.equal(game.shotHits[0], target.id, 'normal projectile travel must reach the selected structural cell');
  assert.ok(['ready','finished'].includes(game.state), 'a shot must reach its natural playable or cleared end');
  assert.ok(elapsed < 30, 'structural motion must settle without the observation timeout');
  assert.ok(game.parts.every(part => part.gone || !part.active), 'ready must expose physically settled architecture');
  assert.ok(game.damage > 0 && game.damage <= 100, 'only actual physical damage contributes to the report');
  assert.equal(new Set(game.shotFractures.map(event => event.id)).size, game.shotFractures.length, 'each physical member fractures once');
  assert.equal(game.score,game.shotFractures.length*100+game.ammoBonus);
  assert.deepEqual(Array.from(game.shotFractures.filter(e=>e.cause==='fragment-impact'),e=>e.id),wallTargets,'wall secondary fractures must have actual successful collision callbacks');
  if(game.state==='ready')assert.ok(game.parts.some(part=>{
    if(part.gone)return false;const bearing=game.collapse.assessPart(part);
    return bearing.anchored&&bearing.load<bearing.capacity;
  }), 'surviving structure retains a healthy grounded load path');
  else assert.equal(game.damage,100,'one accepted shot finishes the round only when it physically clears the building');
  assert.equal(game.events.filter(e=>e.name==='shotFinished'||e.name==='finished').length,1);
  return { game, target, directCells, activeIds, activeFloors, preContactTilt, renderedLean, elapsed, bridgeSnapshots,motionSamples,renderedMotion };
}

test('collapse experience: an ordinary corner rocket releases a compact connected patch that visibly leans before compression', async () => {
  const shot = await shotAt(-8, 10);
  assert.equal(shot.target.id, 66);
  assert.ok(shot.directCells.length >= 1 && shot.directCells.length <= 4, 'the rocket keeps a compact directly hit column footprint');
  assert.ok(shot.activeIds.size > shot.directCells.length, 'the removed bearings must release multiple upper storeys');
  assert.ok(shot.preContactTilt > 5, `the unsupported mass must visibly lean in open air, measured ${shot.preContactTilt} degrees`);
  assert.equal(shot.renderedLean, true);
  assert.ok(shot.game.damage<50,'this elevated corner rocket leaves a substantial residual');
});

test('collapse experience: moving the same rocket between center and low corner changes the actual falling footprint', async () => {
  const center = await shotAt(-1.7, 10);
  const low = await shotAt(-8, 2);
  assert.equal(center.target.id, 68);
  assert.equal(low.target.id, 18);
  assert.notDeepEqual(center.directCells, low.directCells, 'different contact points must retain their own compact blast footprints');
  assert.ok(low.activeFloors.has(1) && low.activeFloors.has(5), 'loss of a low bearing releases the actual supported stack');
  assert.ok(low.activeIds.size > low.directCells.length);
  assert.equal(center.game.shots, 1);
  assert.equal(low.game.shots, 1);
  assert.ok(center.game.damage<50,'the supported central rocket contact preserves substantial architecture');
});

test('collapse experience: rebuilding after a real leaning collapse removes all latent structural motion', async () => {
  const { game } = await shotAt(-8, 10);
  game.reset();
  advance(game, .5);
  assert.equal(game.state, 'ready');
  assert.equal(game.damage, 0);
  assert.equal(game.score, 0);
  assert.equal(game.shots, 0);
  assert.ok(game.parts.every(part => !part.active && !part.gone && part.node.visible));
  assert.ok(game.parts.every(part => part.node.position.distanceTo(part.rest) < 1e-8 && part.node.quaternion.angleTo(part.restQ) < 1e-8), 'no old hinge may disturb a rebuilt member');
});

test('collapse experience: ball contacts bridge on opposing bearings before real secondary impacts can release them', async () => {
  const center = await shotAt(-1.7, 10, 'ball');
  const corner = await shotAt(-8, 10, 'ball');
  assert.deepEqual(Array.from(center.game.shotHits), [68, 56], 'the central ball must penetrate two real facade/interior cells');
  assert.deepEqual(Array.from(corner.game.shotHits), [66, 48]);
  assert.equal(center.game.shotFractures.filter(e=>e.cause==='impact'||e.cause==='penetration').length,2);
  assert.equal(center.game.shotFractures.filter(e=>e.cause==='blast').length,0,'ball rubble cannot become another lateral blast');
  // The first slab can lose an anchor to real rubble before the second projectile
  // contact. Preserve the bridge evidence at each actual contact boundary.
  const bridges = center.bridgeSnapshots.flatMap(snapshot=>snapshot.bridges);
  for (const id of [80, 92]) {
    const bridge = bridges.find(row => row.id === id);
    assert.ok(bridge && bridge.anchors.length === 2, 'each retained slab needs two actual opposing anchors');
    assert.ok(bridge.span > 3.4 && bridge.span < 3.5, 'bridge evidence must come from the real refined grid');
    const bearing = bridge.bearing;
    assert.equal(bearing.reason, 'bridged');
    assert.equal(bearing.anchored, true);
    assert.ok(bearing.load < bearing.capacity, 'retained architecture must still satisfy bearing capacity');
  }
  const retained = center.game.parts.filter(part => part.floor > 2&&!part.gone);
  assert.ok(retained.some(part=>{
    const bearing=center.game.collapse.assessPart(part);
    return !part.active&&part.node.position.distanceTo(part.rest)<1e-8&&bearing.anchored&&bearing.load<bearing.capacity;
  }),'real secondary collisions leave a supported healthy upper residual');
  assert.ok(corner.activeIds.size >= 6, 'the corner lacks the central shot\'s opposing anchors');
  assert.ok(corner.motionSamples.some(p=>p.drop>.03&&p.tilt>.5&&corner.renderedMotion.has(p.id)), 'the released intact corner visibly descends and leans before any later crushing');
  const crushed=corner.game.shotFractures.filter(e=>['compression','side-crush','side-impact'].includes(e.cause));
  assert.ok(crushed.length,'the released corner spends real contact work in its later structural collapse');
  for(const event of crushed){
    const part=corner.game.parts[event.id];
    assert.ok(Number.isFinite(part.crushEnergy)&&part.crushEnergy>0);
    assert.ok(part.hitPoint&&part.hitPoint.toArray().every(Number.isFinite),'crushing records an actual finite contact point');
  }
  assert.ok(corner.game.damage>center.game.damage,'the corner loss of opposing bearings produces a larger actual chain reaction');
  for(const shot of [center,corner]){
    if(shot.game.state==='finished')shot.game.reset();
    shot.game.aim.height=21.5;assert.equal(shot.game.retargetAim(),true);
    const shots=shot.game.shots,score=shot.game.score;
    assert.equal(shot.game.fire('ball'),true,'a natural end or rebuild accepts another real shot');
    assert.equal(shot.game.state,'flight');assert.equal(shot.game.shots,shots+1);assert.equal(shot.game.score,score);
  }
});
