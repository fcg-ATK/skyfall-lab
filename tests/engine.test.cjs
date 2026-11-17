'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const physics=require('../dist/physics.js');
const {engine,advance,T,context,makeCanvas,root,imageSize}=require('./helpers/engine-harness.cjs');

test('optional streetscape images cannot keep an otherwise loaded building behind the spinner', async () => {
  const game = new context.SkyfallEngine(makeCanvas());
  game.environment.ready = new Promise(() => {});
  let timer;
  try {
    await Promise.race([game.load(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('optional images blocked startup')), 2000); })]);
    assert.equal(game.loaded, true);
    assert.equal(game.parts.length, new Set(game.parts.map(part => part.floor + ':' + part.cell)).size);
    assert.ok(game.parts.length > game.manifest.pieces.length, 'the preview must refine the source structural regions');
  } finally { clearTimeout(timer); }
});

function resourceCounts(game) {
  const geometries = new Set(), materials = new Set(), textures = new Set(); let objects = 0;
  game.scene.traverse(n => {
    objects++;
    if (n.geometry) geometries.add(n.geometry);
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      for (const uniform of Object.values(m.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
    });
  });
  if (game.scene.environment) textures.add(game.scene.environment);
  return { objects, geometries: geometries.size, materials: materials.size, textures: textures.size };
}

test('preview: each destroyed chunk scores once and landing effects cannot farm points', async () => {
  const game = await engine(), part = game.parts[0];
  game.fracturePart(part); game.fracturePart(part);
  assert.equal(game.score, 100);
  for (let i=0;i<3;i++) { game.time += 1; game.landing({point:part.rest.clone(),partId:part.id,floor:part.floor,energy:1}); }
  assert.equal(game.score, 100);
  game.fracturePart(game.parts[1]); assert.equal(game.score, 200);
});

test('pending blast or projectile cannot return to ready early', async()=>{
 const g=await engine();g.state='watch';const p=g.parts[0];p.blast=true;p.delay=g.time+1;advance(g,.8);assert.equal(g.state,'watch');
 const h=await engine();h.fire('ball');advance(h,.2);assert.equal(h.state,'flight');assert.equal(h.events.filter(e=>e.name==='shotFinished').length,0);
});

test('building contains self-contained mobile textures with real UV coordinates', async () => {
  const bytes = fs.readFileSync(path.join(root, 'assets/mobile-building.glb'));
  assert.ok(bytes.length < 10 * 1024 * 1024, 'building download must remain mobile-sized');
  const jsonLength = bytes.readUInt32LE(12);
  const model = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryStart = 20 + jsonLength + 8;
  assert.ok(model.images?.length >= 2, 'keep actual concrete colour and surface detail maps');
  for (const image of model.images) {
    assert.equal(image.uri, undefined, 'building textures must not depend on another host');
    const view = model.bufferViews[image.bufferView];
    assert.ok(view && view.byteLength > 128);
    const { width, height } = imageSize(bytes.subarray(binaryStart + (view.byteOffset || 0), binaryStart + (view.byteOffset || 0) + view.byteLength));
    assert.ok(width > 0 && width <= 2048 && height > 0 && height <= 2048);
  }
  const game = await engine();
  const solidMaterials = new Set(), glassMaterials = new Set();
  let triangles = 0, batches = 0;
  game.model.traverseVisible(node => {
    if (!node.isMesh || !node.material.visible) return;
    batches++;
    triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
    if (/glass/i.test(node.name + ' ' + node.material.name)) glassMaterials.add(node.material);
    else {
      solidMaterials.add(node.material);
      assert.ok(node.geometry.attributes.uv?.count > 0, 'solid geometry needs projected texture coordinates');
    }
  });
  assert.ok([...solidMaterials].some(m => m.map && m.normalMap));
  assert.ok(glassMaterials.size > 0 && [...glassMaterials].every(m => !solidMaterials.has(m)), 'glazing remains a different material');
  assert.equal(game.structureDetail.batches.length, 2, 'small structural sections must retain two visible material batches');
  assert.ok(game.structureDetail.batches.every(mesh => mesh.visible && mesh.material.visible));
  assert.ok(batches <= 3, `building and its static remainder exceed three visible batches: ${batches}`);
  // The old 140,000 triangle budget used simplified exterior shells. Closed
  // fracture geometry now retains 194,181 authored triangles plus static details.
  assert.ok(triangles <= 210000, `closed building triangle budget exceeded: ${triangles}`);
});

test('restored environment has bounded batches and lighting keeps directional contrast', async () => {
  const game = await engine();
  const group = game.scene.getObjectByName('mobile_environment_v2');
  assert.ok(group, 'the new streetscape must actually be attached to the scene');
  let batches = 0, triangles = 0;
  group.traverse(node => {
    if (!node.isMesh) return;
    batches += Array.isArray(node.material) ? node.material.length : 1;
    const count = node.geometry.index?.count || node.geometry.attributes.position.count;
    triangles += count / 3 * (node.isInstancedMesh ? node.count : 1);
  });
  assert.ok(batches <= 24, `environment batches exceed mobile budget: ${batches}`);
  assert.ok(triangles <= 50000, `environment triangles exceed mobile budget: ${triangles}`);
  assert.ok(game.renderer.options.antialias);
  const ambient = game.scene.children.find(node => node.isHemisphereLight);
  assert.ok(ambient.intensity < game.sun.intensity * 0.55, 'ambient light must not wash out the directional shading');
  assert.ok(game.scene.environment, 'glass needs a reflected environment');
});

test('real optimized GLB loads into finer structural cells with all original PC fragments', async () => {
  const game = await engine();
  assert.equal(game.parts.length, new Set(game.parts.map(part => part.floor + ':' + part.cell)).size);
  assert.ok(game.parts.length > game.manifest.pieces.length, 'the preview must refine the source structural regions');
  assert.equal(game.loaded, true);
  assert.equal(game.state, 'ready');
  const fragments = game.structuralFragments.stats();
  assert.equal(fragments.prepared, true);
  assert.equal(fragments.pieceCount, 5633);
  assert.equal(fragments.active, 0);
  assert.equal(game.erosion, undefined, 'PC collapse must not retain the stationary shader-erasure manager');
  for (const p of game.parts) {
    assert.ok(p.node && p.node.children.length);
    assert.ok(Math.abs(p.node.position.x - p.center.x) < 0.001);
    assert.ok(Math.abs(p.node.position.y - p.center.y) < 0.001);
    assert.ok(Math.abs(p.node.position.z - p.center.z) < 0.001);
    assert.equal(p.crumbleProgress, 0);
    assert.equal(p.phase, 'intact');
  }
});
for (const weapon of ['rocket', 'meteor', 'ball']) {
  test(`a horizontal ${weapon} above the roof cannot trigger damage or score`, async () => {
    const game = await engine(); game.aim.height = 30;
    assert.equal(game.fire(weapon), false);
    advance(game, 8);
    assert.equal(game.damage, 0); assert.equal(game.score, 0);
    assert.equal(game.structuralFragments.stats().active, 0);
    assert.ok(game.parts.every(p => p.phase === 'intact'));
    assert.ok(!game.events.some(e => e.name === 'impact'));
    assert.ok(game.events.some(e => e.name === 'emptyAim'));
    assert.equal(game.remainingAmmo,4);
    assert.equal(game.state, 'ready');
  });
}
test('real triangle contact starts rocket damage and completes a finite round', async () => {
  const game = await engine(); game.fire('rocket');
  advance(game, 15);
  assert.ok(game.events.some(e => e.name === 'impact'));
  assert.ok(game.damage > 0 && game.score > 0);
  assert.equal(game.state, 'ready');
  assert.equal(game.shot.stopped, true, 'the rocket detonates at its first actual contact');
  assert.equal(game.shot.penetrated.size, 1);
  assert.ok(game.parts.filter(p => p.active).every(p => p.gone));
});
for (const [weapon, angle] of [['rocket', 0], ['meteor', 0], ['meteor', 20], ['ball', 0]]) {
  test(`${weapon} at ${angle} degrees respects its physical contact budget`, async () => {
    const game = await engine(); game.aim.angle = angle;
    assert.equal(game.fire(weapon), true);
    advance(game, 4);
    assert.equal(game.shot.hit, true, 'only an actual building contact starts destruction');
    const budget = weapon === 'ball' ? 2 : 1;
    assert.equal(game.shot.penetrated.size, budget, 'only distinct contacted members consume penetration energy');
    assert.equal(game.shot.stopped, true, 'the projectile must stop after its contact budget is exhausted');
    assert.ok(game.shot.traveled < 60, 'detonated projectiles cannot continue through the entire map');
    assert.equal(game.events.filter(e => e.name === 'impact').length, 1);
    assert.ok(game.damage > 0);
  });
}
test('pick still works after a completed shot and rebuilding', async () => {
  const game = await engine(); assert.equal(game.pick(195, 422), true);
  game.fire('rocket'); advance(game, 15); game.reset(); game.render();
  assert.equal(game.pick(195, 422), true);
});
test('the scene contains no people before, during, or after destruction', async () => {
  const game = await engine();
  function assertNoPeople() {
    assert.equal(game.peopleMesh, undefined, 'the pedestrian instanced mesh must be removed');
    assert.ok(!game.people || game.people.length === 0, 'no pedestrian simulation may remain active');
    game.scene.traverse(node => {
      assert.ok(!/people|pedestrian|person(?:_|$)/i.test(node.name), `unexpected pedestrian object: ${node.name}`);
    });
  }
  assertNoPeople(); game.fire('rocket'); advance(game, 2); game.render();
  assertNoPeople(); game.reset(); game.render(); assertNoPeople();
});
test('rendering alone never advances falling parents, actual fragments, or particles', async () => {
  const game = await engine(); game.fire('rocket'); advance(game, 2);
  assert.equal(game.shot.hit, true);
  const snapshot = () => ({
    time: game.time,
    parts: game.parts.map(p => [p.phase, p.crumbleProgress, p.node.position.x, p.node.position.y, p.node.position.z]),
    structural: game.parts.flatMap(p => game.structuralFragments.sample(p.id, 3)
      .map(f => [f.id, ...f.position.toArray(), ...f.quaternion.toArray(), ...f.velocity.toArray(), f.settled])),
    dust: game.dust.map(p => [p.p.x, p.p.y, p.p.z, p.age]),
    powder: [game.powder.stats().active, game.powder.stats().spawned],
  });
  const before = snapshot();
  for (let i = 0; i < 50; i++) game.render();
  assert.deepEqual(snapshot(), before);
});
test('projectile nose points along its velocity instead of backwards', async () => {
  const game = await engine(); game.fire('rocket');
  const nose = new T.Vector3(0, 0, -1).applyQuaternion(game.projectile.quaternion);
  assert.ok(nose.dot(game.shot.dir) > 0.99);
});
test('supported upward aim never spawns the projectile underground', async () => {
  const game = await engine(); game.aim.angle = -35; game.aim.height = 7;
  game.fire('rocket');
  assert.ok(game.projectile.position.y >= 0, 'negative launch angle currently starts below the ground');
});
test('repeated destruction and reset stays inside fixed pools without scene growth', async () => {
  const game = await engine(); const initial = resourceCounts(game);
  game.setQuality('low');
  for (let round = 0; round < 4; round++) {
    game.fire('meteor');
    advance(game, 15, g => {
      assert.ok(g.fragments.length <= g.profile.fragments);
      assert.ok(g.dust.length <= g.profile.dust);
      const powder = g.powder.stats();
      assert.ok(powder.active <= powder.capacity && powder.capacity <= powder.allocated);
      const structural = g.structuralFragments.stats();
      assert.ok(structural.active <= structural.pieceCount && structural.pieceCount === 5633);
    });
    game.reset(); game.render();
    assert.equal(game.fragments.length, 0); assert.equal(game.dust.length, 0);
    assert.equal(game.fragmentMesh.count, 0); assert.equal(game.dustMesh.count, 0);
    assert.equal(game.powder.stats().active, 0); assert.equal(game.powder.stats().spawned, 0);
    assert.equal(game.structuralFragments.stats().active, 0);
    assert.equal(game.structuralFragments.stats().moving, 0);
    assert.equal(game.structuralFragments.stats().settled, 0);
    assert.equal(game.damage, 0); assert.equal(game.score, 0);
    assert.ok(game.parts.every(p => !p.active && !p.gone && p.phase === 'intact' && p.crumbleProgress === 0 && p.node.visible && p.delay === Infinity));
    assert.ok(game.parts.every(p => p.node.position.distanceTo(p.rest) < 1e-6 && p.node.quaternion.angleTo(p.restQ) < 1e-6));
    assert.deepEqual(resourceCounts(game), initial);
  }
});
test('all quality modes respect their maximum mobile pixel and particle budgets', async () => {
  const game = await engine();
  for (const mode of ['low', 'balanced', 'high']) {
    game.setQuality(mode);
    assert.ok(game.canvas.width * game.canvas.height <= game.profile.maxPixels);
    assert.equal(game.renderer.shadowMap.enabled, game.profile.shadows);
    game.addDust(new T.Vector3(), 500); game.addFragments(new T.Vector3(), 600, 1);
    assert.equal(game.dust.length, game.profile.dust);
    assert.equal(game.fragments.length, game.profile.fragments);
  }
  game.setQuality('low');
  assert.ok(game.dust.length <= 45 && game.fragments.length <= 100);
});

test('a local rocket hit schedules its blast and at most two contiguous lower bearings', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket');
  while (!game.shot.hit && game.time < 2) game.step(1 / 120);
  const hitFloor = game.parts.find(p => game.shot.penetrated.has(p.id)).floor;
  const planned=game.parts.filter(p=>Number.isFinite(p.delay));
  const primary=game.parts[game.shotHits[0]];
  assert.ok(planned.every(p=>p.floor===hitFloor||([hitFloor-1,hitFloor-2].includes(p.floor)&&p.cell===primary.cell)));
  assert.equal(planned.filter(p=>p.floor===hitFloor-1).length,1);
  assert.equal(planned.filter(p=>p.floor===hitFloor-2).length,1);
});

test('PC direct contact fractures the struck parent on the contact frame', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket');
  while (!game.shot.hit && game.time < 2) game.step(1 / 120);
  assert.ok(game.shot.hit, 'the fixture must reach an actual triangle');
  const part = game.parts.find(p => game.shot.penetrated.has(p.id));
  assert.ok(part);
  assert.equal(part.node.visible, false, 'PC direct contact immediately replaces the parent with its actual fragments');
  assert.equal(part.phase, 'fragmented');
  assert.equal(part.gone, true);
  assert.equal(part.crumbleProgress, 1);
  const fragments = game.structuralFragments.sample(part.id, 200);
  assert.ok(fragments.length > 10, 'the contact frame must contain actual small PC fragments');
  assert.ok(fragments.every(f => f.partId === part.id && Number.isFinite(f.position.y)));
  assert.ok(game.parts.some(p => p.node.visible && p.phase === 'intact'), 'unaffected architecture must remain visible');
});

for (const weapon of ['rocket', 'meteor', 'ball']) {
  test(`a fast ${weapon} sweep handles distinct contacts only inside its finite path`, async () => {
    const game = await engine(); game.fire(weapon);
    game.shot.speed = 10; game.step(.05);
    assert.equal(game.shot.hit, false, 'the sweep must not hit triangles ahead of this frame');
    assert.equal(game.damage, 0);
    game.shot.speed = 1500; game.step(.05);
    assert.equal(game.shot.penetrated.size, weapon === 'ball' ? 2 : 1, 'the sweep must obey the weapon contact limit even at high speed');
    assert.equal(game.shot.stopped, true);
    assert.equal(game.events.filter(e => e.name === 'impact').length, 1, 'many triangle intersections must not duplicate the entry explosion');
    assert.ok(game.events.filter(e => e.name === 'penetration').length <= 1, 'exit response can only occur once');
  });
}

test('an already falling parent still receives a direct hit at its moved pose', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket'); game.scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(game.projectile.position, game.shot.dir, 0, 80);
  const contact = ray.intersectObjects(game.parts.map(p => p.node), true)[0];
  assert.ok(contact, 'the fixture must target actual parent triangles');
  const part = contact.object.userData.part;
  const localContact = part.node.worldToLocal(contact.point.clone());
  for (const lower of game.parts.filter(p => p.floor < part.floor)) {
    lower.direct = true;
    game.breakPart(lower);
  }
  game.breakPart(part);
  assert.equal(part.active, true);
  assert.equal(part.phase, 'falling');
  game.shot.speed = 0;
  advance(game, .2);
  assert.ok(part.node.position.y < part.rest.y - .15, 'loss of support must move the parent before fragmentation');
  assert.equal(part.node.visible, true);
  assert.equal(part.phase, 'falling');
  game.scene.updateMatrixWorld(true);
  const movedContact = part.node.localToWorld(localContact.clone());
  game.projectile.position.copy(movedContact).addScaledVector(game.shot.dir, -.4);
  game.shot.speed = 120;
  game.step(1 / 60);
  assert.ok(game.shot.penetrated.has(part.id), 'a falling parent must retain its real triangle collision surface');
  assert.equal(part.direct, true);
  assert.equal(part.node.visible, false, 'a direct contact immediately fragments an already falling parent');
  assert.equal(part.phase, 'fragmented');
  assert.ok(game.structuralFragments.sample(part.id, 50).length > 10);
});

test('connected upper architecture falls continuously until its contact front crushes', async () => {
  const game = await engine();
  for(const p of game.parts.filter(p=>p.floor===0)){p.direct=true;game.breakPart(p);}
  advance(game,.6);
  const upper=game.parts.filter(p=>p.floor>=2);
  assert.ok(upper.every(p=>p.active&&!p.gone&&p.node.position.y<p.rest.y-.8),'upper mass must move together and survive open-air descent');
  const shifts=upper.map(p=>p.node.position.y-p.rest.y);
  assert.ok(Math.max(...shifts)-Math.min(...shifts)<.03,'no floor-by-floor hover gaps');
  advance(game,8);
  assert.ok(game.parts.some(p=>p.floor>=4&&p.gone),'contact crushing must eventually consume upper architecture');
});

test('missing side bearings pull the first connected strip while distant PC bearings remain stable', async () => {
  const game = await engine();
  for(const p of game.parts.filter(p=>p.floor===0&&p.center.x<0)){p.direct=true;game.breakPart(p);}
  advance(game,.5);
  const roof=game.parts.filter(p=>p.floor===5&&!p.gone);
  assert.ok(roof.length>=4,'open-air roof survives without an age fracture');
  assert.ok(roof.filter(p=>p.center.x<0).some(p=>p.node.position.y<p.rest.y-.2),'unsupported side must descend');
  assert.ok(roof.filter(p=>p.center.x>0&&p.center.x<3.5).some(p=>p.node.position.distanceTo(p.rest)>.03),'the first bearing strip must share the eccentric falling load');
  assert.ok(roof.filter(p=>p.center.x>3.5).every(p=>!p.active&&p.node.position.distanceTo(p.rest)<.001),'distant intact bearings must retain their original grounded poses');
});

test('reactivating a resting sector retains its linear and angular momentum', async () => {
  const game=await engine(),p=game.parts[20];
  p.phase='resting';p.vel.set(1,-2,3);p.spin.set(.2,0,-.4);
  game.breakPart(p);
  assert.deepEqual(Array.from(p.vel.toArray()),[1,-2,3]);
  assert.deepEqual(Array.from(p.spin.toArray()),[.2,0,-.4]);
});

test('shot result waits for pending physical damage, not a fixed watch interval', async () => {
  const game=await engine();game.aim.height=1;game.fire('meteor');
  while(!game.shot.hit&&game.time<2)game.step(1/120);
  game.watchTime=10;game.hitStop=0;game.slow=0;
  game.step(1/30);
  assert.ok(game.structuralFragments.stats().moving>0,'fixture needs real airborne pieces');
  assert.equal(game.state,'watch','result modal must wait for physical settlement');
  advance(game,20);
  assert.equal(game.state,'ready');
  assert.ok(game.parts.every(p=>p.gone||!p.active),'a new shot must wait for the actual architecture to stop');
  assert.ok(game.structuralFragments.stats().settled>0,'real rubble must reach rest before rearming');
  assert.equal(game.events.filter(event=>event.name==='shotFinished').length,1);
});

test('damage accounts for partial falling and completed fragmentation', async () => {
  const game = await engine(); game.fire('rocket');
  let sawPartialDamage = false, refreshes=0;
  const refresh=game.updateDamage;
  // Wall impacts run after the frame's HUD refresh and can fracture another
  // member. Check the accounting at its owning refresh, including those real
  // impacts on the following refresh, rather than assuming a second HUD pass.
  game.updateDamage=function(){
    const value=refresh.call(this),g=this;
    const progress = g.parts.reduce((sum, p) => sum + p.crumbleProgress, 0);
    const cleared=g.parts.every(p=>p.gone);
    assert.equal(g.damage,cleared?100:Math.min(99,Math.round(progress/g.parts.length*100)));
    const activatedPercent = Math.round(g.parts.filter(p => p.active).length / g.parts.length * 100);
    if (g.damage > 0 && g.damage < activatedPercent) sawPartialDamage = true;
    refreshes++;return value;
  };
  advance(game,4);
  assert.ok(refreshes>=120,'every simulation frame must refresh physical damage');
  assert.ok(sawPartialDamage, 'a falling parent contributes less than a fully fragmented sector');
});

test('progressive collapse emits dense fine powder and dust from real building damage', async () => {
  const game = await engine(); game.aim.height = 1; game.fire('meteor');
  assert.equal(game.powder.stats().spawned, 0);
  let maxPowder = 0, maxDust = 0, maxRenderedPowder = 0;
  advance(game, 6, g => {
    const stats = g.powder.stats();
    maxPowder = Math.max(maxPowder, stats.active);
    maxDust = Math.max(maxDust, g.dust.filter(p => !p.fire).length);
    assert.ok(stats.active <= stats.capacity);
    g.render();
    const powder = g.scene.getObjectByName('powder_grains');
    assert.ok(powder?.isPoints, 'fine grains must use the bounded point-particle renderer');
    maxRenderedPowder = Math.max(maxRenderedPowder, powder.geometry.drawRange.count);
  });
  assert.ok(maxPowder >= 300, `collapse must use dense fine particles, observed ${maxPowder}`);
  assert.ok(game.powder.stats().spawned >= 600, 'falling parents and real fragment impacts must continue to emit powder');
  assert.ok(maxDust > 0, 'fine airborne dust must accompany the granular powder');
  assert.ok(maxRenderedPowder >= 300, 'live powder must reach the renderer during the collapse');
});

test('every refined cell releases original fragment geometry exactly once', async () => {
  const game = await engine();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/pc-fragments.json'), 'utf8'));
  const seen = new Set();
  for (const part of game.parts) {
    part.direct = true;
    game.breakPart(part);
    const actual = game.structuralFragments.sample(part.id, manifest.pieces.length);
    assert.ok(actual.length > 0, 'every structural cell must own source fragments');
    for (const fragment of actual) {
      const source = manifest.pieces[fragment.id];
      assert.ok(source && source.sourceParent != null && source.sourceMesh != null);
      assert.equal(fragment.partId, part.id);
      assert.ok(part.sourcePartIds.includes(source.partId));
      assert.ok(!seen.has(fragment.id), 'a source fragment cannot belong to two structural cells');
      seen.add(fragment.id);
    }
  }
  assert.equal(seen.size, manifest.pieces.length, 'refinement cannot omit source geometry');
  assert.equal(game.structuralFragments.stats().active, manifest.pieces.length);
  game.reset();
  assert.equal(game.structuralFragments.stats().active, 0);
  assert.ok(game.parts.every(part => game.structuralFragments.sample(part.id, 1).length === 0));
});

test('actual small fragments persist at rest while late chips finish moving', async () => {
  const game = await engine(); game.aim.height = 1; game.fire('meteor');
  const allPieces=()=>Array.from(game.structuralFragments.sample(null,game.structuralFragments.stats().pieceCount));
  const cohort=()=>{
    const pieces=allPieces(),stats=game.structuralFragments.stats(),ids=new Set(pieces.map(p=>p.id));
    assert.equal(pieces.length,stats.active,'every active piece must be exposed by the full sample');
    assert.equal(ids.size,stats.active,'active source IDs must remain unique');
    assert.equal(stats.settled+stats.moving,stats.active,'every active source fragment stays accounted for');
    return {pieces,ids,gone:new Set(game.parts.filter(p=>p.gone).map(p=>p.id)),fractures:game.shotFractures.length};
  };
  const assertPreserved=(before,after)=>{
    assert.deepEqual([...before.ids].filter(id=>!after.ids.has(id)),[],
      'settling must preserve every retained source fragment ID');
    const newFractures=new Set(game.shotFractures.slice(before.fractures,after.fractures).map(f=>f.id));
    for(const piece of after.pieces.filter(p=>!before.ids.has(p.id))){
      assert.ok(!before.gone.has(piece.partId)&&after.gone.has(piece.partId)&&newFractures.has(piece.partId),
        'additional pieces must come from an actual newly fractured parent');
    }
  };
  advance(game, 12); game.render();
  const retained=cohort();
  assert.ok(retained.ids.size > 300, 'twelve seconds must retain many actual PC pieces');
  // Actual wall contacts can leave chips sliding on rubble or supported on a
  // surviving wall. Ready requires stable architecture, not freezing all chips.
  for(let elapsed=12;elapsed<15&&game.structuralFragments.stats().moving;elapsed+=1/30)game.step(1/30);
  game.render();
  const stats=game.structuralFragments.stats(),settling=cohort();
  // Late chips may fracture another wall and add source pieces. Identity
  // retention detects deleted/replaced rubble without forbidding that impact.
  assertPreserved(retained,settling);
  assert.ok(game.parts.every(p=>p.gone||!p.active),'the surviving structure must be static');
  assert.ok(stats.settled>stats.moving,'the actual rubble pile must settle while the smaller tail continues');
  assert.equal(stats.settled+stats.moving,stats.active,'every retained source fragment stays accounted for');
  assert.ok(game.events.some(e => e.name === 'floorImpact'), 'real fragment landing must drive the impact feedback');
  assert.ok(!game.fallingDebris || game.fallingDebris.length === 0, 'no synthetic delayed landing queue may replace actual falling pieces');
  const grounded=settling.pieces.filter(f=>f.settled&&f.supportId==null);
  assert.ok(grounded.length>100,'a substantial pile of real grounded fragments must remain');
  const ids=new Set(grounded.map(f=>f.id));
  const snapshot=()=>allPieces().filter(f=>ids.has(f.id))
    .map(f=>[f.id,...f.position.toArray(),...f.quaternion.toArray(),f.settled]);
  const before=snapshot();
  advance(game, 2); game.render();
  assert.deepEqual(snapshot(), before, 'settled source geometry must persist after the visual effects expire');
  assertPreserved(settling,cohort());
});
