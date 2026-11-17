'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

// Each collider uses its own VM and real Three.js transforms and triangles.
// This workload contains exact openings, long/short sweeps, finite footprints,
// point samples, ties, exclusions, callback rejection and moving nested poses.
function fixture(dist, queryCount = 2400) {
  const context = vm.createContext({ window: {}, console });
  for (const file of ['three-local.js', 'fragment-contact.js'])
    vm.runInContext(fs.readFileSync(path.join(dist, file), 'utf8'), context, { filename: file });
  const T = context.window.THREE, V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
  const material = new T.MeshBasicMaterial(), parts = [], moving = new T.Group();
  function member(id, geometry, x, y, z, ry=0, parent=null) {
    const node = new T.Group(); node.position.set(x,y,z); node.rotation.y=ry;
    node.add(new T.Mesh(geometry,material)); if (parent) parent.add(node);
    const part = { id, node, vel:V(.1*id,-.2,.3), spin:V(.03,-.08,.02), gone:false };
    parts.push(part); return part;
  }
  const pier = new T.BoxGeometry(.3,3,.12), lintel = new T.BoxGeometry(2.5,.3,.12);
  for (let floor=0;floor<3;floor++) for (let col=0;col<5;col++) {
    const x=(col-2)*2.5, y=floor*3;
    member(parts.length+1,pier,x-1.1,y,0,0,col%2?moving:null);
    member(parts.length+1,lintel,x,y+1.35,0,0,col%2?moving:null);
    // Omit the lowest sill to leave real doorways as well as windows.
    if (floor) member(parts.length+1,lintel,x,y-1.35,0);
  }
  member(100,new T.BoxGeometry(6,.15,6),0,-1.6,1,.13);
  member(101,new T.BoxGeometry(.4,8,4),-5,3,2,.34);
  member(102,new T.BoxGeometry(.4,8,4),5,3,2,-.27);
  member('tie-first',new T.BoxGeometry(2,2,.12),0,3,4);
  member('tie-second',parts.at(-1).node.children[0].geometry,0,3,4);
  member(103,new T.PlaneGeometry(16,10,32,20),0,3,8,.17);
  const scaled = new T.Group(); scaled.scale.set(1.2,.8,1.4); scaled.rotation.set(.12,-.31,.09);
  member(104,new T.BoxGeometry(.6,4,3),2,2,2,.13,scaled);
  const collider = context.window.SkyfallFragmentContact.create(parts);
  let seed=0x37a195c1;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const queries=[];
  for (let i=0;i<queryCount;i++) {
    const x=(rand()-.5)*14,y=rand()*10-2,z=(rand()-.5)*12;
    const start=V(x,y,z), end=i%3?V(x+(rand()-.5)*.3,y-rand()*.4,z+(rand()-.5)*.6):V(x+(rand()-.5)*5,y+(rand()-.5)*4,10-z);
    const options=i%2?{radius:0}:{halfExtents:V(.03+rand()*.4,.02+rand()*.3,.01+rand()*.2)};
    if(i%11===0)options.maxTime=.38;
    if(i%13===0)options.excludePartId=String(i%40+1);
    if(i%17===0)options.excludeIds=new Set([1,'3',100,'101']);
    if(i%19===0)options.acceptNormal=(normal,part)=>normal.y<.7&&part.id!==101;
    if(i%23===0)options.accept=hit=>hit.normal.x<.8&&hit.partId!==100;
    queries.push([start,end,options]);
  }
  // Guaranteed opening, jamb, long crossing, touch/departure and tie samples.
  for (const radius of [0,.1,.3]) for (const x of [-1.1,-.9,0,.96,1.1]) {
    queries.push([V(x,0,-3),V(x,0,3),{radius}]);
    queries.push([V(x,3,2),V(x,3,7),{radius}]);
    queries.push([V(x,3,3.94-radius),V(x,3,3-radius),{radius}]);
  }
  function pose(phase) {
    moving.position.set(.09*phase,-.08*phase,.04*phase);
    moving.rotation.set(.015*phase,.06*phase,-.02*phase);
    scaled.position.set(-.12*phase,.03*phase,.04*phase);
    parts[0].gone=phase===1; parts[1].node.visible=phase!==2;
    collider.sync();
  }
  function query(start,end,options,batch) {
    if(!batch)return collider.sweep(start,end,options);
    const e=options.halfExtents||V(options.radius,options.radius,options.radius);
    const box=new T.Box3().setFromPoints([start,end]);box.min.sub(e);box.max.add(e);
    const candidates=collider.candidates(box,options);
    return collider.sweep(start,end,{...options,candidates});
  }
  function run(capture=false,batch=false) {
    const results=capture?[]:null;
    let hits=0,checksum=0;
    for(let phase=0;phase<3;phase++) {
      pose(phase);
      for(const [start,end,options] of queries) {
        const hit=query(start,end,options,batch);
        if(hit) {hits++;checksum+=hit.time+hit.point.x+hit.normal.y;}
        if(capture)results.push(hit?{partId:hit.partId,time:hit.time,t:hit.t,
          point:Array.from(hit.point.toArray()),normal:Array.from(hit.normal.toArray()),center:Array.from(hit.center.toArray()),velocity:Array.from(hit.velocity.toArray())}:null);
      }
      // A target removed/hidden after sync cannot become a blocker.
      parts[2].gone=true; moving.visible=false;
      for(const [start,end,options] of queries.slice(0,16)) {
        const hit=query(start,end,options,batch);
        if(capture)results.push(hit?{partId:hit.partId,time:hit.time,point:Array.from(hit.point.toArray()),normal:Array.from(hit.normal.toArray())}:null);
      }
      parts[2].gone=false; moving.visible=true;
    }
    return {results,hits,checksum,stats:collider.stats()};
  }
  return {run,collider,queries};
}

function measure(subject, rounds=5) {
  subject.run();
  const timings=[];
  for(let round=0;round<rounds;round++) {
    const start=performance.now();subject.run();timings.push(performance.now()-start);
  }
  timings.sort((a,b)=>a-b);
  return {medianMs:timings[timings.length>>1],timings};
}
module.exports={fixture,measure};
