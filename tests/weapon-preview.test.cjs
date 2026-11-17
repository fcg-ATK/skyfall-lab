'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collapsePlan } = require('../dist/physics.js');
const { engine } = require('./helpers/engine-harness.cjs');

function member(id, x, y, floor = 0) {
  return { id, floor, cell: id, center: { x, y, z: 0 }, halfExtents: { x: 1, y: 1.5, z: 1 } };
}

test('precision ball never schedules damage to neighboring structure', () => {
  const parts = [member(0, 0, 1.5), member(1, 0.1, 1.5), member(2, 4, 1.5)];
  assert.deepEqual(collapsePlan(parts, [0], 'ball').map(p => p.id), [0]);
});

test('meteor has a bounded local volume centered on its actual contact', () => {
  const parts = [member(0, 0, 1.5), member(1, 5, 1.5), member(2, 0, 4.5, 1),
    member(3, 5, 4.5, 1), member(4, 0, 7.5, 2), member(5, 8, 1.5)];
  assert.deepEqual(collapsePlan(parts, [0], 'meteor').map(p => p.id).sort(), [0, 1, 2]);
  const shifted = collapsePlan(parts, [0], 'meteor', () => 0.5, { x: -2, y: 1.5, z: 0 });
  assert.ok(!shifted.some(p => p.id === 1), 'range follows the surface contact rather than the part center');
});

for (const weapon of ['ball', 'rocket', 'meteor']) {
  test(`${weapon} stops after its allowed actual contacts and remains playable`, async () => {
    const game = await engine();
    assert.equal(game.fire(weapon), true);
    game.shot.speed = 1500;
    game.step(0.05);
    const contactLimit = weapon === 'ball' ? 2 : 1;
    assert.equal(game.shotHits.length, contactLimit);
    assert.equal(game.shot.stopped, true);
    assert.equal(new Set(game.shotHits).size, contactLimit);
    assert.equal(game.shotFractures.filter(p => p.cause === 'impact' || p.cause === 'penetration').length, contactLimit);
    assert.equal(game.events.filter(e => e.name === 'impact').length, 1);
    // Real secondary wall contacts may extend a collapse beyond twelve seconds.
    // Advance normal frames until natural settlement, with a finite liveness cap.
    let seconds=0;
    while(seconds<30&&['flight','watch'].includes(game.state)){game.step(1/30);seconds+=1/30;}
    assert.ok(['ready', 'finished'].includes(game.state),`${weapon} must settle naturally within 30 seconds (state ${game.state})`);
    assert.equal(game.projectile.visible, false);
    assert.ok(game.damage > 0);
    const ledger=Array.from(game.shotFractures,p=>p.id);
    assert.equal(new Set(ledger).size,ledger.length,'secondary collisions cannot award a member twice');
    assert.equal(game.score,ledger.length*100+game.ammoBonus);
    const settlements=()=>game.events.filter(e=>e.name==='shotFinished'||e.name==='finished');
    assert.equal(settlements().length,1,'the accepted shot produces one settlement event');
    assert.equal(game.shots,1);assert.equal(game.remainingAmmo,3);
    for(let i=0;i<15;i++)game.step(1/30);
    assert.equal(settlements().length,1,'continued debris animation cannot repeat settlement');
    if(game.state==='ready'){
      assert.equal(game.retargetAim(),true,'a surviving real face remains available');
      const score=game.score;
      assert.equal(game.fire('ball'),true,'natural settlement permits the next normal shot');
      assert.equal(game.shots,2);assert.equal(game.remainingAmmo,2);assert.equal(game.score,score);
    }else{
      assert.equal(game.damage,100);assert.equal(game.fire('ball'),false);
    }
  });
}
