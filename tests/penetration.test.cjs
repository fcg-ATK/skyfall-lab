'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./helpers/engine-harness.cjs');

// These distinct members are intersected by actual authored GLB surfaces.
// A long single sweep isolates direct entry/rear damage before delayed blasts
// and structural motion can mask an undamaged rear member.
const trajectories=[
 {yaw:.68,angle:0,ids:[22,17]},
 {yaw:.68,angle:20,ids:[30,22,17,9,8]},
 {yaw:1.57,angle:0,ids:[23,20]},
];
for(const weapon of ['rocket','meteor','ball'])for(const trajectory of trajectories){
 test(`penetration: ${weapon} yaw${trajectory.yaw} angle${trajectory.angle} breaks actual front and rear exactly once`,async()=>{
  const g=await engine();g.setQuality('low');g.orbit.yaw=trajectory.yaw;
  Object.assign(g.aim,{x:0,z:0,height:10,angle:trajectory.angle});
  assert.equal(g.fire(weapon),true);
  const originalImpact=g.impact;let firstBlast=null;
  g.impact=function(point,part){
   originalImpact.call(this,point,part);
   const planned=this.parts.filter(p=>p.blast).map(p=>[p.id,p.delay]);
   if(firstBlast===null)firstBlast=planned;
   else assert.deepEqual(planned,firstBlast,'rear contacts must not start another lateral explosion plan');
  };
  g.shot.speed=1500;g.step(.05);
  assert.deepEqual(Array.from(g.shotHits),trajectory.ids,'sorted real triangle contacts must include distinct rear members');
  for(const [index,id] of trajectory.ids.entries()){
   assert.equal(g.parts[id].gone,true,`${weapon} contact ${id} must actually fracture`);
   assert.equal(g.parts[id].direct,true);
   const recorded=g.shotFractures.filter(f=>f.id===id);
   assert.equal(recorded.length,1);
   assert.equal(recorded[0].cause,index===0?'impact':'penetration');
  }
  assert.equal(g.score,trajectory.ids.length*100,'multiple surface triangles cannot award duplicate structural points');
  const score=g.score;for(const id of trajectory.ids)originalImpact.call(g,g.parts[id].rest.clone(),g.parts[id]);
  assert.equal(g.score,score);
  assert.equal(g.shot.stopped,false);assert.ok(g.shot.traveled>60);
  assert.equal(g.events.filter(e=>e.name==='impact').length,1);
  assert.equal(g.events.filter(e=>e.name==='penetration').length,1);
 });
}

for(const weapon of ['rocket','meteor','ball']){
 test(`penetration: ${weapon} exiting into empty sky cannot invent a rear member`,async()=>{
  const g=await engine();g.orbit.yaw=.68;Object.assign(g.aim,{x:0,z:0,height:10,angle:0});
  for(const p of g.parts)if(p.id!==22){p.gone=true;p.node.visible=false;}
  assert.equal(g.fire(weapon),true);g.shot.speed=1500;g.step(.05);
  assert.deepEqual(Array.from(g.shotHits),[22]);assert.equal(g.score,100);
  assert.equal(g.events.filter(e=>e.name==='penetration').length,0,'exit visuals require another real contact');
  assert.equal(g.shotFractures.length,1);
 });
}
