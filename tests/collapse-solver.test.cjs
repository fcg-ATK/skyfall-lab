'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../dist/collapse-solver.js');
const Solver=fs.existsSync(file)?require(file):{};
function fixture(floors=5){
 const parts=Array.from({length:floors*4},(_,id)=>{const floor=Math.floor(id/4),cell=id%4;const pos={x:(cell%2)*4,y:1.5+floor*3,z:Math.floor(cell/2)*4};return{id,floor,cell,center:{...pos},rest:{...pos},restQ:{x:0,y:0,z:0,w:1},halfExtents:{x:2,y:1.5,z:2},node:{position:{...pos},quaternion:{x:0,y:0,z:0,w:1}},vel:{x:0,y:0,z:0},spin:{x:0,y:0,z:0},active:false,gone:false};});
 const events=[];
 const solver=Solver.create(parts,{floorHeights:Array.from({length:floors+1},(_,i)=>i*3),groundAt:()=>0,
 activate(p){p.active=true;p.phase='falling';}, fracture(p,e){events.push({id:p.id,y:p.node.position.y,...e});p.gone=true;p.active=true;p.phase='fragmented';}});
 return {parts,solver,events};
}
function step(s,seconds){for(let i=0;i<Math.ceil(seconds*120);i++)s.step(1/120);}
test('v6 missing base moves every connected upper floor together without timer gaps',()=>{
 const {parts,solver,events}=fixture(); for(const p of parts.filter(p=>p.floor===0))p.gone=true;
 step(solver,.2);
 const upper=parts.filter(p=>p.floor>0);assert.ok(upper.every(p=>p.active&&p.node.position.y<p.rest.y-.1));
 const shifts=upper.map(p=>p.node.position.y-p.rest.y);assert.ok(Math.max(...shifts)-Math.min(...shifts)<1e-8);
 assert.equal(events.length,0,'falling through open air must not fracture anything');
});

test('one-sided support failure gives a visible mirrored lean and lateral travel',()=>{
 const outcomes=[];
 for(const failedX of [0,4]){
  const {parts,solver}=fixture();
  for(const p of parts)if(p.floor===0&&p.rest.x===failedX)p.gone=true;
  step(solver,.5);
  const roof=parts.filter(p=>p.floor===4&&!p.gone);
  assert.equal(roof.length,4,'unsupported roof must survive open-air descent');
  const direction=failedX===0?-1:1;
  const drift=roof.reduce((s,p)=>s+p.node.position.x-p.rest.x,0)/roof.length;
  assert.ok(drift*direction>.35,`roof must drift toward the missing bearings: ${drift}`);
  assert.ok(roof.every(p=>Math.abs(p.node.quaternion.z)>.035),'lean must be clearly visible, over four degrees');
  outcomes.push(drift);
 }
 assert.ok(Math.abs(outcomes[0]+outcomes[1])<.05,'opposite bearing loss must mirror, without random blast');
});

test('tilted support snapshots match their moving plane and remain immutable',()=>{
 const {parts,solver}=fixture(1),p=parts[0];
 p.node.quaternion={x:0,y:0,z:Math.sin(Math.PI/12),w:Math.cos(Math.PI/12)};
 p.vel={x:2,y:-3,z:1};p.spin={x:0,y:0,z:1};
 const support=solver.supports()[0];
 assert.equal(typeof support.surfaceAt,'function');
 const y=support.surfaceAt(0,0);
 assert.ok(Math.abs(y-(1.5+1.5/Math.cos(Math.PI/6)))<1e-8);
 assert.ok(support.surfaceAt(1,0)>y+.5,'tilted top cannot remain a flat plate');
 assert.equal(support.contains(100,0),false);
 const velocity=support.velocityAt(0,0);
 assert.ok(Math.abs(velocity.x-(2-(y-1.5)))<1e-8);
 p.node.position.y-=4;p.node.quaternion.z=0;p.vel.y=-10;
 assert.equal(support.surfaceAt(0,0),y,'previous pose must remain valid for swept relative contact');
 assert.equal(support.velocityAt(0,0).y,-3);
});

test('contact front breaks regional coherence and preserves falling upper momentum',()=>{
 const {parts,solver,events}=fixture();
 for(const p of parts)if(p.floor===0&&p.rest.x===0)p.gone=true;
 let sawDifferentPose=false;
 for(let i=0;i<360;i++){
  solver.step(1/120);
  const moving=parts.filter(p=>p.active&&!p.gone);
  for(const a of moving)for(const b of moving)if(a.floor===b.floor&&Math.abs(a.node.quaternion.z-b.node.quaternion.z)>.025)sawDifferentPose=true;
 }
 assert.ok(events.length>4,'compression must progress beyond the first support');
 assert.ok(sawDifferentPose,'contact or differential strain must let regions rotate separately');
});
test('v6 unsupported parts do not automatically fracture at .45 seconds',()=>{
 const {parts,solver,events}=fixture(); for(const p of parts.filter(p=>p.floor<3))p.gone=true;
 step(solver,.6);assert.equal(events.length,0);assert.ok(parts.filter(p=>!p.gone).every(p=>p.active));
});
test('v6 first impact crushes the lowest contact zone and keeps upper momentum',()=>{
 const {parts,solver,events}=fixture(); for(const p of parts.filter(p=>p.floor===0))p.gone=true;
 for(let i=0;i<240&&events.length===0;i++)solver.step(1/120);
 assert.ok(events.length>0);assert.ok(events.every(e=>parts[e.id].floor===1));
 const high=parts.filter(p=>p.floor>=2);assert.ok(high.every(p=>!p.gone&&p.vel.y<0));
 const shift=high[0].node.position.y-high[0].rest.y;assert.ok(high.every(p=>Math.abs(p.node.position.y-p.rest.y-shift)<1e-8));
});
test('v6 upper mass impacts and crushes intact lower supports instead of interpenetrating',()=>{
 const {parts,solver,events}=fixture(); for(const p of parts.filter(p=>p.floor===2))p.gone=true;
 step(solver,1.3);assert.ok(events.some(e=>parts[e.id].floor===1),'impact must damage intact supporting storey');
 assert.ok(events.filter(e=>parts[e.id].floor>=3).every(e=>e.cause==='compression'));
 assert.ok(parts.every(p=>p.gone||p.node.position.y-p.halfExtents.y>=-.01));
});
test('v6 cumulative missing supports detach upper structure, isolated damage can stay local',()=>{
 const {parts,solver}=fixture();parts[0].gone=true;step(solver,.2);
 assert.ok(parts.filter(p=>p.floor>0).every(p=>!p.active));
 parts[1].gone=true;step(solver,.1);assert.ok(parts.filter(p=>p.floor>0).every(p=>p.active));
});
test('v6 intact architecture never moves and reset removes previous groups',()=>{
 const {parts,solver}=fixture();step(solver,1);assert.ok(parts.every(p=>p.node.position.y===p.rest.y&&!p.active));
 for(const p of parts.filter(p=>p.floor===0))p.gone=true;step(solver,.2);solver.reset();
 for(const p of parts){p.gone=p.active=false;p.node.position={...p.rest};p.vel={x:0,y:0,z:0};}
 step(solver,.3);assert.ok(parts.every(p=>p.node.position.y===p.rest.y&&!p.active));
});
test('v6 a gentle isolated landing preserves the intact member',()=>{
 const {parts,solver,events}=fixture(1);
 for(const p of parts){p.active=true;p.node.position.y+=.001;}
 step(solver,.1);assert.equal(events.length,0);assert.ok(parts.every(p=>!p.gone));
});

test('a softly resting member falls again when its current bearing is removed',()=>{
 const {parts,solver}=fixture(2);
 for(const p of parts.filter(p=>p.floor===1)){p.phase='resting';p.active=false;}
 for(const p of parts.filter(p=>p.floor===0))p.gone=true;
 step(solver,.2);
 assert.ok(parts.filter(p=>p.floor===1).every(p=>p.active&&p.node.position.y<p.rest.y-.1));
});

test('a soft single-edge touch cannot hold an unbalanced member motionless',()=>{
 const {parts,solver}=fixture(1),p=parts[0];
 for(const q of parts.slice(1))q.gone=true;
 p.node.quaternion={x:0,y:0,z:Math.sin(Math.PI/12),w:Math.cos(Math.PI/12)};
 p.node.position.y-=solver.bottom(p)-.001;p.active=true;
 step(solver,.1);
 assert.ok(p.active,'centre of mass lies beyond the contact edge, so it must keep tipping');
 assert.notEqual(p.phase,'resting');
});

test('a sector drifting onto another original cell collides with its current bearing',()=>{
 const {parts,solver,events}=fixture(2);
 for(const p of parts)if(![0,5].includes(p.id))p.gone=true;
 const upper=parts[5];upper.node.position.x=0;upper.node.position.y=4.6;upper.active=true;upper.vel.y=-2;
 step(solver,.2);
 assert.ok(events.some(e=>e.id===upper.id),'actual current footprint must collide after crossing a cell');
});

test('v6 disconnected top-storey island cannot borrow support through a destroyed horizontal gap',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../dist/assets/mobile-building.json'),'utf8'));
 const parts=manifest.pieces.map(p=>({...p,rest:{...p.center},node:{position:{...p.center}},vel:{x:0,y:0,z:0},active:false,gone:false}));
 const solver=Solver.create(parts,{floorHeights:manifest.floorHeights,groundAt:()=>.24,
 activate(p){p.active=true;},fracture(p){p.gone=true;p.active=true;}});
 for(const p of parts)if((p.floor===4&&[0,4].includes(p.cell))||(p.floor===5&&[1,5].includes(p.cell)))p.gone=true;
 step(solver,.2);
 const left=parts.filter(p=>p.floor===5&&[0,4].includes(p.cell));
 assert.ok(left.every(p=>p.active&&p.node.position.y<p.rest.y-.1),'isolated left island lost its own lower supports');
 const right=parts.filter(p=>p.floor===5&&[2,3,6,7].includes(p.cell));
 assert.ok(right.every(p=>!p.active&&p.node.position.y===p.rest.y),'right island retains its own supports');
});
