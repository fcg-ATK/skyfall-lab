'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.resolve(__dirname, '../dist');
const context = vm.createContext({ window: {}, console, Float32Array, Uint8Array, ArrayBuffer });
vm.runInContext(fs.readFileSync(path.join(dist, 'three-local.js'), 'utf8'), context);
const file = path.join(dist, 'structural-fragments.js');
if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const T = context.window.THREE;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

// Actual Three objects and typed geometry; no fake rendering/math dependencies.
function setup({ count = 2, y = 8, parentTransform = false, centered = false, half = [.25,.25,.25], spacing = .7, splitLastPart = false } = {}) {
  assert.ok(context.window.SkyfallStructuralFragments, 'structural fragment manager must be available');
  const scene = new T.Scene(), parent = new T.Group(), node = new T.Group();
  scene.add(parent); parent.add(node); node.position.set(0, y, 0);
  if (parentTransform) {
    parent.position.set(10, 2, -4); parent.rotation.y = .6; parent.scale.setScalar(1.5);
    node.rotation.z = .2;
  }
  const solid = new T.MeshStandardMaterial({ vertexColors: true, roughness: .7 });
  solid.name = 'BuildingStructure'; solid.map = new T.Texture();
  const glass = new T.MeshStandardMaterial({ transparent: true, opacity: .2, metalness: .15 });
  glass.name = 'BuildingGlass';
  node.add(new T.Mesh(new T.BoxGeometry(), solid), new T.Mesh(new T.BoxGeometry(), glass));
  const otherNode = splitLastPart ? node.clone() : null;
  if (otherNode) parent.add(otherNode);
  scene.updateMatrixWorld(true);
  const part = { id: 17, floor: 2, node, vel: V(), rest: node.position.clone(), restQ: node.quaternion.clone() };
  const otherPart = otherNode && { id: 18, floor: 2, node: otherNode, vel: V(), rest: otherNode.position.clone(), restQ: otherNode.quaternion.clone() };
  const sizes = { position: count * 9, normal: count * 9, uv: count * 6, color: count * 9, pieceId: count * 3 };
  const buffers = {}; let offset = 0;
  for (const [name, length] of Object.entries(sizes)) {
    offset = Math.ceil(offset / 4) * 4;
    buffers[name] = { offset, length }; offset += length * (name === 'color' ? 1 : 4);
  }
  const arrayBuffer = new ArrayBuffer(offset), pieces = [];
  for (let i = 0; i < count; i++) {
    const center = V((i - (centered ? (count - 1) / 2 : 0)) * spacing, 0, 0).applyMatrix4(node.matrixWorld);
    pieces.push({ id: i, partId: otherPart && i === count-1 ? 18 : 17, kind: i === count - 1 && count > 1 ? 'glass' : 'structure',
      center: center.toArray(), half, firstVertex: i * 3, vertexCount: 3 });
    new Float32Array(arrayBuffer, buffers.position.offset, sizes.position).set([-.25,-.25,0, .25,-.25,0, 0,.25,0], i * 9);
    new Float32Array(arrayBuffer, buffers.normal.offset, sizes.normal).set([0,0,1, 0,0,1, 0,0,1], i * 9);
    new Float32Array(arrayBuffer, buffers.uv.offset, sizes.uv).set([0,0, 1,0, .5,1], i * 6);
    new Uint8Array(arrayBuffer, buffers.color.offset, sizes.color).fill(160, i * 9, i * 9 + 9);
    new Float32Array(arrayBuffer, buffers.pieceId.offset, sizes.pieceId).fill(i, i * 3, i * 3 + 3);
  }
  const materialRanges = [{ kind: 'structure', start: 0, count: (count > 1 ? count - 1 : 1) * 3 }];
  if (count > 1) materialRanges.push({ kind: 'glass', start: (count - 1) * 3, count: 3 });
  const descriptor = { version: 1, vertexCount: count * 3, triangleCount: count, buffers, pieces, materialRanges };
  const manager = context.window.SkyfallStructuralFragments.create(scene);
  manager.prepare(otherPart ? [part,otherPart] : [part], descriptor, arrayBuffer);
  return { manager, scene, parent, part, otherPart, descriptor, solid, glass };
}

test('release preserves current transformed centers and relative rotation, including moved parent', () => {
  const { manager, part, parent, descriptor } = setup({ parentTransform: true });
  const originalWorld = part.node.matrixWorld.clone();
  const oldQ = new T.Quaternion(); originalWorld.decompose(V(), oldQ, V());
  const local = V(...descriptor.pieces[1].center).applyMatrix4(originalWorld.clone().invert());
  part.node.position.add(V(2, -3, 1)); part.node.rotation.x = .7; parent.rotation.y += .35;
  parent.updateMatrixWorld(true);
  const expected = local.applyMatrix4(part.node.matrixWorld);
  const currentQ = new T.Quaternion(); part.node.matrixWorld.decompose(V(), currentQ, V());
  const expectedQ = currentQ.multiply(oldQ.invert());
  assert.equal(manager.release(part, { direct: false }), 2);
  const sample = manager.sample(17, 2)[1];
  assert.ok(sample.position.distanceTo(expected) < 1e-6, 'must not teleport to descriptor rest centers');
  assert.ok(sample.quaternion.angleTo(expectedQ) < 1e-6, 'rest-world vertices must receive the part delta rotation');
});

test('direct fragments inherit falling velocity and a strong directional impulse; support failure falls mostly down', () => {
  const direct = setup(), indirect = setup();
  for (const fixture of [direct, indirect]) fixture.part.vel.set(1, -4, 0);
  direct.manager.release(direct.part, { direct: true, direction: V(1), point: V(0,8), weapon: 'rocket' });
  indirect.manager.release(indirect.part, { direct: false, direction: V(1), weapon: 'rocket' });
  const a = direct.manager.sample(17, 1)[0], b = indirect.manager.sample(17, 1)[0];
  assert.ok(a.velocity.x >= 8 && a.velocity.x <= 14, 'direct debris should carry the shot direction');
  assert.ok(Math.hypot(b.velocity.x - 1, b.velocity.z) < 1, 'secondary fragments must keep most motion downward');
  assert.equal(b.velocity.y, -4, 'compression must preserve the parent downward velocity without adding an artificial impulse');
  direct.manager.step(.2, []); indirect.manager.step(.2, []);
  assert.ok(direct.manager.sample(17,1)[0].position.x > indirect.manager.sample(17,1)[0].position.x + 1);
  assert.ok(indirect.manager.sample(17,1)[0].position.y < 8);
});

test('release transfers world angular point velocity and spin without changing the transformed pose', () => {
  const spinning = setup({ count: 3, centered: true }), still = setup({ count: 3, centered: true });
  for (const fixture of [spinning, still]) {
    fixture.part.node.position.set(9, 20, -3);
    fixture.part.node.rotation.y = Math.PI / 2;
    fixture.part.vel.set(2, -3, 4);
  }
  // World X spin: the rotated outer pieces at z = +/- .7 inherit opposite Y velocity.
  spinning.part.spin = V(2, 0, 0);
  spinning.manager.release(spinning.part, { energy: 0 });
  still.manager.release(still.part, { energy: 0 });
  const a = spinning.manager.sample(17, 3), b = still.manager.sample(17, 3);
  assert.ok(Math.abs(a[0].velocity.y - (-4.4)) < 1e-8);
  assert.ok(Math.abs(a[2].velocity.y - (-1.6)) < 1e-8);
  for (let i = 0; i < 3; i++) {
    assert.ok(a[i].position.distanceTo(b[i].position) < 1e-9);
    assert.equal(a[i].velocity.x, 2); assert.equal(a[i].velocity.z, 4);
  }
  spinning.manager.step(.1, []); still.manager.step(.1, []);
  assert.ok(spinning.manager.sample(17, 3)[1].quaternion.angleTo(still.manager.sample(17, 3)[1].quaternion) > .17,
    'even a centered piece must inherit rotation rather than only point velocity');
  spinning.manager.reset(); spinning.manager.release(spinning.part, { energy: 0, angularVelocity: V() });
  assert.equal(spinning.manager.sample(17, 3)[0].velocity.y, -3, 'explicit angular velocity overrides part.spin');
});

test('low bounce retains sliding and rolling before a stable finite rest and does not redeposit itself', () => {
  const { manager, part } = setup({ count: 1, y: .50 });
  manager.release(part, { energy: 0, velocity: V(4, -1, 0) });
  manager.step(1 / 60, []);
  const contact = manager.sample(17, 1)[0];
  assert.equal(contact.settled, false, 'one low bounce is not a settled state');
  for (let i = 0; i < 30; i++) manager.step(1 / 60, []);
  const rolling = manager.sample(17, 1)[0];
  assert.ok(rolling.position.x > contact.position.x + .7, 'residual momentum must visibly spread debris after first contact');
  assert.ok(rolling.quaternion.angleTo(contact.quaternion) > .1, 'contact motion should roll the actual fragment');
  for (let i = 0; i < 900; i++) manager.step(1 / 60, []);
  const rest = manager.sample(17, 1)[0], height = manager.groundHeight(rest.position.x, rest.position.z);
  assert.equal(rest.settled, true); assert.equal(manager.stats().moving, 0);
  for (let i = 0; i < 180; i++) manager.step(1 / 60, []);
  assert.ok(manager.sample(17, 1)[0].position.distanceTo(rest.position) < 1e-9);
  assert.equal(manager.groundHeight(rest.position.x, rest.position.z), height, 'settled fragment deposits exactly once');
  manager.reset();
  assert.equal(manager.groundHeight(rest.position.x, rest.position.z), .24);
});

test('tilted finite supports slide fragments downhill and do not leave a phantom horizontal plane', () => {
  const { manager, part } = setup({ count: 1, y: 6.35 });
  const support = { id: 'tilt', floor: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2, top: 8,
    surfaceAt: (x, z) => 6 - x * .7,
    contains: (x, z, padX = 0, padZ = 0) => Math.abs(x) <= 2 + padX && Math.abs(z) <= .6 + padZ,
    velocityAt: () => V() };
  manager.release(part, { energy: 0, velocity: V(0, -1, 0) });
  const events = manager.step(.2, [support]);
  const onSlope = manager.sample(17, 1)[0];
  assert.equal(onSlope.supportId, 'tilt');
  assert.ok(onSlope.position.y < 7, 'contact height comes from the plane at the piece, not global maximum top');
  assert.ok(events.every(e => e.point.y < 7));
  for (let i = 0; i < 240; i++) manager.step(1 / 60, [support]);
  const beyondEdge = manager.sample(17, 1)[0];
  assert.ok(beyondEdge.position.x > 2.3, 'slope should turn gravity into downhill motion');
  assert.ok(beyondEdge.position.y < 4, 'finite support ends; extrapolated infinite plane cannot hold a piece up');
  for (let i = 0; i < 900; i++) manager.step(1 / 60, [support]);
  assert.equal(manager.sample(17, 1)[0].settled, true);
});

test('settled fragments retain horizontal transport from moving support snapshots', () => {
  const { manager, part } = setup({ count: 1, y: 5.25 });
  let offset = 0;
  const support = () => { const x0 = offset; return { id: 'carrier', floor: 1,
    minX: x0 - 2, maxX: x0 + 2, minZ: -2, maxZ: 2, top: 5,
    surfaceAt: () => 5, contains: (x, z, px = 0, pz = 0) => Math.abs(x - x0) <= 2 + px && Math.abs(z) <= 2 + pz,
    velocityAt: () => V(2, 0, 0) }; };
  manager.release(part, { energy: 0, velocity: V(2, 0, 0) });
  for (let i = 0; i < 120; i++) { offset += 2 / 60; manager.step(1 / 60, [support()]); }
  const carried = manager.sample(17, 1)[0];
  assert.equal(carried.settled, true);
  assert.ok(Math.abs(carried.position.x - 4) < .05, 'support transport must not zero the point velocity X/Z');
  assert.ok(Math.abs(carried.position.y - 5.25) < .05);
  assert.equal(manager.stats().moving, 1, 'carried geometry still needs rendering and shadow updates');
  manager.step(.1, []);
  assert.ok(manager.sample(17, 1)[0].position.x > carried.position.x + .15, 'support removal preserves horizontal momentum');
});

test('a rotated footprint rejects its empty AABB corners and a newly tilted resting support wakes debris', () => {
  const empty = setup({ count: 1, y: 9 }), resting = setup({ count: 1, y: 5.25 });
  empty.part.node.position.z = 1.8;
  const flat = { id: 'ramp', floor: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2, top: 5,
    surfaceAt: () => 5, contains: (x,z,px=0,pz=0) => Math.abs(x+z) <= 1+px+pz && Math.abs(x-z) <= 3+px+pz,
    velocityAt: () => V() };
  empty.manager.release(empty.part, { energy: 0, velocity: V(0,-30,0) });
  assert.equal(empty.manager.step(.25, [flat]).some(e => e.supportId === 'ramp'), false);
  assert.ok(empty.manager.sample(17,1)[0].position.y < 3);
  resting.manager.release(resting.part, { energy: 0 });
  for (let i=0;i<90;i++) resting.manager.step(1/60,[flat]);
  assert.equal(resting.manager.sample(17,1)[0].settled,true);
  const tilted = { ...flat, top: 6.4, surfaceAt: x => 5-.7*x };
  for (let i=0;i<60;i++) resting.manager.step(1/60,[tilted]);
  const sliding = resting.manager.sample(17,1)[0];
  assert.equal(sliding.settled,false);
  assert.ok(sliding.position.x>.5,'support tilt must wake a previously stable fragment');
});

test('hard crush spreads its settled rubble farther than soft contact without another projectile impulse', () => {
  const soft=setup({count:8,y:1,centered:true}),hard=setup({count:8,y:1,centered:true});
  for(const [fixture,energy] of [[soft,2],[hard,12]]) {
    fixture.manager.release(fixture.part,{direct:false,energy,velocity:V(0,-3,0),direction:V(1,1,1)});
    for(let i=0;i<900;i++)fixture.manager.step(1/60,[]);
    assert.equal(fixture.manager.stats().moving,0);
  }
  const range=fixture=>{
    const pieces=fixture.manager.sample(17,8);
    return Math.max(...pieces.map(s=>s.position.x))-Math.min(...pieces.map(s=>s.position.x));
  };
  assert.ok(range(hard)>range(soft)+.6,'energy must survive contact as finite lateral travel');
  assert.ok(range(hard)<12,'crush must not become an unconstrained fireworks burst');
});

test('later debris slides down a deposited rubble slope while the original pile stays at rest', () => {
  const {manager,part,otherPart}=setup({count:41,y:1.25,spacing:0,half:[1,1,1],splitLastPart:true});
  manager.release(part,{energy:0});
  for(let i=0;i<240;i++)manager.step(1/60,[]);
  assert.equal(manager.stats().settled,40);
  const pileBefore=manager.sample(17,40);
  assert.ok(manager.groundHeight(1.6,0)>manager.groundHeight(3,0)+.5,'fixture must create a real downhill rubble slope');
  otherPart.node.position.set(1.7,manager.groundHeight(1.7,0)+1.01,0);
  manager.release(otherPart,{energy:0});
  for(let i=0;i<120;i++)manager.step(1/60,[]);
  assert.ok(manager.sample(18,1)[0].position.x>2.5,'gravity must spread newly contacting debris down the pile');
  for(let i=0;i<900;i++)manager.step(1/60,[]);
  assert.equal(manager.stats().moving,0);
  assert.ok(manager.sample(17,40).every((s,i)=>s.position.distanceTo(pileBefore[i].position)<1e-9),
    'heightfield changes must not continually reawaken already deposited debris');
});

test('compression scatter follows contact energy while downward momentum and current release pose remain continuous', () => {
  const low = setup({ count: 8, y: 20, centered: true });
  const high = setup({ count: 8, y: 20, centered: true });
  for (const [fixture, energy] of [[low,2],[high,12]]) {
    fixture.part.node.position.add(V(7,-1,3)); fixture.part.node.rotation.y=.4;
    fixture.part.vel.set(0,-8,0);
    fixture.manager.release(fixture.part,{direct:false,cause:'compression',energy,direction:V(0,.8,-.6)});
  }
  const beforeLow=low.manager.sample(17,8), beforeHigh=high.manager.sample(17,8);
  const lateral = sample => sample.reduce((sum,s)=>sum+Math.hypot(s.velocity.x,s.velocity.z),0)/sample.length;
  assert.ok(lateral(beforeLow)<.5, 'gentle contact must not blast a floor sideways');
  assert.ok(lateral(beforeHigh)>lateral(beforeLow)*2, 'hard compression should produce more outward scatter than soft contact');
  assert.ok(lateral(beforeHigh)<2, 'even a hard compression should remain dominated by its falling momentum');
  assert.ok(beforeHigh.every((s,i)=>s.position.distanceTo(beforeLow[i].position)<1e-8));
  assert.ok(beforeHigh.every(s=>s.velocity.y===-8));
  for(let i=0;i<21;i++){low.manager.step(1/60,[]);high.manager.step(1/60,[]);}
  const afterLow=low.manager.sample(17,8), afterHigh=high.manager.sample(17,8);
  assert.ok(afterHigh.every((s,i)=>s.position.y<beforeHigh[i].position.y-2.8));
  assert.ok(afterHigh[0].quaternion.angleTo(beforeHigh[0].quaternion)>afterLow[0].quaternion.angleTo(beforeLow[0].quaternion));
});

test('secondary compression has no leftover projectile-direction kick and shares parent gravity', () => {
  const a=setup({count:1,y:30}),b=setup({count:1,y:30});
  a.manager.release(a.part,{cause:'compression',direct:false,energy:4,velocity:V(0,-5,0),direction:V(1)});
  b.manager.release(b.part,{cause:'compression',direct:false,energy:4,velocity:V(0,-5,0),direction:V(-1)});
  const initial=a.manager.sample(17,1)[0];
  assert.ok(initial.velocity.distanceTo(b.manager.sample(17,1)[0].velocity)<1e-9, 'compression must not inherit an unrelated shot impulse');
  a.manager.step(.2,[]);
  assert.ok(Math.abs(a.manager.sample(17,1)[0].velocity.y-(-5-9.8*.2))<1e-8, 'fragment acceleration must not jump from parent9.8 to fragment18');
});

test('support impacts report mass-weighted momentum so tiny chips cannot count like full structural fragments', () => {
  const large=setup({count:1,y:12,half:[.25,.25,.25]});
  const tiny=setup({count:1,y:12,half:[.025,.025,.025]});
  const supports=[{id:'floor',floor:1,minX:-20,maxX:20,minZ:-20,maxZ:20,top:7}];
  const events=[];
  for(const fixture of [large,tiny]) {
    fixture.manager.release(fixture.part,{direct:false,cause:'compression',energy:0,velocity:V(0,-40,0)});
    events.push(fixture.manager.step(.2,supports).find(e=>e.supportId==='floor'));
  }
  const [a,b]=events;
  assert.ok(a&&b);
  assert.ok(a.mass>0 && a.mass<=900 && b.mass>0);
  assert.ok(Math.abs(a.mass/b.mass-1000)<1e-6, 'mass must scale with solid volume rather than one event per piece');
  for(const e of events) {
    assert.ok(Math.abs(e.impulse-e.mass*e.energy)<1e-8);
    assert.ok(Math.abs(e.kineticEnergy-.5*e.mass*e.energy**2)<1e-8);
    assert.equal(e.firstContact,true);
  }
  assert.ok(b.impulse<a.impulse*.002);
});

test('rubble surface is queryable by the falling structure and resets with the round', () => {
  const {manager,part}=setup({count:16,y:3,centered:true});
  assert.equal(typeof manager.groundHeight,'function');
  assert.equal(manager.groundHeight(0,0),.24);
  assert.equal(manager.groundHeight(NaN,0),.24);
  manager.release(part,{direct:false,energy:0});
  for(let i=0;i<900;i++)manager.step(1/60,[]);
  const pieces=manager.sample(17,32);
  assert.ok(pieces.some(p=>manager.groundHeight(p.position.x,p.position.z)>.24));
  manager.reset();
  assert.ok(pieces.every(p=>manager.groundHeight(p.position.x,p.position.z)===.24));
});

test('fast falling fragments collide with the highest swept overlapping floor', () => {
  const { manager, part } = setup({ count: 1, y: 12 });
  manager.release(part, { direct: false, velocity: V(0,-80,0) });
  const supports = [
    { id: 'lower', floor: 0, minX: -10, maxX: 10, minZ: -10, maxZ: 10, top: 2 },
    { id: 'upper', floor: 1, minX: -10, maxX: 10, minZ: -10, maxZ: 10, top: 7 },
    { id: 'outside', floor: 4, minX: 40, maxX: 45, minZ: 40, maxZ: 45, top: 10 },
  ];
  const events = manager.step(.2, supports);
  assert.ok(events.length && events[0].supportId === 'upper');
  assert.equal(events[0].floor, 1); assert.equal(events[0].partId, 17);
  assert.ok(events[0].point.isVector3 && events[0].energy > 0);
  assert.ok(manager.sample(17,1)[0].position.y >= 7.2, 'must not tunnel through the intact upper floor');
});

test('co-falling fragments ride a descending support without artificial impact or upward bounce', () => {
  const {manager,part}=setup({count:1,y:12.25});
  const h=1/60;
  let velocityY=-10-9.8*h, top=12+velocityY*h;
  const support=()=>({id:'moving',floor:1,minX:-10,maxX:10,minZ:-10,maxZ:10,top,velocityY});
  manager.release(part,{direct:false,cause:'compression',energy:0,velocity:V(0,-10,0)});
  const first=manager.step(h,[support()]);
  assert.equal(first.length,0,'world downward speed is not impact energy when support shares it');
  const before=manager.sample(17,1)[0];
  assert.ok(Math.abs(before.velocity.y-velocityY)<1e-8,'contact must keep support velocity, not reverse it upward');
  assert.equal(before.settled,false,'one contact still waits for a short stable interval');
  assert.equal(manager.stats().moving,1,'carried geometry still moves in world space and needs updated shadows');
  const oldTop=top;
  velocityY-=9.8*h;top+=velocityY*h;
  assert.equal(manager.step(h,[support()]).length,0);
  const after=manager.sample(17,1)[0];
  assert.ok(Math.abs(after.position.y-before.position.y-(top-oldTop))<1e-8,'resting debris must be carried by the descending surface');
  assert.ok(Math.abs(after.velocity.y-velocityY)<1e-8);
  manager.step(h,[]);
  const dropped=manager.sample(17,1)[0];
  assert.equal(dropped.settled,false);
  assert.ok(dropped.velocity.y<velocityY,'support removal preserves inherited downward motion');
});

test('a faster fragment colliding with a descending support reports relative impact and relative rebound', () => {
  const {manager,part}=setup({count:1,y:12.26});
  const h=1/60,velocityY=-10,top=12+velocityY*h;
  manager.release(part,{direct:false,cause:'compression',energy:0,velocity:V(0,-20,0)});
  const events=manager.step(h,[{id:'moving',floor:1,minX:-10,maxX:10,minZ:-10,maxZ:10,top,velocityY}]);
  assert.equal(events.length,1);
  const closing=20+9.8*h+velocityY;
  assert.ok(Math.abs(events[0].energy-closing)<1e-8,'impact should exclude common downward motion');
  assert.ok(Math.abs(events[0].impulse-events[0].mass*closing)<1e-8);
  assert.ok(Math.abs(manager.sample(17,1)[0].velocity.y-(velocityY+closing*.12))<1e-8,'bounce is relative to the moving platform');
  assert.ok(manager.sample(17,1)[0].velocity.y<0,'a small bounce relative to a fast descending surface still moves down');
});

test('a fragment resting on an intact floor falls again when that support disappears', () => {
  const { manager, part } = setup({ count: 1, y: 8 });
  const supports = [{ id: 'floor', floor: 1, minX:-100,maxX:100,minZ:-100,maxZ:100,top:5 }];
  manager.release(part, { direct: false });
  for (let i = 0; i < 240; i++) manager.step(1/60, supports);
  assert.equal(manager.stats().settled, 1);
  const before = manager.sample(17,1)[0].position.y;
  manager.step(.25, []);
  assert.equal(manager.stats().moving, 1);
  assert.ok(manager.sample(17,1)[0].position.y < before - .1);
  for (let i = 0; i < 360; i++) manager.step(1/60, []);
  const final = manager.sample(17,1)[0];
  assert.equal(manager.stats().settled, 1);
  assert.ok(final.position.y >= .24 && final.position.y < 1);
});

test('released geometry remains present after settling and low quality preserves all material volume', () => {
  const { manager, part } = setup({ count: 64 });
  manager.release(part, { direct: false });
  manager.setQuality({ shadows: false, targetFps: 30, fragments: 3 });
  for (let i = 0; i < 1800; i++) manager.step(1/60, []);
  manager.render();
  assert.equal(manager.stats().active, 64);
  assert.equal(manager.stats().settled, 64);
  assert.equal(manager.sample(17, 100).length, 64);
});

test('reset and repeated releases reuse a bounded resource pool and only dirty transforms upload', () => {
  const { manager, scene, part } = setup({ count: 16 });
  const meshes = scene.children.filter(n => n.isMesh);
  assert.ok(meshes.length <= 2 && meshes.length > 0);
  const resources = meshes.map(m => [m.geometry.uuid, m.material.uuid, m.customDepthMaterial.uuid]);
  const before = manager.stats();
  for (let i = 0; i < 8; i++) {
    assert.equal(manager.release(part, { direct: true, direction: V(1) }), 16);
    assert.equal(manager.release(part, { direct: true }), 0, 'release must not duplicate active pieces');
    manager.step(.1, []); manager.render(); manager.reset(); manager.render();
    assert.equal(manager.stats().active, 0);
  }
  assert.deepEqual(meshes.map(m => [m.geometry.uuid, m.material.uuid, m.customDepthMaterial.uuid]), resources);
  assert.deepEqual([manager.stats().geometries, manager.stats().materials, manager.stats().triangles], [before.geometries, before.materials, 16]);
  assert.ok(manager.stats().maxDrawCalls <= 2);
  assert.equal(manager.stats().pieceCount, 16);
  const uploads = manager.stats().uploads;
  manager.render(); manager.render();
  assert.equal(manager.stats().uploads, uploads, 'paused or unchanged rendering must not reupload the transform texture');
  manager.release(part, { direct: false }); manager.render();
  assert.equal(manager.stats().uploads, uploads + 1);
});

test('batched fragments retain authored UVs, texture and normalized vertex color without changing source materials', () => {
  const { scene, manager, solid, glass } = setup();
  const meshes = scene.children.filter(n => n.isMesh);
  const solidBatch = meshes.find(n => n.material.map === solid.map);
  assert.ok(solidBatch);
  assert.notEqual(solidBatch.material, solid);
  assert.equal(solidBatch.geometry.attributes.color.normalized, true);
  assert.equal(solidBatch.geometry.attributes.uv.count, solidBatch.geometry.attributes.position.count);
  assert.equal(solidBatch.material.vertexColors, true);
  assert.equal(glass.opacity, .2);
  const glassBatch = meshes.find(n => n.material.transparent);
  assert.equal(glassBatch.material.forceSinglePass, true, 'transparent glass must remain one draw rather than separate front/back passes');
  assert.ok(manager.stats().prepared);
});

test('sleeping ground rubble leaves per-frame work while one newly released piece keeps simulating', () => {
  const {manager,part,otherPart}=setup({count:2049,y:.49,spacing:0,splitLastPart:true});
  manager.release(part,{energy:0});
  for(let i=0;i<60;i++)manager.step(1/60,[]);
  assert.equal(manager.stats().settled,2048);
  const pile=manager.sample(17,2048),height=manager.groundHeight(0,0);
  otherPart.node.position.y=50;
  manager.release(otherPart,{energy:0});
  manager.step(1/60,[]);
  assert.equal(manager.stats().simulated,1,'only one live fragment should enter the physics substep');
  assert.equal(manager.stats().supportChecks,0,'ground rubble needs no support polling');
  assert.equal(manager.stats().relevantMoving,1,'an airborne piece matters even at very low initial speed');
  assert.equal(manager.stats().active,2049);
  assert.equal(manager.stats().pieceCount,2049);
  assert.equal(manager.groundHeight(0,0),height);
  assert.ok(manager.sample(17,2048).every((s,i)=>s.position.distanceTo(pile[i].position)<1e-9));
  manager.reset();
  manager.step(1/60,[]);
  assert.equal(manager.stats().simulated,0);
  assert.equal(manager.stats().relevantMoving,0);
  assert.equal(manager.stats().supportChecks,0);
});

test('support sleepers stay tracked and rejoin live physics exactly once when the support disappears', () => {
  const {manager,part}=setup({count:1,y:5.25});
  const support={id:'floor',floor:1,minX:-10,maxX:10,minZ:-10,maxZ:10,top:5};
  manager.release(part,{energy:0});
  for(let i=0;i<90;i++)manager.step(1/60,[support]);
  assert.equal(manager.stats().simulated,0);
  assert.equal(manager.stats().supportChecks,1);
  assert.equal(manager.stats().relevantMoving,0);
  const y=manager.sample(17,1)[0].position.y;
  manager.step(1/60,[]);
  assert.equal(manager.stats().simulated,1);
  assert.equal(manager.stats().moving,1);
  assert.equal(manager.stats().relevantMoving,1);
  assert.ok(manager.sample(17,1)[0].position.y<y);
  manager.step(1/60,[]);
  assert.equal(manager.stats().supportChecks,0);
  assert.equal(manager.stats().moving,1);
  for(let i=0;i<300;i++)manager.step(1/60,[]);
  assert.equal(manager.stats().simulated,0);
  assert.equal(manager.stats().moving,0);
});

test('quietTail sleeps only low-energy ground contact, retaining geometry and depositing rubble once', () => {
  const {manager,part}=setup({count:1,y:.49});
  manager.release(part,{energy:0,velocity:V(.2,-.2,0)});
  manager.step(1/60,[]);
  assert.equal(manager.stats().moving,1,'debug moving count retains the low-energy tail until it sleeps');
  assert.equal(manager.stats().relevantMoving,0,'ground contact with tiny residual motion must not extend the round');
  const before=manager.sample(17,1)[0];
  assert.equal(manager.quietTail(),1);
  assert.equal(manager.stats().moving,0);
  assert.equal(manager.stats().settled,1);
  assert.equal(manager.stats().active,1);
  const height=manager.groundHeight(before.position.x,before.position.z);
  assert.ok(height>.24);
  assert.equal(manager.quietTail(),0);
  for(let i=0;i<60;i++)manager.step(1/60,[]);
  assert.equal(manager.stats().simulated,0);
  assert.equal(manager.groundHeight(before.position.x,before.position.z),height);
  const after=manager.sample(17,1)[0];
  assert.ok(after.position.distanceTo(before.position)<1e-9);
  assert.ok(after.quaternion.angleTo(before.quaternion)<1e-8);
});

test('quietTail never freezes airborne, fast sliding, fast rotating, or supported fragments', () => {
  const airborne=setup({count:1,y:50}),sliding=setup({count:1,y:.49}),rotating=setup({count:1,y:.49}),supported=setup({count:1,y:5.25});
  airborne.manager.release(airborne.part,{energy:0});
  sliding.manager.release(sliding.part,{energy:0,velocity:V(4,-.2,0)});
  rotating.manager.release(rotating.part,{energy:0,velocity:V(0,-.2,0),angularVelocity:V(0,10,0)});
  supported.manager.release(supported.part,{energy:0,velocity:V(.2,0,0)});
  const support={id:'floor',floor:1,minX:-10,maxX:10,minZ:-10,maxZ:10,top:5};
  sliding.manager.step(1/60,[]);rotating.manager.step(1/60,[]);supported.manager.step(1/60,[support]);
  for(const fixture of [airborne,sliding,rotating,supported]) {
    assert.equal(fixture.manager.stats().relevantMoving,1);
    assert.equal(fixture.manager.quietTail(),0);
    assert.equal(fixture.manager.sample(17,1)[0].settled,false);
    assert.equal(fixture.manager.stats().moving,1);
  }
  const before=airborne.manager.sample(17,1)[0].position.y;
  airborne.manager.step(.1,[]);
  assert.ok(airborne.manager.sample(17,1)[0].position.y<before);
});
