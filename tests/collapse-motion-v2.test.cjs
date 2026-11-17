'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Solver = require('../dist/collapse-solver.js');
function fixture(columns = 2, floors = 5, spacing = 4, storey = 3) {
 const parts = Array.from({length: columns * 2 * floors}, (_, id) => {
  const cell = id % (columns * 2), floor = Math.floor(id / (columns * 2));
  const rest = {x: (cell % columns) * spacing, y: floor * storey + storey / 2, z: Math.floor(cell / columns) * 4};
  return {id, cell, floor, rest, halfExtents: {x: spacing / 2, y: storey / 2, z: 2}, node: {position: {...rest}, quaternion: {x: 0, y: 0, z: 0, w: 1}}, vel: {x: 0, y: 0, z: 0}, spin: {x: 0, y: 0, z: 0}, gone: false, active: false};
 });
 const impacts = [], releases = [];
 const solver = Solver.create(parts, {groundAt: () => 0, floorHeights: Array.from({length: floors + 1}, (_, i) => i * storey),
  activate(p) {p.active = true; p.phase = 'falling';},
  fracture(p, event) {impacts.push({id: p.id, ...event}); p.gone = true; p.active = true;},
  onRelease(event) {releases.push(event);}
 });
 return {parts, solver, impacts, releases};
}
const advance = (solver, seconds) => {for (let i = 0; i < Math.round(seconds * 120); i++) solver.step(1 / 120);};
const angle = p => 2 * Math.atan2(p.node.quaternion.z, p.node.quaternion.w);

test('a surviving one-sided slab connection develops visible coherent lean before first impact', () => {
 for (const lostX of [0, 4]) {
  const {parts, solver, impacts} = fixture();
  for (const p of parts) if (p.floor === 0 && p.rest.x === lostX) p.gone = true;
  advance(solver, .5);
  const falling = parts.filter(p => p.floor > 0 && p.rest.x === lostX);
  const lean = angle(falling[0]), direction = lostX === 0 ? 1 : -1;
  assert.equal(impacts.length, 0, 'lean must develop during free descent, not after crushing');
  assert.ok(lean * direction > .045, `at least 2.6 degrees of preimpact lean, got ${lean}`);
  assert.ok(falling.every(p => Math.abs(angle(p) - lean) < 1e-8), 'still connected storeys rotate as one mass');
  assert.ok(falling.every(p => p.node.position.y < p.rest.y - .3), 'connection must not suspend the failed mass');
  assert.ok(parts.filter(p => p.floor > 0 && p.rest.x !== lostX).every(p => p.active && !p.gone && Math.abs(angle(p)-lean)<1e-8),'neighboring slab strip rotates with the unsupported side before fracture');
  assert.ok(parts.filter(p => p.floor === 0 && !p.gone).every(p => !p.active && p.node.position.y === p.rest.y),'grounded bearings remain fixed');
 }
});

test('opposing support connections cancel lean around a central bay too wide to bridge', () => {
 const {parts, solver, impacts} = fixture(3);
 for (const p of parts) if (p.floor === 0 && p.rest.x === 4) p.gone = true;
 advance(solver, .5);
 const central = parts.filter(p => p.floor > 0 && p.rest.x === 4);
 assert.ok(central.every(p => p.active && p.node.position.y < p.rest.y - .3));
 assert.ok(central.every(p => Math.abs(angle(p)) < .001 && Math.abs(p.node.position.x - p.rest.x) < .001));
 assert.equal(impacts.length, 0);
});

test('the release event exposes the actual surviving bearing once, after activating the coherent island', () => {
 const {parts, solver, releases} = fixture();
 for (const p of parts) if (p.floor === 0 && p.rest.x === 0) p.gone = true;
 advance(solver, .2);
 assert.equal(releases.length, 4, 'one event per newly released floor island');
 for (const event of releases) {
  assert.equal(event.kind, 'tipping');
  assert.equal(event.point.x, 4, 'the recruited upper strip now tips about its surviving lower bearing');
  assert.ok(event.direction.x < -.99 && event.direction.y === 0);
  assert.ok(event.mass > 0 && Number.isFinite(event.mass));
  assert.equal(event.parts.length, 4, 'the release includes both the failed and immediately recruited upper strips');
  assert.ok(event.parts.every(id => parts[id].active && parts[id].floor === event.floor));
 }
 const copy = JSON.stringify(releases);
 advance(solver, .2);
 assert.equal(JSON.stringify(releases), copy, 'saved event geometry must not follow moving pieces');
});

test('an entirely missing storey has no phantom hinge or sideways kick', () => {
 const {parts, solver, releases} = fixture();
 for (const p of parts) if (p.floor === 0) p.gone = true;
 advance(solver, .5);
 const falling = parts.filter(p => !p.gone);
 assert.ok(falling.every(p => p.active && p.node.position.y < p.rest.y - 1));
 assert.ok(falling.every(p => angle(p) === 0 && p.node.position.x === p.rest.x));
 assert.equal(releases.length, 4);
 assert.ok(releases.every(event => event.kind === 'dropping'));
});

test('a connecting bearing translated away after release cannot keep applying phantom hinge torque', () => {
 // A wide symmetric gap retains two outer seam connections without recruiting
 // its bearings. Moving one outer frame then opens the actual connection.
 const moved = fixture(3), removed = fixture(3);
 for (const sample of [moved, removed]) {
  for (const p of sample.parts) if (p.floor === 0 && p.rest.x === 4) p.gone = true;
  advance(sample.solver, .1);
 }
 for (const p of moved.parts) if (p.rest.x === 8) p.node.position.x += 20;
 for (const p of removed.parts) if (p.rest.x === 8) p.gone = true;
 advance(moved.solver, .1); advance(removed.solver, .1);
 for (const p of moved.parts.filter(p => p.rest.x === 4 && p.floor > 0)) {
  const other = removed.parts[p.id];
  assert.ok(Math.abs(angle(p) - angle(other)) < 1e-8, 'departed connection must open just like a destroyed one');
  assert.ok(Math.abs(p.node.position.y - other.node.position.y) < 1e-8);
 }
});

test('a refined-size 3.706 metre bay can bridge real opposing bearings until one is lost', () => {
 const {parts, solver, impacts} = fixture(3, 5, 3.706, 3.3);
 for (const p of parts) if (p.floor === 0 && p.cell % 3 === 1) p.gone = true;
 advance(solver, .3);
 const central = parts.filter(p => p.floor > 0 && p.cell % 3 === 1);
 assert.ok(central.every(p => !p.active && !p.gone && p.node.position.y === p.rest.y), 'one refined bay must not turn into an automatic vertical shaft');
 assert.equal(impacts.length, 0);
 for (const p of parts) if (p.floor === 0 && p.cell % 3 === 0) p.gone = true;
 advance(solver, .2);
 assert.ok(central.every(p => p.active && p.node.position.y < p.rest.y), 'loss of the opposing anchor removes the short span');
});

