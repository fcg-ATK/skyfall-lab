'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,runCase,runTriangleChainCase,goldenHash}=require('./helpers/fragment-performance-fixture.cjs');
const rt=runtime();

test('a wall just after the existing floor tolerance cannot receive a false collision',()=>{
  const threshold=.5+1e-7;
  const {wallEvents}=runCase(rt,{floorTime:.5,wallTimes:[threshold+.75e-8,threshold+.8e-8]});
  assert.equal(wallEvents.length,0);
});

test('an actionable later traversal hit survives the collider EPS tie at the floor threshold',()=>{
  const threshold=.5+1e-7;
  const {wallEvents}=runCase(rt,{floorTime:.5,wallTimes:[threshold+1.1e-8,threshold]});
  assert.equal(wallEvents.length,1);
  assert.equal(wallEvents[0].target,101,'an ignored later wall must not hide the actual threshold contact');
});

test('a four-triangle Float32 EPS tie chain retains the original actionable wall contact',()=>{
  const {wallEvents}=runTriangleChainCase(rt);
  assert.equal(wallEvents.length,1,'the authored triangle traversal and EPS history must retain the actionable contact');
  assert.equal(wallEvents[0].target,100);
  assert.ok(wallEvents[0].time<=1e-4+1e-7);
});

test('breaking a wall rechecks the remaining segment after its floor is removed synchronously',()=>{
  const {wallEvents}=runCase(rt,{floorTime:.5,wallTimes:[.2,.8],destroyFloor:true,half:[.1,.15,.1]});
  assert.deepEqual(wallEvents.map(e=>e.target),[100,101]);
  assert.deepEqual(wallEvents.map(event=>event.firstContact),[true,false],
    'the second unique wall contact cannot be reported as the first contact again');
});

test('moving sloped floors, point/finite footprints and synchronous damage preserve v8.12 fields',()=>{
  // Filled from the frozen pre-cap structural-fragments.js before production
  // edits. Each entry contains every piece field, event energy/point/normal,
  // available damage balance and manager counts, across 73 deterministic cases.
  // Baseline source SHA256: c2dae1e95b6e6dcf47c3c35725f527a76af53c4f670c378e93c115e40e6b3ab7.
  assert.equal(goldenHash(rt),'d052e4296a3b68e1b5f591385ef9baecfc4f0a137c934d5f32de11f9cf097410');
});
