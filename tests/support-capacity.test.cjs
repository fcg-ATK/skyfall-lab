'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require('../dist/collapse-solver.js'),manifest=require('../dist/assets/mobile-building.json');
function actual(){const parts=manifest.pieces.map(p=>({...p,rest:{...p.center},node:{position:{...p.center}},vel:{x:0,y:0,z:0},active:false,gone:false})),events=[];
 const solver=Solver.create(parts,{floorHeights:manifest.floorHeights,groundAt:()=>.24,activate(p){p.active=true;},fracture(p,e){events.push({id:p.id,...e});p.gone=true;p.active=true;}});return{parts,solver,events};}
const advance=(solver,t)=>{for(let i=0;i<t*120;i++)solver.step(1/120);};
test('intact real building has finite grounded load paths and reserve, without spontaneous failure',()=>{
 const {parts,solver,events}=actual();advance(solver,.5);
 assert.equal(typeof solver.assessPart,'function');
 const base=solver.assessPart(1),roof=solver.assessPart(41);
 assert.equal(base.anchored,true);assert.ok(base.load>roof.load&&base.capacity>base.load);assert.ok(Number.isFinite(base.capacity));
 assert.deepEqual(roof.supportIds,[33]);assert.ok(base.carriedIds.includes(41));assert.equal(base.reason,'bearing');
 assert.equal(events.length,0);assert.ok(parts.every(p=>!p.active&&!p.gone));
});
test('peripheral bearing loss leaves the broad grounded residual stable',()=>{
 const {parts,solver,events}=actual();parts[0].gone=true;advance(solver,.2);
 assert.ok(parts.filter(p=>p.cell!==0).every(p=>!p.active&&!p.gone));
 assert.ok(parts.filter(p=>p.cell===0&&p.floor>0).every(p=>p.active));
 assert.equal(events.filter(e=>e.cause==='overload').length,0);
});
test('loss of the last transverse frame restraint buckles genuinely tall narrow residual columns',()=>{
 const {parts,solver,events}=actual();for(const p of parts)if(![1,2].includes(p.cell))p.gone=true;
 const before=solver.assessPart(1);assert.equal(before.anchored,true);assert.ok(before.unbracedHeight>20);
 assert.ok(before.load>before.capacity);assert.equal(before.reason,'overload');
 advance(solver,.15);
 assert.ok(events.some(e=>e.id===1&&e.cause==='overload'),'bearing must fail from measured local load/capacity');
 assert.ok(parts.filter(p=>p.floor>0&&[1,2].includes(p.cell)).every(p=>p.gone||p.active),'loss propagates through actual upper load paths');
 assert.ok(solver.assessPart(1).failure&&solver.assessPart(1).failure.load>solver.assessPart(1).failure.capacity,'failure evidence survives fracture');
});
test('short grounded remnant remains stable even when it is the only column',()=>{
 const {parts,solver,events}=actual();for(const p of parts)if(p.cell!==1||p.floor>1)p.gone=true;
 advance(solver,.5);assert.equal(events.length,0);assert.ok(parts.filter(p=>!p.gone).every(p=>!p.active));
 const state=solver.assessPart(1);assert.ok(state.capacity>state.load&&state.unbracedHeight<8);
});
test('a disconnected upper stack never reports an anchored load path',()=>{
 const {parts,solver}=actual();for(const p of parts)if(p.floor===0&&p.cell===1)p.gone=true;
 assert.equal(solver.assessPart(41).anchored,false);advance(solver,.1);
 assert.ok(parts[41].active);assert.ok(!solver.assessPart(41).anchored);
});
test('reset clears overload history and does not carry failures into restored geometry',()=>{
 const {parts,solver}=actual();for(const p of parts)if(![1,2].includes(p.cell))p.gone=true;advance(solver,.1);
 for(const p of parts){p.gone=p.active=false;p.node.position={...p.rest};p.node.quaternion={x:0,y:0,z:0,w:1};p.vel={x:0,y:0,z:0};p.phase=null;}
 solver.reset();advance(solver,.1);assert.ok(parts.every(p=>!p.gone&&!p.active));assert.equal(solver.assessPart(1).failure,null);
});
