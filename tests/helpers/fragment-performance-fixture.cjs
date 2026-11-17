'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const dist=path.resolve(__dirname,'../../dist');
function runtime(){
  const c=vm.createContext({window:{},console,Float32Array,Uint8Array,ArrayBuffer});
  for(const file of ['three-local.js','fragment-contact.js','structural-fragments.js'])
    vm.runInContext(fs.readFileSync(path.join(dist,file),'utf8'),c,{filename:file});
  return {T:c.window.THREE,fragments:c.window.SkyfallStructuralFragments,contact:c.window.SkyfallFragmentContact};
}
function vector(v){return Array.from(v.toArray());}
function eventFields(event){return{type:event.type||'floor',source:event.sourcePartId??event.partId,target:event.targetPartId??event.supportId,
  point:vector(event.point),normal:event.normal?vector(event.normal):null,velocity:event.velocity?vector(event.velocity):null,
  time:event.time??null,energy:event.energy,normalSpeed:event.normalSpeed??null,mass:event.mass,
  impulse:event.impulse,kineticEnergy:event.kineticEnergy,availableEnergy:event.availableEnergy??null,firstContact:event.firstContact};}
function resultFields(rig,events){
  return {events:events.map(eventFields),pieces:Array.from(rig.manager.sample(null,4),s=>({id:s.id,partId:s.partId,kind:s.kind,
    position:vector(s.position),quaternion:vector(s.quaternion),velocity:vector(s.velocity),settled:s.settled,supportId:s.supportId})),
    stats:rig.manager.stats()};
}
function makeRig(rt,{half=[0,0,0],velocity=[0,-30,60],height=2}={}){
  const {T}=rt,scene=new T.Scene(),node=new T.Group();node.position.y=height;
  const material=new T.MeshStandardMaterial();material.name='BuildingStructure';
  node.add(new T.Mesh(new T.BoxGeometry(),material));scene.add(node);scene.updateMatrixWorld(true);
  const part={id:17,floor:2,node,vel:new T.Vector3(),spin:new T.Vector3()};
  const buffers={},lengths={position:9,normal:9,uv:6,color:9,pieceId:3};let size=0;
  for(const [name,length]of Object.entries(lengths)){size=Math.ceil(size/4)*4;buffers[name]={offset:size,length};size+=length*(name==='color'?1:4);}
  const bytes=new ArrayBuffer(size);
  new Float32Array(bytes,buffers.position.offset,9).set([-.1,-.1,0,.1,-.1,0,0,.1,0]);
  new Float32Array(bytes,buffers.normal.offset,9).set([0,0,1,0,0,1,0,0,1]);
  const manager=rt.fragments.create(scene);
  manager.prepare([part],{version:1,triangleCount:1,buffers,pieces:[{id:0,partId:17,kind:'structure',center:[.13,height,0],half,firstVertex:0,vertexCount:3}],materialRanges:[{kind:'structure',start:0,count:3}]},bytes);
  const launch=()=>manager.release(part,{velocity:new T.Vector3(...velocity),angularVelocity:new T.Vector3(),energy:0});
  let trajectory;
  manager.setCollider({sweep(start,end){trajectory={start:start.clone(),end:end.clone()};return null;}});
  launch();manager.step(1/60,[]);manager.reset();
  return {rt,manager,scene,part,trajectory,launch,half};
}
function addWall(rig,id,time){
  const {T}=rig.rt,{start,end}=rig.trajectory,node=new T.Group();
  node.position.z=start.z+(end.z-start.z)*time+rig.half[2];
  node.add(new T.Mesh(new T.PlaneGeometry(6,6),new T.MeshBasicMaterial()));rig.scene.add(node);
  return {id,floor:0,node,vel:new T.Vector3(),spin:new T.Vector3(),gone:false};
}
function runCase(rt,{floorTime=.5,wallTimes=[],half=[0,0,0],slopeX=0,slopeZ=0,floorVelocity=0,destroyFloor=false,velocity}={}){
  const rig=makeRig(rt,{half,velocity}),{start,end}=rig.trajectory,dt=1/60;
  const x=start.x+(end.x-start.x)*floorTime,z=start.z+(end.z-start.z)*floorTime;
  const top=start.y-half[1]+(end.y-start.y)*floorTime-slopeX*x-slopeZ*z+floorVelocity*dt*(1-floorTime);
  let floorAlive=true;
  const floor={id:900,floor:0,minX:-4,maxX:4,minZ:-2,maxZ:2,top,velocityY:floorVelocity,
    surfaceAt:(x,z)=>floorAlive?top+slopeX*x+slopeZ*z:-Infinity};
  const walls=wallTimes.map((time,i)=>addWall(rig,100+i,time)),collider=rt.contact.create(walls);
  const events=[];
  rig.manager.setCollider(collider,event=>{
    events.push(eventFields(event));
    if(destroyFloor&&event.targetPartId===100){floorAlive=false;walls[0].gone=true;walls[0].node.visible=false;return{broken:true,spentEnergy:0};}
    return {broken:false,spentEnergy:0};
  });
  rig.launch();const emitted=rig.manager.step(dt,[floor]);
  return {rig,result:resultFields(rig,emitted),wallEvents:events};
}
function goldenCases(rt){
  const outputs=[];
  for(const half of [[0,0,0],[.1,.15,.1]])for(const floorTime of [.2,.5,.8])for(const wallTime of [.1,.4,.6,.9])
    for(const floorVelocity of [-.5,0,.75])outputs.push(runCase(rt,{half,floorTime,wallTimes:[wallTime],floorVelocity,slopeX:.07,slopeZ:-.03}).result);
  outputs.push(runCase(rt,{floorTime:.5,wallTimes:[.2,.8],destroyFloor:true,half:[.1,.15,.1]}).result);
  return outputs;
}
function goldenHash(rt){return createHash('sha256').update(JSON.stringify(goldenCases(rt))).digest('hex');}
function runTriangleChainCase(rt){
  const half=[.01,.01,.00001],floorTime=1e-4,rig=makeRig(rt,{half});
  const {T}=rt,{start,end}=rig.trajectory,positions=[];
  for(const offset of [2.8,1.6,.7,-.2]){
    const z=start.z+half[2]+(end.z-start.z)*(floorTime+1e-7+offset*1e-8);
    positions.push(start.x-.1,start.y-.1,z,start.x,start.y+.1,z,start.x+.1,start.y-.1,z);
  }
  // Keep all four REAL Float32 triangles in one BVH leaf, in authored order.
  // EPS acceptance is not transitive: clipping a far first hit changes the
  // entire later first-contact history even when the cap includes two EPS.
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  const node=new T.Group();node.add(new T.Mesh(geometry,new T.MeshBasicMaterial()));rig.scene.add(node);
  const wall={id:100,floor:0,node,gone:false,vel:new T.Vector3(),spin:new T.Vector3()};
  const collider=rt.contact.create([wall]),wallEvents=[];
  const floor={id:900,floor:0,minX:-4,maxX:4,minZ:-2,maxZ:2,
    top:start.y-half[1]+(end.y-start.y)*floorTime,velocityY:0};
  rig.manager.setCollider(collider,event=>{wallEvents.push(eventFields(event));return{broken:false,spentEnergy:0};});
  rig.launch();const events=rig.manager.step(1/60,[floor]);
  return {wallEvents,result:resultFields(rig,events)};
}
if(require.main===module)console.log(JSON.stringify({sourceHash:createHash('sha256').update(fs.readFileSync(path.join(dist,'structural-fragments.js'))).digest('hex'),goldenHash:goldenHash(runtime())}));
module.exports={runtime,makeRig,runCase,runTriangleChainCase,goldenCases,goldenHash,resultFields};
