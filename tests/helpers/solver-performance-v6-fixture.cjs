'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {building,wall,checkpoint}=require('./collapse-performance-fixture.cjs');
const sourcePath=path.resolve(__dirname,'../../dist/collapse-solver.js');

// Instrument only the test VM. Work counts distinguish redundant support work
// from the unchanged number and ordering of physical steps/triangle queries.
function loadInstrumented(file=sourcePath){
 const counts={gather:false,ownsLoad:0,snapshots:0,assessments:0,contactGathers:[]};
 counts.recordContacts=contacts=>counts.contactGathers.push(hash(contacts.map(({p,support,...contact})=>({source:p.id,support:support?.id??null,...contact}))));
 let source=fs.readFileSync(file,'utf8');
 const replace=(before,after)=>{assert.ok(source.includes(before),'instrumentation marker: '+before);source=source.replace(before,after);};
 replace('function ownsLoad(q,point,cell){','function ownsLoad(q,point,cell){if(__perf.gather)__perf.ownsLoad++;');
 replace('function snapshot(p){','function snapshot(p){if(__perf.gather)__perf.snapshots++;');
 replace('function assessments(){','function assessments(){__perf.assessments++;');
 replace('const contacts=[],surfaces=','__perf.gather=true;const contacts=[],surfaces=');
 replace('if(!contacts.length)continue;','__perf.recordContacts(contacts);__perf.gather=false;if(!contacts.length)continue;');
 const scope={module:{exports:{}},__perf:counts};
 vm.runInNewContext(source,scope,{filename:file});
 return{Solver:scope.module.exports,counts};
}

// Preserve special IEEE values as well as every finite double in the golden.
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value,(_key,v)=>typeof v==='number'?(Object.is(v,-0)?'number:-0':Number.isFinite(v)?v:'number:'+v):v)).digest('hex');}
function fullCheckpoint(f){
 return{
  ...checkpoint(f),
  internals:f.parts.map(p=>({id:p.id,age:p.age,overloaded:p.overloaded,coupledBearing:p.coupledBearing,direct:p.direct,fallBias:p.fallBias,
   releaseConnections:p.releaseConnections?.map(c=>({...c,anchor:c.anchor.id}))})),
  supports:f.solver.supports().map(s=>({id:s.id,floor:s.floor,minX:s.minX,maxX:s.maxX,minZ:s.minZ,maxZ:s.maxZ,top:s.top,velocityY:s.velocityY,
   probes:[[0,0],[.125,-.25],[100,-100]].map(([x,z])=>({height:s.surfaceAt(x,z),contains:s.contains(x,z,.02,.02),velocity:s.velocityAt(x,z)}))})),
  diagnostics:f.solver.diagnostics(),
  queries:f.counts?{...f.counts}:null
 };
}
function record(Solver,counts){
 const checkpoints={};
 for(const scenario of ['edge','open','gap','reverseEdge']){
  const adapter=scenario==='reverseEdge'?{create:(parts,options)=>Solver.create(parts.slice().reverse(),options)}:Solver;
  const f=building(adapter,scenario==='reverseEdge'?'edge':scenario);
  for(let i=1;i<=180;i++){
   f.solver.step(1/120);
   if([1,12,60,120,180].includes(i))checkpoints[scenario+'.'+i]=hash(fullCheckpoint(f));
  }
 }
 for(const speed of [3,6,9,18]){
  const f=wall(Solver,{speed,candidateGate:true,spin:{x:.3,y:-.2,z:.4}});
  for(let i=1;i<=20;i++){
   f.solver.step(1/120);
   if([1,2,12,20].includes(i))checkpoints['wall'+speed+'.'+i]=hash(fullCheckpoint(f));
  }
 }
 const work={ownsLoad:counts.ownsLoad,snapshots:counts.snapshots};
 const f=building(Solver,'intact');
 counts.assessments=0;
 const diagnostics=f.solver.diagnostics();
 work.diagnosticAssessments=counts.assessments;
 return{checkpoints,work,diagnostics:hash(diagnostics),contactGatherTrace:hash(counts.contactGathers)};
}
module.exports={sourcePath,loadInstrumented,hash,fullCheckpoint,record};
