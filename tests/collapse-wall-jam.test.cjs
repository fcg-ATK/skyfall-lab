'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require(process.env.COLLAPSE_REFERENCE||'../dist/collapse-solver.js');
const captured=require('./helpers/collapse-jam-v4.json');
const vector=a=>({x:a[0],y:a[1],z:a[2]});
function worldZ(local,p){
 const q=p.node.quaternion,v=p.node.position;
 const tx=q.y*local.z-q.z*local.y,ty=q.z*local.x-q.x*local.z;
 return v.z+local.z+2*(q.w*(q.x*local.y-q.y*local.x)+q.x*ty-q.y*tx);
}
function world(local,p){
 const q=p.node.quaternion,v=p.node.position,t={x:2*(q.y*local.z-q.z*local.y),y:2*(q.z*local.x-q.x*local.z),z:2*(q.x*local.y-q.y*local.x)};
 return{x:v.x+local.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+local.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+local.z+q.w*t.z+q.x*t.y-q.y*t.x};
}
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const difference=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
function fixture(isolated=false,thirdWall=false){
 // Seed719 ordinary central-ball contact checkpoint. Retain the real part
 // topology/samples and replace the two flat facade triangles with their exact
 // analytic planes: this isolates the opposing-normal rigid-body constraint.
 const parts=captured.parts.map(p=>({...p,rest:vector(p.rest),restQ:{...vector(p.restQ),w:p.restQ[3]},
  node:{position:vector(p.position),quaternion:{...vector(p.quaternion),w:p.quaternion[3]}},vel:vector(p.velocity),spin:vector(p.spin),
  halfExtents:{...p.halfExtents},samples:p.samples.map(vector),releaseConnections:[]}));
 if(isolated)for(const p of parts)if(!p.active||p.gone){p.active=false;p.gone=true;}
 if(!isolated)for(let i=0;i<parts.length;i++)parts[i].releaseConnections=captured.parts[i].releaseConnections.map(c=>({...c,anchor:parts.find(p=>p.id===c.anchor)}));
 const planes=captured.planes.map(p=>({target:p.target,point:{x:0,y:0,z:p.z},normal:{x:0,y:0,z:p.normal}}));
 if(thirdWall)planes.push({target:93,point:{x:1.744699677772417,y:13.30246677514484,z:6.30135616136863},normal:{x:-.9999955894239321,y:.000985944802134663,z:.0028016148075415176},bounds:{minY:13.1,maxY:13.5,minZ:6.25,maxZ:6.35}});
 const targets=new Map(planes.map(plane=>[plane.target,{id:plane.target,gone:false}]));
 const events=[],hits=[];
 const solver=Solver.create(parts,{floorHeights:captured.floorHeights,groundAt:()=>.24,contactSamples:p=>p.samples,
  sweepContact(start,end,query){
   let earliest=null;
   const delta=difference(end,start);
   for(const plane of planes){
    const target=targets.get(plane.target);if(target.gone||query.excludeIds.has(target.id))continue;
    const d=dot(delta,plane.normal);if(Math.abs(d)<1e-12)continue;
    const offset=dot(difference(start,plane.point),plane.normal),time=-offset/d,onFace=Math.abs(offset)<=1e-8;
    if(time<0&&!onFace||time>query.maxTime+1e-8||onFace&&d>=0)continue;
    const t=Math.max(0,Math.min(query.maxTime,time)),normal=d>0?{x:-plane.normal.x,y:-plane.normal.y,z:-plane.normal.z}:plane.normal;
    const point={x:start.x+delta.x*t,y:start.y+delta.y*t,z:start.z+delta.z*t},gap=dot(difference(point,plane.point),plane.normal);
    point.x-=plane.normal.x*gap;point.y-=plane.normal.y*gap;point.z-=plane.normal.z*gap;
    if(plane.bounds&&(point.y<plane.bounds.minY||point.y>plane.bounds.maxY||point.z<plane.bounds.minZ||point.z>plane.bounds.maxZ))continue;
    const hit={part:target,partId:target.id,time:t,point,normal,velocity:{x:0,y:0,z:0}};
    if(query.accept(hit)&&(!earliest||t<earliest.time))earliest=hit;
   }
   if(earliest)hits.push(earliest);return earliest;
  },fracture:(p,e)=>{p.gone=true;events.push({id:p.id,...e});}});
 return{parts,solver,events,hits,planes,moving:parts.filter(p=>p.active&&!p.gone)};
}
test('opposing facade contacts cannot pin a coherent falling mass with nonzero stored motion',()=>{
 const f=fixture(),start=f.moving.map(p=>({p,y:p.node.position.y}));
 for(let i=0;i<12;i++)f.solver.step(1/120);
 assert.ok(f.hits.some(h=>h.normal.z===1)&&f.hits.some(h=>h.normal.z===-1),'both real opposing contact constraints must be exercised');
 assert.ok(start.some(({p,y})=>p.gone||p.node.position.y<y-.01),'unconstrained gravity must spend its remaining substep on downward travel');
});
test('a third slanted facade constrains the free twist without pinning or crossing any wall',()=>{
 const f=fixture(true,true),initialY=f.moving.reduce((sum,p)=>sum+p.node.position.y,0)/f.moving.length;
 const sides=f.moving.flatMap(p=>p.samples.flatMap(local=>f.planes.map(plane=>{
  const initial=world(local,p),distance=dot(difference(initial,plane.point),plane.normal);return{p,local,plane,initial,distance,side:Math.abs(distance)>1e-5?Math.sign(distance):0};
 })));
 for(let i=0;i<12;i++){
  f.solver.step(1/120);
  for(const sample of sides)if(sample.side){
   const point=world(sample.local,sample.p),b=sample.plane.bounds;
   if(b&&[sample.initial,point].some(p=>p.y<b.minY||p.y>b.maxY||p.z<b.minZ||p.z>b.maxZ))continue;
   assert.ok(sample.side*dot(difference(point,sample.plane.point),sample.plane.normal)>=-1e-5,'the finite rigid motion and numerical correction must respect all three facade faces: '+JSON.stringify({step:i,id:sample.p.id,target:sample.plane.target,initial:sample.distance,now:dot(difference(point,sample.plane.point),sample.plane.normal)}));
  }
 }
 assert.ok(f.hits.some(h=>h.partId===93),'the captured third wall must participate in the response');
 assert.ok(f.moving.reduce((sum,p)=>sum+p.node.position.y,0)/f.moving.length<initialY-.01,'the remaining vertical freedom must still advance under gravity');
 assert.equal(f.events.length,0);
});
test('jam recovery preserves both facade clearances, angular bound and gravitational energy',()=>{
 const f=fixture(true),start=f.moving.map(p=>({p,y:p.node.position.y}));
 const meanY=()=>f.moving.reduce((sum,p)=>sum+p.vel.y,0)/f.moving.length,initialVelocityY=meanY();
 const sides=f.moving.flatMap(p=>p.samples.flatMap(local=>captured.planes.map(plane=>{
  const distance=worldZ(local,p)-plane.z;return{p,local,z:plane.z,distance,side:Math.abs(distance)>1e-5?Math.sign(distance):0};
 })));
 for(let i=0;i<12;i++){
  f.solver.step(1/120);
  for(const sample of sides)if(sample.side)
   assert.ok(sample.side*(worldZ(sample.local,sample.p)-sample.z)>=-1e-5,'constraint projection must not create a new facade crossing: '+JSON.stringify({step:i,id:sample.p.id,initial:sample.distance,now:worldZ(sample.local,sample.p)-sample.z}));
  assert.ok(f.moving.every(p=>Math.hypot(p.spin.x,p.spin.y,p.spin.z)<=.9+1e-8),'normal projection cannot bypass the existing angular-speed limit');
 }
 assert.ok(f.hits.some(h=>h.normal.z===1)&&f.hits.some(h=>h.normal.z===-1),'both real opposing contact constraints must be exercised');
 assert.ok(start.some(({p,y})=>!p.gone&&p.node.position.y<y-.01),'unconstrained gravity must spend its remaining substep on downward travel');
 assert.ok(f.moving.every(p=>[...Object.values(p.node.position),...Object.values(p.node.quaternion),...Object.values(p.vel),...Object.values(p.spin)].every(Number.isFinite)));
 assert.equal(f.events.length,0,'low-work normal constraint resolution must not invent concrete fracture');
 assert.ok(Math.abs(meanY()-(initialVelocityY-9.8*.1))<1e-8,'opposing vertical walls cannot inject vertical energy or erase downward momentum');
});
