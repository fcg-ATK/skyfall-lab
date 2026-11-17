'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./helpers/engine-harness.cjs');

// These distinct members are intersected by the refined authored fracture surfaces.
// A long single sweep isolates direct entry/rear contacts. Released physical
// fragments can also hit walls during that step; their ledger is separate.
const trajectories=[
 {yaw:.68,angle:0,ids:[70,56]},
 {yaw:.68,angle:20,ids:[94,87]},
 {yaw:1.57,angle:0,ids:[59,54]},
];
for(const weapon of ['rocket','meteor','ball'])for(const trajectory of trajectories){
 test(`penetration: ${weapon} yaw${trajectory.yaw} angle${trajectory.angle} respects its contact budget and scores once`,async()=>{
  const g=await engine();g.setQuality('low');g.orbit.yaw=trajectory.yaw;
  Object.assign(g.aim,{x:0,z:0,height:10,angle:trajectory.angle});
  assert.equal(g.fire(weapon),true);
  const fragmentImpact=g.fragmentImpact,wallContacts=[];
  g.fragmentImpact=function(event){
   const result=fragmentImpact.call(this,event);
   if(result.broken)wallContacts.push({event,result});
   return result;
  };
  const originalImpact=g.impact;let firstBlast=null;
  g.impact=function(point,part){
   originalImpact.call(this,point,part);
   const planned=this.parts.filter(p=>p.blast).map(p=>[p.id,p.delay]);
   if(firstBlast===null)firstBlast=planned;
   else assert.deepEqual(planned,firstBlast,'rear contacts must not start another lateral explosion plan');
  };
  g.shot.speed=1500;g.step(.05);
  const expected=trajectory.ids.slice(0,weapon==='ball'?2:1);
  assert.deepEqual(Array.from(g.shotHits),expected,'only the allowed nearest real contacts receive direct damage');
  assert.equal(g.shot.maxContacts,expected.length);
  assert.deepEqual(Array.from(g.shot.penetrated),expected,'secondary wall damage cannot consume projectile contacts');
  assert.deepEqual(Array.from(g.shotFractures.filter(f=>f.cause==='impact'||f.cause==='penetration'),f=>f.id),expected);
  for(const [index,id] of expected.entries()){
   assert.equal(g.parts[id].gone,true,`${weapon} contact ${id} must actually fracture`);
   assert.equal(g.parts[id].direct,true);
   const recorded=g.shotFractures.filter(f=>f.id===id);
   assert.equal(recorded.length,1);
   assert.equal(recorded[0].cause,index===0?'impact':'penetration');
  }
  const ledgerIds=Array.from(g.shotFractures,f=>f.id),uniqueIds=new Set(ledgerIds);
  assert.equal(uniqueIds.size,ledgerIds.length,'every structural member has one fracture ledger entry');
  assert.equal(g.score,uniqueIds.size*100,'direct and secondary physical fractures each award exactly 100 points');
  assert.equal(g.parts.filter(p=>p.gone).length,uniqueIds.size,'every newly removed member has a ledger entry');
  assert.equal(g.events.filter(e=>e.name==='fracture').length,uniqueIds.size);
  const secondaryIds=Array.from(g.shotFractures.filter(f=>f.cause==='fragment-impact'),f=>f.id);
  assert.deepEqual(secondaryIds,wallContacts.map(({event})=>event.targetPartId),'secondary fractures require successful actual fragment-wall callbacks');
  for(const {event,result} of wallContacts){
   assert.equal(event.type,'fragment-wall');assert.notEqual(event.sourcePartId,event.targetPartId);
   assert.ok(result.spentEnergy>0&&result.spentEnergy<=event.kineticEnergy);
   assert.equal(g.parts[event.targetPartId].direct,false,'a fragment wall hit is not another projectile detonation');
  }
  for(const fracture of g.shotFractures){
   assert.ok(['impact','penetration','blast','compression','overload','side-crush','side-impact','fragment-impact'].includes(fracture.cause));
   if(fracture.cause==='blast')assert.ok(firstBlast.some(([id])=>id===fracture.id),'secondary collisions cannot expand the initial blast');
  }
  const score=g.score;for(const id of trajectory.ids)originalImpact.call(g,g.parts[id].rest.clone(),g.parts[id]);
  for(const id of uniqueIds)g.fracturePart(g.parts[id]);
  for(const {event} of wallContacts)g.fragmentImpact(event);
  assert.equal(g.score,score);
  assert.deepEqual(Array.from(g.shotFractures,f=>f.id),ledgerIds,'repeated surface and fragment contacts cannot create duplicate fractures');
  assert.equal(g.shot.stopped,true);assert.ok(g.shot.traveled>0&&g.shot.traveled<75);
  assert.equal(g.events.filter(e=>e.name==='impact').length,1);
  assert.equal(g.events.filter(e=>e.name==='penetration').length,weapon==='ball'?1:0);
 });
}

for(const weapon of ['rocket','meteor','ball']){
 test(`penetration: ${weapon} exiting into empty sky cannot invent a rear member`,async()=>{
  const g=await engine();g.orbit.yaw=.68;Object.assign(g.aim,{x:0,z:0,height:10,angle:0});
  for(const p of g.parts)if(p.id!==70){p.gone=true;p.node.visible=false;}
  assert.equal(g.fire(weapon),true);g.shot.speed=1500;g.step(.05);
  assert.deepEqual(Array.from(g.shotHits),[70]);assert.equal(g.score,100);
  assert.equal(g.events.filter(e=>e.name==='penetration').length,0,'exit visuals require another real contact');
  assert.equal(g.shotFractures.length,1);
 });
}
