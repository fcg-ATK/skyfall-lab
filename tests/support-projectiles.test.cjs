'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {engine}=require('./helpers/engine-harness.cjs');
const vm=require('node:vm'),{context}=require('./helpers/engine-harness.cjs');
function finish(game){let elapsed=0;while(['flight','watch'].includes(game.state)&&elapsed<20){
 game.step(1/30);elapsed+=1/30;
 for(const part of game.parts.filter(p=>!p.gone)){
  assert.ok([...part.node.position.toArray(),...part.node.quaternion.toArray()].every(Number.isFinite),'coupled architecture must never run away to a nonfinite pose');
  assert.ok(game.collapse.bottom(part)>-1,'late coherent tipping must remain contained above terrain');
  assert.ok(part.vel.length()<50,'a long collapse cannot hide an accelerating body beneath terrain');
 }
}return elapsed;}
test('real peripheral hits retain grounded foundations through later physical wall cascades',async()=>{
 const game=await engine();game.setQuality('low');game.autoAim=false;game.orbit.yaw=0;
 // This seed reproduces the former 12 s cutoff while a genuine upper strip
 // is still falling. It must finish by contact, without an engine timeout.
 vm.runInContext('Math.random=(()=>{let n=2137;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}})()',context);
 let previousDamage=0;
 for(const [shot,id] of [[1,0],[2,5]]){const p=game.parts.find(p=>p.id===id);Object.assign(game.aim,{x:p.rest.x,z:p.rest.z,height:p.rest.y,angle:0});
  assert.equal(game.fire('meteor'),true);const elapsed=finish(game);assert.ok(elapsed<20,'even a large peripheral collapse must naturally settle in a bounded observation window');assert.ok(game.shotHits.length>0,'must use actual projectile triangle contacts');
  assert.ok(game.damage>previousDamage&&game.damage<100);
  assert.equal(game.shots,shot);assert.equal(game.state,'ready');
  assert.ok(game.parts.every(part=>part.gone||!part.active),'ready must mean the architecture really settled');
  // The first local strike leaves supported upper architecture. A second
  // physical wall cascade can legitimately consume that upper remnant; its
  // surviving grounded foundations must still keep their actual bearings.
  if(shot===1)assert.ok(game.parts.some(part=>part.floor>0&&!part.gone&&game.collapse.assessPart(part).anchored));
  const foundations=game.parts.filter(part=>part.floor===0&&!part.gone);
  assert.ok(foundations.length>0,'peripheral damage must leave real grounded structure');
  for(const part of foundations){
   assert.equal(game.collapse.assessPart(part).anchored,true);
   assert.ok(!part.active&&part.node.position.distanceTo(part.rest)<1e-8,'a surviving grounded bearing keeps its original stable pose');
  }
  for(const {id} of game.shotFractures.filter(f=>f.cause==='overload')){
   const evidence=game.collapse.assessPart(id).failure;assert.ok(evidence.load>evidence.capacity&&evidence.unbracedHeight>20);
  }
  previousDamage=game.damage;
 }
});
test('empty aim and elapsed time cannot create support failures in an intact real building',async()=>{
 const game=await engine();game.setQuality('low');game.autoAim=false;Object.assign(game.aim,{x:200,z:200,height:10,angle:0});
 assert.equal(game.fire('meteor'),false);for(let i=0;i<90;i++)game.step(1/30);
 assert.equal(game.shots,0);assert.equal(game.damage,0);assert.ok(game.parts.every(p=>!p.gone&&!p.active));
 assert.ok(game.parts.every(p=>game.collapse.assessPart(p.id).failure===null));
});
