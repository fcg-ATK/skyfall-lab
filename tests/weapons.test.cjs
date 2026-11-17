'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collapsePlan}=require('../dist/physics.js');
const manifest=require('../dist/assets/mobile-building.json');
const {engine}=require('./helpers/engine-harness.cjs');
function settle(game){let seconds=0;while(seconds<12&&!['ready','finished'].includes(game.state)){game.step(1/30);seconds+=1/30;}return seconds;}
test('ball has no lateral blast even when neighboring bounds overlap',()=>{
 const pieces=[0,.1,1000].map((x,id)=>({id,floor:0,cell:id,center:{x,y:1.5,z:0},halfExtents:{x:2000,y:1.5,z:2000}}));
 pieces.push({...pieces[1],id:3,floor:1,center:{x:.1,y:4.5,z:0}});
 assert.deepEqual(collapsePlan(pieces,[0],'ball').map(e=>e.id),[0]);
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
test('ball fractures two real contacts then stops without lateral blast',async()=>{
 const game=await engine();game.setQuality('low');game.orbit.yaw=.68;game.autoAim=false;
 Object.assign(game.aim,{x:game.parts[0].rest.x,z:game.parts[0].rest.z,height:3,angle:0});
 const impact=game.impact;let firstBlast;
 game.impact=function(point,part){impact.call(this,point,part);firstBlast??=new Set(this.parts.filter(p=>p.blast).map(p=>p.id));};
 assert.equal(game.fire('ball'),true);settle(game);
 assert.equal(game.shotHits.length,2,'the ball may punch through one additional real structural member');
 assert.equal(game.shot.stopped,true,'the second member absorbs the remaining penetration');
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
 const impact=game.impact;let blastPlan=null;
 game.impact=function(point,part){impact.call(this,point,part);blastPlan??=this.parts.filter(p=>p.blast).map(p=>p.id);};
 const fragmentImpact=game.fragmentImpact,wallTargets=new Set();
 game.fragmentImpact=function(event){const result=fragmentImpact.call(this,event);if(result.broken)wallTargets.add(event.targetPartId);return result;};
 assert.equal(game.fire('rocket'),true);settle(game);
 assert.equal(game.shotHits.length,1,'a rocket detonates at its first real projectile contact');
 assert.equal(game.shot.maxContacts,1);assert.equal(game.shot.stopped,true);
 assert.deepEqual(Array.from(game.shot.penetrated),Array.from(game.shotHits));
 assert.deepEqual(Array.from(game.shotFractures.filter(e=>e.cause==='impact'||e.cause==='penetration'),e=>e.id),Array.from(game.shotHits));
 const first=game.parts[game.shotHits[0]],lower=blastPlan.map(id=>game.parts[id]).filter(p=>p.floor<first.floor).sort((a,b)=>b.floor-a.floor);
 assert.equal(lower.length,2);
 assert.deepEqual(Array.from(lower,p=>p.floor),[first.floor-1,first.floor-2]);
 assert.ok(lower.every(p=>p.cell===first.cell));
 for(const part of lower){
  const ledger=game.shotFractures.filter(e=>e.id===part.id);
  assert.equal(part.gone,true,'both planned adjacent bearings must fracture');
  assert.equal(ledger.length,1,'a bearing hit by debris before its blast timer still fractures once');
  assert.ok(['blast','fragment-impact','compression','overload','side-crush','side-impact'].includes(ledger[0].cause));
  if(ledger[0].cause==='fragment-impact')assert.ok(wallTargets.has(part.id),'early fragment damage requires a real successful wall contact');
 }
 assert.ok(game.shotFractures.filter(e=>e.cause==='blast').every(e=>blastPlan.includes(e.id)),'secondary damage cannot create extra tandem blast targets');
 const ids=Array.from(game.shotFractures,e=>e.id),score=game.score;
 assert.equal(new Set(ids).size,ids.length);assert.equal(score,ids.length*100);
 impact.call(game,first.rest.clone(),first);
 assert.deepEqual(Array.from(game.shotFractures,e=>e.id),ids);assert.equal(game.score,score);
 assert.deepEqual(Array.from(game.parts.filter(p=>p.blast),p=>p.id),Array.from(blastPlan),'replaying an exit cannot schedule another blast');
 assert.equal(game.events.filter(e=>e.name==='impact').length,1);
 assert.equal(game.events.filter(e=>e.name==='shotFinished').length,1,'one launch settles once');
 assert.ok(game.damage<100);assert.equal(game.state,'ready');
});
test('the refined building gets a compact neighboring rocket patch at every sector centre',async()=>{
 const game=await engine();
 for(const hit of game.parts){
  const plan=collapsePlan(game.parts,[hit.id],'rocket',()=>.5),primary=plan.filter(e=>game.parts[e.id].floor===hit.floor);
  assert.ok(primary.length>=2&&primary.length<=3,`sector ${hit.id}: adjacent pieces join the opening, not a lone shaft or whole storey`);
  assert.ok(primary.every(e=>game.parts[e.id].cell>=hit.cell-1&&game.parts[e.id].cell<=hit.cell+1),'the opening cannot skip neighboring cells');
  const lower=plan.filter(e=>game.parts[e.id].floor!==hit.floor);
  assert.ok(lower.length<=2&&lower.every(e=>game.parts[e.id].cell===hit.cell));
  const meteorPrimary=collapsePlan(game.parts,[hit.id],'meteor',()=>.5).filter(e=>game.parts[e.id].floor===hit.floor);
  assert.ok(primary.length<meteorPrimary.length,'the rocket opening remains smaller than the meteor footprint');
 }
});
