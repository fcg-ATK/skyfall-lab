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
test('upper-floor damage never destroys intact lower floors', () => {
  for (const weapon of ['rocket', 'meteor', 'ball']) {
    const result = collapsePlan(building, ['f4c2'], weapon);
    assert.ok(result.length > 0);
    assert.ok(result.every(p => building.find(b => b.id === p.id).floor >= 4));
  }
});
test('a base blast plans only local struck-storey fracture, not a timed upper wave', () => {
  const result = collapsePlan(building, ['f0c0'], 'meteor');
  assert.ok(result.length > 1);
  assert.ok(result.every(p=>p.id.startsWith('f0')), 'upper motion must come from current support, never a preset timer');
});

test('a local impact tears across a storey instead of releasing it as one synchronized ring', () => {
  const result=collapsePlan(building,['f0c0'],'meteor');
  const base=result.filter(p=>p.id.startsWith('f0')).map(p=>p.delay);
  assert.ok(Math.max(...base)-Math.min(...base)>.03 && Math.max(...base)<.5,'farther members must visibly follow the contact zone');
});
test('weapons produce distinct corner-hit collapse footprints', () => {
  const ball = collapsePlan(building, ['f0c0'], 'ball');
  const rocket = collapsePlan(building, ['f0c0'], 'rocket');
  const meteor = collapsePlan(building, ['f0c0'], 'meteor');
  assert.ok(ball.length >= 1, 'ball damages a meaningful supported column');
  assert.ok(rocket.length > ball.length);
  assert.ok(meteor.length > rocket.length);
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
