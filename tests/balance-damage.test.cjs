'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collapsePlan } = require('../dist/physics.js');
const Solver = require('../dist/collapse-solver.js');
const manifest = require('../dist/assets/mobile-building.json');
function fixture(source=manifest.pieces,heights=manifest.floorHeights) {
 const parts=source.map(p=>({...p,rest:{...p.center},node:{position:{...p.center}},vel:{x:0,y:0,z:0},active:false,gone:false}));
 const fractures=[];
 const solver=Solver.create(parts,{floorHeights:heights,groundAt:()=>heights[0],activate(p){p.active=true;},fracture(p,event){
  fractures.push({id:p.id,...event,wasActive:p.active,wasGone:p.gone,assessment:event.cause==='overload'?solver.assessPart(p):null});
  p.gone=true;p.active=true;
 }});
 return {parts,solver,fractures};
}
// These tests isolate local bearing/bridge rules from full-height slenderness.
function shortFixture(){return fixture(Array.from({length:16},(_,id)=>({id,floor:Math.floor(id/8),cell:id%8,center:{x:(id%4)*2,y:1.5+Math.floor(id/8)*3,z:Math.floor((id%8)/4)*2},halfExtents:{x:1,y:1.5,z:1}})),[0,3,6]);}
test('actual manifest blast stays within each weapon centre radius despite overlapping bounds',()=>{
 const radii={ball:6.5,rocket:4.2,meteor:5.5};
 for(const weapon of ['ball','rocket','meteor'])for(const hit of manifest.pieces){
  const plan=collapsePlan(manifest.pieces,[hit.id],weapon,()=>.5);
  const primary=plan.filter(e=>manifest.pieces[e.id].floor===hit.floor);
  const secondary=plan.filter(e=>manifest.pieces[e.id].floor!==hit.floor);
  const expected=manifest.pieces.filter(p=>p.floor===hit.floor&&Math.hypot(p.center.x-hit.center.x,p.center.z-hit.center.z)<=radii[weapon]).map(p=>p.id);
  assert.deepEqual(primary.map(e=>e.id).sort((a,b)=>a-b),expected,`${weapon} sector ${hit.id}: use centre distance, never overlapping AABB distance`);
  assert.ok(secondary.length<=(weapon==='rocket'?2:0));
  assert.ok(secondary.every(e=>[hit.floor-1,hit.floor-2].includes(manifest.pieces[e.id].floor)&&manifest.pieces[e.id].cell===hit.cell));
 }
});
test('below 35% support releases unsupported cells while short surviving bearings stay fixed',()=>{
 const {parts,solver}=shortFixture();
 for(const p of parts)if(p.floor===0&&p.cell<6)p.gone=true;
 solver.step(1/120);
 assert.ok(parts.filter(p=>p.floor===1&&p.cell<6).every(p=>p.active));
 assert.ok(parts.filter(p=>p.floor>0&&p.cell>=6).every(p=>!p.active&&p.node.position.y===p.rest.y),'supported siblings must never join whole-floor release');
 const d=solver.diagnostics().find(d=>d.floor===1);
 assert.equal(d.threshold,.35);assert.equal(d.bearing,2);assert.equal(d.ratio,.25);
 assert.equal(d.falling.length,6);assert.equal(d.reason,'local support loss');
});
test('a compact interior gap can bridge but a disconnected island cannot borrow support',()=>{
 const {parts,solver}=shortFixture();parts.find(p=>p.floor===0&&p.cell===1).gone=true;
 solver.step(1/120);
 assert.ok(!parts.find(p=>p.floor===1&&p.cell===1).active);
 const d=solver.diagnostics().find(d=>d.floor===1);
 assert.ok(d.bridged.includes(9));assert.equal(d.reason,'bridged gap');
 for(const p of parts)if(p.floor===1&&[0,2,5].includes(p.cell))p.gone=true;
 solver.step(1/120);
 assert.ok(parts[9].active,'gap lost both horizontal anchors');
});
test('35% bearing ratio decides whether opposing anchors can bridge an interior gap',()=>{
 for(const cells of [[0,2],[0,2,3]]){
  const {parts,solver}=shortFixture();
  for(const p of parts)if(p.floor===0&&!cells.includes(p.cell))p.gone=true;
  solver.step(1/120);
  assert.equal(parts[9].active,cells.length===2,`support ratio ${cells.length}/8`);
  assert.equal(solver.diagnostics()[1].bridged.includes(9),cells.length===3);
 }
});
function runBlast(weapon,hitId){
 const scene=fixture(),{parts,solver,fractures}=scene,plan=collapsePlan(parts,[hitId],weapon,()=>.5),applied=new Set();
 for(let i=0;i<1200;i++){
  for(const e of plan)if(i/120>=e.delay){applied.add(e.id);parts[e.id].gone=true;}
  const changed=solver.step(1/120);
  const explained=new Set([...applied,...fractures.map(e=>e.id)]);
  assert.ok(parts.every(p=>!p.gone||explained.has(p.id)),`${weapon} sector ${hitId}: every newly removed member needs direct blast or recorded physical failure`);
  if(!changed&&i/120>=Math.max(...plan.map(e=>e.delay))&&!parts.some(p=>p.active&&!p.gone))break;
 }
 return scene;
}
test('every middle-floor cascade has unique overload or compression evidence rather than a damage-percentage clear',()=>{
 const causes=new Set();
 for(const weapon of ['ball','rocket','meteor'])for(const hit of manifest.pieces.filter(p=>p.floor>=1&&p.floor<=4)){
  const {fractures}=runBlast(weapon,hit.id);
  assert.equal(new Set(fractures.map(e=>e.id)).size,fractures.length,'one structural failure per member');
  for(const event of fractures){
   const label=`${weapon} sector ${hit.id}, failed member ${event.id}`;
   assert.equal(event.wasGone,false,label);
   assert.ok(Number.isFinite(event.energy)&&event.energy>=1.5,label);
   assert.ok(['x','y','z'].every(axis=>Number.isFinite(event.point?.[axis])),label);
   causes.add(event.cause);
   if(event.cause==='overload'){
    const state=event.assessment;
    assert.equal(event.wasActive,false,label);
    assert.equal(state.anchored,true,label);
    assert.equal(state.reason,'overload',label);
    assert.ok(Number.isFinite(state.load)&&Number.isFinite(state.capacity)&&state.capacity>0&&state.load>state.capacity,label);
    assert.ok(state.carriedIds.length>0,label);
   }else{
    assert.equal(event.cause,'compression',label);
    assert.ok(event.wasActive||event.energy>=18,`${label}: an intact bearing needs a major incoming impact`);
   }
  }
 }
 assert.ok(causes.has('compression')&&causes.has('overload'),'matrix must exercise both physical cascade paths');
});
test('an ordinary peripheral blast leaves other grounded load paths intact',()=>{
 const {parts,solver}=runBlast('meteor',0),survivors=parts.filter(p=>!p.gone);
 assert.ok(parts.some(p=>p.gone)&&survivors.length>0,'ordinary damage must not trigger a global clear');
 assert.ok(survivors.some(p=>p.floor>0&&!p.active&&solver.assessPart(p).anchored),'a surviving upper path must still connect to ground');
});
test('diagnostics are detached and reset clears temporary support state',()=>{
 const {parts,solver}=fixture();parts[0].gone=true;solver.step(1/120);
 const snapshot=solver.diagnostics();snapshot[1].falling.push('external');
 assert.ok(!solver.diagnostics()[1].falling.includes('external'));
 for(const p of parts){p.gone=p.active=false;p.node.position={...p.rest};p.vel={x:0,y:0,z:0};}
 solver.reset();solver.step(1/120);
 assert.ok(solver.diagnostics().every(d=>d.ratio===1&&d.reason==='bearing'));
});
