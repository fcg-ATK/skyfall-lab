'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { segmentBox, collapsePlan, dustBudget, qualityProfile } = require('../dist/physics.js');

const v = (x, y = 0, z = 0) => ({ x, y, z });
const box = [v(0), v(1, 1, 1)];
const building = Array.from({ length: 48 }, (_, i) => {
  const floor = Math.floor(i / 8), cell = i % 8;
  return { id: `f${floor}c${cell}`, floor, center: v(-7.5 + (cell % 4) * 5, 1.65 + floor * 3.3, cell < 4 ? -3.25 : 3.25), halfExtents: v(2.5, 1.65, 3.25) };
});

test('a finite segment returns its first contact fraction', () => {
  assert.equal(segmentBox(v(-5), v(5), ...box), 0.4);
  assert.equal(segmentBox(v(5), v(-5), ...box), 0.4);
});
test('an infinite ray intersection beyond the segment is not a hit', () => {
  assert.equal(segmentBox(v(-5), v(-2), ...box), null);
  assert.equal(segmentBox(v(5), v(2), ...box), null);
});
test('a shot above or beside a building cannot hit it', () => {
  assert.equal(segmentBox(v(-5, 3), v(5, 3), ...box), null);
  assert.equal(segmentBox(v(-5, 0, 3), v(5, 0, 3), ...box), null);
});
test('parallel rays, inside starts, and zero-length segments are stable', () => {
  assert.equal(segmentBox(v(0, -5), v(0, 5), ...box), 0.4);
  assert.equal(segmentBox(v(0), v(5), ...box), 0);
  assert.equal(segmentBox(v(0), v(0), ...box), 0);
  assert.equal(segmentBox(v(2), v(2), ...box), null);
});
test('projectile radius expands contact without turning the segment into a ray', () => {
  assert.equal(segmentBox(v(-5), v(5), ...box, 1), 0.3);
  assert.equal(segmentBox(v(-5, 1.5), v(5, 1.5), ...box, 0.5), 0.35);
  assert.equal(segmentBox(v(-5), v(-3), ...box, 1), null);
});
test('invalid geometry and nonfinite input never cause spurious hits', () => {
  assert.equal(segmentBox(v(NaN), v(5), ...box), null);
  assert.equal(segmentBox(v(-5), v(5), v(0), v(-1, 1, 1)), null);
  assert.equal(segmentBox(null, v(5), ...box), null);
});
test('no actual hits means no collapse for any weapon', () => {
  for (const weapon of ['rocket', 'meteor', 'ball']) {
    assert.deepEqual(collapsePlan(building, [], weapon), []);
    assert.deepEqual(collapsePlan(building, ['missing'], weapon), []);
  }
});
test('actual hits are immediate and plan IDs are unique', () => {
  const result = collapsePlan(building, ['f0c0', 'f0c0', 'f2c4'], 'rocket');
  assert.equal(result.find(p => p.id === 'f0c0').delay, 0);
  assert.equal(result.find(p => p.id === 'f2c4').delay, 0);
  assert.equal(new Set(result.map(p => p.id)).size, result.length);
  assert.ok(result.every(p => Number.isFinite(p.delay) && p.delay >= 0));
});
test('upper-floor blast cannot reach unrelated lower floors', () => {
  for (const weapon of ['rocket', 'meteor', 'ball']) {
    const result = collapsePlan(building, ['f4c2'], weapon);
    assert.ok(result.length > 0);
    assert.ok(result.every(p => building.find(b => b.id === p.id).floor >= (weapon==='rocket'?2:weapon==='meteor'?3:4)));
  }
});
test('a base meteor blast is limited to its nearby volume and neighboring storey', () => {
  const result = collapsePlan(building, ['f0c0'], 'meteor');
  assert.ok(result.length > 1);
  assert.ok(result.every(p=>building.find(b=>b.id===p.id).floor<=1), 'remote upper motion must come from current support');
});

test('a local impact tears across a storey instead of releasing it as one synchronized ring', () => {
  const result=collapsePlan(building,['f0c0'],'meteor');
  const base=result.filter(p=>p.id.startsWith('f0')).map(p=>p.delay);
  assert.ok(Math.max(...base)-Math.min(...base)>.03 && Math.max(...base)<.5,'farther members must visibly follow the contact zone');
});
test('weapon radii resolve distinct nearby centre distances despite overlapping AABBs', () => {
  const targets=[0,4.1,4.1001,6.2,6.2001].map((x,id)=>({id,floor:0,center:v(x),halfExtents:v(10,1,10)}));
  // Every AABB contains the hit centre, including members just outside each
  // configured radius. Only centre distance may select the lateral blast.
  for(const [weapon,expected] of Object.entries({rocket:[0,1],meteor:[0,1,2,3],ball:[0]})){
    assert.deepEqual(collapsePlan(targets,[0],weapon).map(p=>p.id),expected,`${weapon}: include the exact radius and reject the next outside centre`);
  }
});
test('rocket widens the contacted storey locally without reaching remote corners or neighboring floors', () => {
  const targets = [
    { id: 'hit', floor: 2, center: v(10, 8, 10) },
    { id: 'near-side', floor: 2, center: v(13.43, 8, 10) },
    { id: 'front-edge', floor: 2, center: v(10, 8, 13.4) },
    { id: 'past-front', floor: 2, center: v(10, 8, 13.401) },
    { id: 'corner', floor: 2, center: v(13.43, 8, 13) },
    { id: 'above', floor: 3, center: v(10, 11, 10) },
    { id: 'below', floor: 1, center: v(10, 5, 10) },
  ].map(p => ({ ...p, halfExtents: v(20, 1.5, 20) }));
  const ids = collapsePlan(targets, ['hit'], 'rocket', () => .5, v(10, 8, 10)).map(p => p.id).sort();
  assert.deepEqual(ids, ['front-edge', 'hit', 'near-side']);
  const offset = collapsePlan(targets, ['hit'], 'rocket', () => .5, v(6, 8, 10)).map(p => p.id);
  assert.deepEqual(offset, ['hit'], 'actual contact moves the blast origin; overlapping bounds must not inflate it');
});
test('detached remote upper pieces do not collapse through nonexistent support', () => {
  const remote = { id: 'remote', floor: 1, center: v(200, 5, 200), halfExtents: v(2, 1, 2) };
  assert.ok(!collapsePlan([...building, remote], ['f0c0'], 'meteor').some(p => p.id === 'remote'));
});
test('a missing adjacent floor does not transfer support failure across empty space', () => {
  const gap = building.filter(p => p.floor !== 1);
  assert.ok(collapsePlan(gap, ['f0c0'], 'meteor').every(p => p.id.startsWith('f0')));
});
test('deterministic random input keeps a reproducible ordered plan', () => {
  assert.deepEqual(collapsePlan(building, ['f0c0'], 'rocket', () => 0.7), collapsePlan(building, ['f0c0'], 'rocket', () => 0.7));
  const result = collapsePlan(building, new Set(['f0c0']), 'rocket', () => NaN);
  assert.ok(result.every((p, i) => Number.isFinite(p.delay) && (!i || p.delay >= result[i - 1].delay)));
});
test('dust begins only with real moving damage', () => {
  for (const quality of ['low', 'balanced', 'high']) {
    assert.equal(dustBudget(0, 20, quality), 0);
    assert.equal(dustBudget(20, 0, quality), 0);
    assert.equal(dustBudget(-10, 20, quality), 0);
    assert.equal(dustBudget(Infinity, 20, quality), 0);
    assert.equal(dustBudget(20, NaN, quality), 0);
  }
});
test('dust grows monotonically with damage and motion and stays in its budget', () => {
  for (const quality of ['low', 'balanced', 'high']) {
    let last = 0;
    for (const volume of [0, 0.01, 1, 4, 16, 64, 256, 1024, 1e6]) {
      const count = dustBudget(volume, 12, quality);
      assert.ok(Number.isInteger(count) && count >= last && count <= qualityProfile(quality).dust);
      last = count;
    }
    assert.ok(dustBudget(30, 25, quality) >= dustBudget(30, 5, quality));
  }
});
test('quality profiles have explicit mobile budgets and cannot mutate global settings', () => {
  assert.deepEqual(qualityProfile('low'), { pixelRatio: 0.9, maxPixels: 600000, dust: 45, fragments: 100, shadows: false, targetFps: 30 });
  assert.equal(qualityProfile('balanced').targetFps, 30);
  assert.equal(qualityProfile('high').targetFps, 60);
  assert.deepEqual(qualityProfile('unknown'), qualityProfile('balanced'));
  assert.deepEqual(qualityProfile('__proto__'), qualityProfile('balanced'));
  assert.deepEqual(qualityProfile('toString'), qualityProfile('balanced'));
  qualityProfile('low').dust = 99999;
  assert.equal(qualityProfile('low').dust, 45);
});
test('invalid weapon names use the rocket rules without inherited object settings', () => {
  assert.deepEqual(collapsePlan(building, ['f0c0'], '__proto__'), collapsePlan(building, ['f0c0'], 'rocket'));
});
