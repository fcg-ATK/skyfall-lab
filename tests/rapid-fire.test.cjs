'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, T } = require('./helpers/engine-harness.cjs');

async function freeGame() {
  const game = await engine();
  game.freeMode = true;
  game.setQuality('low');
  game.reset();
  Object.assign(game.orbit, { yaw: 0, pitch: 0, height: 10 });
  return game;
}

function pickFacade(game, x, height) {
  game.updateCamera();
  const p = new T.Vector3(x, height, 5).project(game.camera);
  const rect = game.canvas.getBoundingClientRect();
  assert.equal(game.pick(rect.left + (p.x + 1) * rect.width / 2,
    rect.top + (1 - p.y) * rect.height / 2), true, 'tap selects a live facade');
  return game.traceAim().contacts[0].object.userData.part;
}

function events(game, name) {
  return game.events.filter(event => event.name === name);
}

function stepUntil(game, predicate, maxFrames) {
  for (let frame = 0; frame < maxFrames && !predicate(); frame++) game.step(0.05);
  assert.ok(predicate(), 'expected state reached within the simulated time limit');
}

test('two immediate shots retain separate trajectories, hit both selected targets, and settle together', async () => {
  const game = await freeGame();
  const settlement = [];
  const recordEvent = game.onEvent;
  game.onEvent = (name, data) => {
    if (name === 'shotFinished' || name === 'finished') {
      settlement.push({ data, projectilesRemaining: game.activeShots.length });
    }
    recordEvent(name, data);
  };
  const left = pickFacade(game, -4, 20);
  assert.equal(game.fire('ball'), true);
  const ball = game.shot;
  const firstMesh = game.projectile;
  game.step(0.05);
  const inFlightPosition = firstMesh.position.clone();
  const right = pickFacade(game, 3.5, 21);
  assert.notEqual(right.id, left.id);
  assert.equal(game.fire('rocket'), true, 'second shot launches before the first impact');
  const rocket = game.shot;
  const secondMesh = game.projectile;
  assert.equal(events(game, 'impact').length, 0);
  assert.equal(game.shots, 2);
  assert.notEqual(firstMesh, secondMesh);
  assert.ok(firstMesh.position.equals(inFlightPosition), 're-aiming and launching leave the first shot in place');
  const secondStart = secondMesh.position.clone();
  game.step(0.05);
  assert.ok(firstMesh.position.distanceTo(inFlightPosition) > 0);
  assert.ok(secondMesh.position.distanceTo(secondStart) > 0);

  // The faster, later shot must finish first while the older ball keeps flying.
  stepUntil(game, () => events(game, 'impact').length > 0, 40);
  assert.equal(events(game, 'impact')[0].data.weapon, 'rocket');
  assert.equal(ball.hit, false);
  assert.equal(right.gone, true);
  assert.equal(events(game, 'shotFinished').length, 0);
  stepUntil(game, () => ball.hit, 100);
  assert.ok(ball.penetrated.has(left.id));
  assert.ok(rocket.penetrated.has(right.id));
  const launches = events(game, 'launch').map(event => event.data);
  assert.notEqual(launches[0].shotId, launches[1].shotId);
  assert.deepEqual(events(game, 'impact').map(event => event.data.shotId), [launches[1].shotId, launches[0].shotId]);

  stepUntil(game, () => ['ready', 'finished'].includes(game.state), 650);
  assert.equal(settlement.length, 1);
  assert.equal(settlement[0].projectilesRemaining, 0);
  assert.equal(settlement[0].data.volleyShots, 2);
  assert.equal(settlement[0].data.shotDamage, game.damage);
  for (let frame = 0; frame < 15; frame++) game.step(0.05);
  assert.equal(settlement.length, 1);
});

test('a destroyed aim gives emptyAim during collapse and permits an immediate new shot at surviving geometry', async () => {
  const game = await freeGame();
  const roof = pickFacade(game, 3.5, 21);
  assert.equal(game.fire('rocket'), true);
  stepUntil(game, () => events(game, 'impact').length === 1, 40);
  assert.equal(game.state, 'watch');
  assert.equal(roof.gone, true);
  assert.equal(game.traceAim().contacts.length, 0, 'the shot removed the only surface along this ray');
  assert.equal(game.fire('ball'), false);
  assert.equal(events(game, 'emptyAim').length, 1);
  assert.equal(game.shots, 1);
  assert.equal(game.remainingAmmo, Infinity);
  assert.equal(events(game, 'shotFinished').length, 0);

  pickFacade(game, -4, 20);
  assert.equal(game.fire('ball'), true, 'valid shot is accepted while the structure is settling');
  assert.equal(game.shots, 2);
  const inFlight = Array.from(game.activeShots);
  assert.equal(game.pick(2, 2), false);
  assert.equal(game.fire('meteor'), false);
  assert.equal(events(game, 'emptyAim').length, 2);
  assert.equal(events(game, 'launch').length, 2);
  assert.equal(game.shots, 2);
  assert.deepEqual(Array.from(game.activeShots), inFlight);
});

test('reset cancels all in-flight shots and their impacts before starting a new round', async () => {
  const game = await freeGame();
  assert.equal(game.fire('ball'), true);
  const firstMesh = game.projectile;
  assert.equal(game.fire('rocket'), true);
  const secondMesh = game.projectile;
  assert.notEqual(firstMesh, secondMesh);
  game.reset();
  assert.equal(game.activeShots.length, 0);
  assert.equal(game.shots, 0);
  for (const mesh of [firstMesh, secondMesh]) assert.ok(!mesh.parent || !mesh.visible);
  for (let frame = 0; frame < 50; frame++) game.step(0.05);
  assert.equal(game.score, 0);
  assert.equal(game.state, 'ready');
  assert.equal(events(game, 'impact').length, 0);
  assert.equal(events(game, 'shotFinished').length, 0);
  assert.equal(game.fire('meteor'), true);
  assert.equal(game.shots, 1);
});
