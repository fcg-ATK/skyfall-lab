'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function runtime(dist=path.resolve(__dirname,'../../dist')){
 const context=vm.createContext({window:{},console});
 for(const file of ['three-local.js','fragment-contact.js'])vm.runInContext(fs.readFileSync(path.join(dist,file),'utf8'),context,{filename:file});
 return{T:context.window.THREE,create:context.window.SkyfallFragmentContact.create};
}
const cases=[
 {name:'dense point',shape:'point',triangles:4096},
 {name:'dense touching box',shape:'box',triangles:4096},
 {name:'dense overlapping box',shape:'overlap',triangles:4096},
 ...['point','box'].flatMap(shape=>[
  {name:shape+' reject first hit',shape,triangles:128,rejectHits:2},
  {name:shape+' reject first normal',shape,triangles:128,rejectNormals:2},
  {name:shape+' maxTime zero without acceptance',shape,triangles:128,maxTime:0,rejectAll:true},
  {name:shape+' rejected zero then positive',shape,triangles:64,planes:[{id:'reject',z:0},{id:'far',z:-.5}],acceptId:'far'},
  {name:shape+' accepted positive before rejected zero',shape,triangles:64,planes:[{id:'far',z:-.5},{id:'reject',z:0}],acceptId:'far'},
  ...['ordinary','small','large'].map(pool=>({name:shape+' visibility exclusions '+pool,shape,triangles:64,many:true,pool})),
 ]),
];
function exercise(rt,spec){
 const {T}=rt,V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),material=new T.MeshBasicMaterial();
 const data=new Float32Array(spec.triangles*9);for(let i=0;i<data.length;i+=9)data.set([-2,-2,0,2,-2,0,0,2,0],i);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(data,3));
 const definitions=spec.many?Array.from({length:12},(_,id)=>({id,z:0})):spec.planes||[{id:'dense',z:0}];
 const parts=definitions.map(def=>{const node=new T.Group();node.position.z=def.z;node.add(new T.Mesh(geometry,material));return{id:def.id,node,vel:V(.5,-.2,.3),spin:V(.1,.2,-.3),gone:false};});
 if(spec.many){parts[0].node.visible=false;parts[1].gone=true;const hidden=new T.Group();hidden.visible=false;hidden.add(parts[2].node);}
 const collider=rt.create(parts),start=V(.1,.17,spec.shape==='point'?0:spec.shape==='overlap'?.05:.1),end=V(.1,.17,-1);
 let acceptCalls=0,normalCalls=0;
 const options=spec.shape==='point'?{radius:0}:{halfExtents:V(.2,.15,.1)};
 if(spec.maxTime!=null)options.maxTime=spec.maxTime;
 if(spec.rejectNormals)options.acceptNormal=()=>++normalCalls>spec.rejectNormals;
 if(spec.rejectHits||spec.rejectAll||spec.acceptId!=null)options.accept=hit=>{acceptCalls++;return !spec.rejectAll&&acceptCalls>(spec.rejectHits||0)&&(spec.acceptId==null||hit.partId===spec.acceptId);};
 if(spec.many){options.excludePartId=3;options.excludeIds=new Set(['4']);options.acceptNormal=(normal,p)=>{normalCalls++;return p.id!==5;};
  if(spec.pool!=='ordinary'){
   options.candidates=collider.candidates({min:V(-10,-10,-10),max:V(10,10,10)},options);
   if(spec.pool==='small')options.candidates=options.candidates.filter(record=>[5,6,7].includes(record.part.id));
  }
 }
 const before=collider.stats(),hit=collider.sweep(start,end,options),after=collider.stats();
 const snapshot=hit?{keys:Object.keys(hit).sort(),partId:hit.partId,partReference:hit.part===parts.find(p=>p.id===hit.partId),time:hit.time,t:hit.t,
  point:Array.from(hit.point.toArray()),normal:Array.from(hit.normal.toArray()),center:Array.from(hit.center.toArray()),velocity:Array.from(hit.velocity.toArray())}:null;
 return{snapshot,acceptCalls,normalCalls,triangleTests:after.triangleTests-before.triangleTests,meshTests:after.meshTests-before.meshTests};
}
function capture(rt){return Object.fromEntries(cases.map(spec=>{const {snapshot,acceptCalls,normalCalls}=exercise(rt,spec);return[spec.name,{snapshot,acceptCalls,normalCalls}];}));}
const replacer=(key,value)=>Object.is(value,-0)?'__negative_zero__':value;
function revive(value){if(value==='__negative_zero__')return -0;if(Array.isArray(value))return value.map(revive);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,revive(item)]));return value;}
module.exports={runtime,cases,exercise,capture,replacer,revive};
