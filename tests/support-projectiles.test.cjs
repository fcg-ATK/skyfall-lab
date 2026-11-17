'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {engine}=require('./helpers/engine-harness.cjs');
function finish(game){let elapsed=0;while(['flight','watch'].includes(game.state)&&elapsed<12){game.step(1/30);elapsed+=1/30;}return elapsed;}
test('real peripheral base hit is partial, then opposite bearing loss can clear the tall residue without mandatory extra shots',async()=>{
 const game=await engine();game.setQuality('low');game.autoAim=false;game.orbit.yaw=0;
 for(const [shot,id] of [[1,0],[2,3]]){const p=game.parts.find(p=>p.id===id);Object.assign(game.aim,{x:p.rest.x,z:p.rest.z,height:p.rest.y,angle:0});
  assert.equal(game.fire('meteor'),true);finish(game);assert.ok(game.shotHits.length>0,'must use actual projectile triangle contacts');
  if(shot===1){assert.ok(game.damage>=30&&game.damage<50);assert.equal(game.shotFractures.filter(f=>f.cause==='overload').length,0);assert.equal(game.state,'ready');}
  else {assert.equal(game.damage,100);assert.ok(game.parts.every(p=>p.gone));assert.equal(game.shots,2);assert.equal(game.state,'finished');
   assert.deepEqual(Array.from(game.shotFractures.filter(f=>f.cause==='overload'),f=>f.id).sort((a,b)=>a-b),[1,2]);
   for(const id of [1,2]){const evidence=game.collapse.assessPart(id).failure;assert.ok(evidence.load>evidence.capacity&&evidence.unbracedHeight>20);}
  }
 }
});
test('empty aim and elapsed time cannot create support failures in an intact real building',async()=>{
 const game=await engine();game.setQuality('low');game.autoAim=false;Object.assign(game.aim,{x:200,z:200,height:10,angle:0});
 assert.equal(game.fire('meteor'),false);for(let i=0;i<90;i++)game.step(1/30);
 assert.equal(game.shots,0);assert.equal(game.damage,0);assert.ok(game.parts.every(p=>!p.gone&&!p.active));
 assert.ok(game.parts.every(p=>game.collapse.assessPart(p.id).failure===null));
});
