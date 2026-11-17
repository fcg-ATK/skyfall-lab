'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {engine, T, context} = require('./helpers/engine-harness.cjs');

test('support release feedback stays cosmetic, is throttled, and resets for another experiment', async () => {
  const game = await engine();
  const part = game.parts.find(p => p.floor === 2);
  const event = {parts:[part.id], point:part.rest.clone(), direction:{x:1,y:0,z:0}, floor:2, kind:'tipping', mass:3};
  const score = game.score;
  assert.equal(typeof game.structuralRelease, 'function');
  for(let i=0;i<20;i++)game.structuralRelease(event);
  assert.equal(game.events.filter(e=>e.name==='strain').length,1,'one audible warning per floor wave');
  assert.equal(game.score,score);
  assert.ok(game.parts.every(p=>!p.gone&&!p.active),'feedback cannot create structural destruction');
  assert.ok(game.impactFX.stats().active>0,'a real release leaves visible seam dust');
  assert.ok(game.impactFX.stats().active<=game.impactFX.stats().capacity);
  game.reset();
  assert.equal(game.impactFX.stats().active,0);
  game.structuralRelease(event);
  assert.equal(game.events.filter(e=>e.name==='strain').length,2,'reset starts a fresh release wave');
});

test('normal projectile contact produces support-release feedback before the round settles', async () => {
  vm.runInContext('Math.random=(()=>{let n=719;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}})()', context);
  const game = await engine();
  game.orbit.yaw=0; Object.assign(game.aim,{x:-8,z:7,height:10,angle:0});
  assert.equal(game.fire('rocket'),true);
  let seconds=0;
  while(['flight','watch'].includes(game.state)&&seconds<30){game.step(1/30);seconds+=1/30;}
  const impact=game.events.findIndex(e=>e.name==='impact');
  const release=game.events.findIndex(e=>e.name==='strain');
  assert.ok(impact>=0&&release>impact,'strain is caused by actual support loss after contact');
  const signal=game.events[release].data;
  assert.ok(['tipping','dropping'].includes(signal.kind));
  assert.ok(Number.isFinite(signal.energy)&&signal.energy>0);
  assert.equal(game.state,'ready','new motion must still settle and allow another shot');
  assert.ok(seconds<30,'wall-constrained motion must reach its physical end before the finite observation guard');
  const settled=game.events.findIndex(e=>e.name==='shotFinished');
  assert.ok(settled>release,'the real support warning occurs before natural shot settlement');
  assert.equal(game.events.filter(e=>e.name==='shotFinished').length,1,'release waves cannot settle the accepted shot twice');
  assert.equal(game.events.filter(e=>e.name==='finished').length,0);
  assert.ok(game.parts.every(p=>p.gone||!p.active),'release feedback cannot rearm while intact architecture still moves');
  assert.ok(game.parts.filter(p=>!p.gone).every(p=>[...p.node.position.toArray(),...p.node.quaternion.toArray(),...p.vel.toArray(),...p.spin.toArray()].every(Number.isFinite)));
});
