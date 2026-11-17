'use strict';
// Deterministic solver-only fixtures: no renderer, frame loop or cosmetic rubble.
const identity=()=>({x:0,y:0,z:0,w:1});
function building(Solver,scenario='edge'){
 const parts=Array.from({length:48},(_,id)=>{const floor=Math.floor(id/8),cell=id%8,rest={x:cell%4*4,y:floor*3+1.5,z:Math.floor(cell/4)*4};
  return{id,floor,cell,rest,restQ:identity(),halfExtents:{x:2,y:1.5,z:2},node:{position:{...rest},quaternion:identity()},vel:{x:0,y:0,z:0},spin:{x:0,y:0,z:0},active:false,gone:false};});
 if(scenario==='edge')for(const p of parts)if(p.floor===0&&p.cell===0)p.gone=true;
 if(scenario==='open')for(const p of parts)if(p.floor===0)p.gone=true;
 if(scenario==='gap')for(const p of parts)if(p.floor===2)p.gone=true;
 const events=[];
 const solver=Solver.create(parts,{floorHeights:[0,3,6,9,12,15,18],groundAt:()=>0,
  activate:p=>{p.active=true;p.phase='falling';},
  fracture:(p,event)=>{events.push({id:p.id,...event,position:{...p.node.position},velocity:{...p.vel}});p.gone=true;p.active=true;p.phase='fragmented';},
  onRelease:event=>events.push({release:event})});
 return{parts,solver,events};
}
function wall(Solver,{candidateGate=false,wallX=0,speed=6,quaternion=identity(),spin={x:0,y:0,z:0}}={}){
 const parts=Array.from({length:10},(_,id)=>{const moving=id<9,rest={x:moving?-2:wallX,y:1.5,z:moving?(id%2?1:-1)*Math.ceil(id/2)*4:0};
  return{id,floor:0,cell:id,rest,restQ:identity(),halfExtents:{x:.5,y:1.5,z:moving?2:40},node:{position:{...rest,x:moving?-.53:wallX,y:moving?3:1.5},quaternion:moving?{...quaternion}:identity()},vel:{x:moving?speed:0,y:0,z:0},spin:moving?{...spin}:{x:0,y:0,z:0},active:moving,gone:false};});
 const points=[{x:.5,y:0,z:0},...[-.5,.5].flatMap(x=>[-1.5,1.5].flatMap(y=>[-2,2].map(z=>({x,y,z}))))],events=[],counts={sweeps:0,candidates:0,boundsChecks:0};
 let currentBounds=null;
 const target=parts[9];
 const sweepContact=(start,end,query)=>{
  counts.sweeps++;
  if(currentBounds)for(const point of [start,end])for(const axis of ['x','y','z']){
   if(point[axis]<currentBounds.min[axis]||point[axis]>currentBounds.max[axis])throw new Error('conservative bounds omitted an actual '+axis+' endpoint');
   counts.boundsChecks++;
  }
  if(target.gone||query.excludeIds.has(target.id))return null;
  const dx=end.x-start.x;if(Math.abs(dx)<1e-12)return null;
  const time=(wallX-start.x)/dx;if(time<0||time>query.maxTime)return null;
  const point={x:wallX,y:start.y+(end.y-start.y)*time,z:start.z+(end.z-start.z)*time};
  if(point.y<0||point.y>3||Math.abs(point.z)>40)return null;
  const hit={part:target,partId:target.id,time,point,normal:{x:-Math.sign(dx),y:0,z:0},velocity:{x:0,y:0,z:0}};
  return query.accept(hit)?hit:null;
 };
 const options={floorHeights:[0,3],groundAt:()=>0,contactSamples:p=>p===target?[]:points,sweepContact,
  fracture:(p,event)=>{events.push({id:p.id,...event,position:{...p.node.position},velocity:{...p.vel}});p.gone=true;}};
 if(candidateGate)options.contactCandidates=(bounds,query)=>{
  counts.candidates++;
  currentBounds=bounds;
  return !target.gone&&!query.excludeIds.has(target.id)&&bounds.min.x<=wallX&&bounds.max.x>=wallX&&bounds.min.y<=3&&bounds.max.y>=0?[target]:[];
 };
 return{parts,solver:Solver.create(parts,options),events,counts};
}
function checkpoint(f){return{parts:f.parts.map(p=>({id:p.id,gone:p.gone,active:p.active,phase:p.phase??null,position:{...p.node.position},quaternion:{...p.node.quaternion},velocity:{...p.vel},spin:{...p.spin}})),events:structuredClone(f.events)};}
module.exports={building,wall,checkpoint};
