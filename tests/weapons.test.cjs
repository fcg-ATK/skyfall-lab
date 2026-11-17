'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collapsePlan}=require('../dist/physics.js');
const manifest=require('../dist/assets/mobile-building.json');
const {engine}=require('./helpers/engine-harness.cjs');
function settle(game){let seconds=0;while(seconds<12&&!['ready','finished'].includes(game.state)){game.step(1/30);seconds+=1/30;}return seconds;}
test('ball local blast cannot use overlapping bounds to reach remote members or another floor',()=>{
 const pieces=[0,.1,1000].map((x,id)=>({id,floor:0,cell:id,center:{x,y:1.5,z:0},halfExtents:{x:2000,y:1.5,z:2000}}));
 pieces.push({...pieces[1],id:3,floor:1,center:{x:.1,y:4.5,z:0}});
 assert.deepEqual(collapsePlan(pieces,[0],'ball').map(e=>e.id),[0,1]);
});
test('rocket first contact cuts at most two physically touching same-column storeys below',()=>{
 const plan=collapsePlan(manifest.pieces,[38],'rocket',()=>.5);
 assert.ok(plan.some(e=>e.id===30&&e.delay>0&&e.delay<.3));
 assert.deepEqual(plan.filter(e=>manifest.pieces[e.id].floor<4).map(e=>e.id),[30,22]);
 assert.ok(plan.every(e=>[2,3,4].includes(manifest.pieces[e.id].floor)));
 assert.ok(plan.find(e=>e.id===22).delay>plan.find(e=>e.id===30).delay);
});
test('tandem is not multiplied by duplicate or additional contacted members',()=>{
 const plan=collapsePlan(manifest.pieces,[38,38,36],'rocket',()=>.5);
 assert.deepEqual(plan.filter(e=>manifest.pieces[e.id].floor<4).map(e=>e.id),[30,22]);
});
test('rocket cannot skip a broken or displaced second link to reach a remote lower floor',()=>{
 const cases=[manifest.pieces.filter(p=>p.id!==22),manifest.pieces.map(p=>p.id===22?{...p,center:{...p.center,y:p.center.y-1}}:p)];
 for(const pieces of cases){
  const lower=collapsePlan(pieces,[38],'rocket').filter(e=>pieces.find(p=>p.id===e.id).floor<4);
  assert.deepEqual(lower.map(e=>e.id),[30]);
 }
});
test('tandem cannot jump missing floors, noncontacting geometry or absent column metadata',()=>{
 const inputs=[manifest.pieces.filter(p=>p.floor!==3),manifest.pieces.map(p=>({...p,cell:undefined})),manifest.pieces.map(p=>p.id===30?{...p,center:{...p.center,x:p.center.x+8}}:p),manifest.pieces.map(p=>p.id===30?{...p,center:{...p.center,y:p.center.y-1}}:p)];
 for(const pieces of inputs)assert.ok(collapsePlan(pieces,[38],'rocket').every(e=>pieces.find(p=>p.id===e.id).floor===4));
 assert.deepEqual(collapsePlan(manifest.pieces,[],'rocket'),[]);
});
test('ball fractures every real through-flight contact while keeping lateral blast limited',async()=>{
 const game=await engine();game.setQuality('low');game.orbit.yaw=.68;game.autoAim=false;
 Object.assign(game.aim,{x:game.parts[0].rest.x,z:game.parts[0].rest.z,height:3,angle:0});
 const impact=game.impact;let firstBlast;
 game.impact=function(point,part){impact.call(this,point,part);firstBlast??=new Set(this.parts.filter(p=>p.blast).map(p=>p.id));};
 assert.equal(game.fire('ball'),true);settle(game);
 assert.ok(game.shotHits.length>=2,'projectile must still encounter and pass through real exit geometry');
 assert.equal(game.shot.stopped,false,'precision must not silently cancel the required through-flight');
 for(const [index,id] of game.shotHits.entries()){
  assert.equal(game.parts[id].gone,true,'a real rear contact must break its structural member');
  assert.equal(game.parts[id].direct,true);
  const fractures=game.shotFractures.filter(e=>e.id===id);
  assert.equal(fractures.length,1,'entry and exit triangles in one member must not double-score');
  assert.equal(fractures[0].cause,index===0?'impact':'penetration');
 }
 assert.ok(game.shotFractures.filter(e=>e.cause==='blast').every(e=>firstBlast.has(e.id)),
  'later impacts cannot expand the first contact local blast plan');
 assert.ok(game.events.some(e=>e.name==='penetration'));
});
test('rocket actual projectile cuts two adjacent-lower bearings and does not repeat on exit',async()=>{
 const game=await engine();game.setQuality('low');game.orbit.yaw=.68;game.autoAim=false;
 Object.assign(game.aim,{x:game.parts[32].rest.x,z:game.parts[32].rest.z,height:17,angle:0});
 assert.equal(game.fire('rocket'),true);settle(game);
 const first=game.parts[game.shotHits[0]],lower=game.shotFractures.filter(e=>e.cause!=='compression'&&game.parts[e.id].floor<first.floor);
 assert.equal(lower.length,2);
 assert.deepEqual(Array.from(lower,e=>game.parts[e.id].floor),[first.floor-1,first.floor-2]);
 assert.ok(lower.every(e=>game.parts[e.id].cell===first.cell));
 assert.ok(game.damage<100);assert.equal(game.state,'ready');
});
