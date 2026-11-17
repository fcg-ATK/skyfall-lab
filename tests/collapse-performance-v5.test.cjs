'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require('../dist/collapse-solver.js');
const {building,wall,checkpoint}=require('./helpers/collapse-performance-fixture.cjs');
const expected=require('./helpers/collapse-performance-v4.json');
function near(actual,want,path='checkpoint'){
 if(typeof want==='number'){assert.ok(Math.abs(actual-want)<=1e-8,`${path}: ${actual} != ${want}`);return;}
 if(want===null||typeof want!=='object'){assert.equal(actual,want,path);return;}
 assert.deepEqual(Object.keys(actual),Object.keys(want),path+' keys');
 for(const key of Object.keys(want))near(actual[key],want[key],path+'.'+key);
}
test('solver performance changes preserve v4 release, compression and rigid poses at every checkpoint',()=>{
 for(const scenario of ['edge','open','gap']){
  const f=building(Solver,scenario);
  for(let i=1;i<=180;i++){f.solver.step(1/120);if([1,12,60,120,180].includes(i))near(checkpoint(f),expected[scenario][i],scenario+'.'+i);}
 }
});
test('conservative empty wall candidates avoid every narrow sweep with identical finite motion',()=>{
 const baseline=wall(Solver,{wallX:100}),gated=wall(Solver,{wallX:100,candidateGate:true});
 for(let i=0;i<12;i++){baseline.solver.step(1/120);gated.solver.step(1/120);near(checkpoint(gated),checkpoint(baseline));}
 assert.ok(baseline.counts.sweeps>100,'the ungated fixture exercises every real sample');
 assert.ok(gated.counts.candidates>0,'each current trajectory receives a conservative candidate query');
 assert.equal(gated.counts.sweeps,0,'an empty conservative candidate set needs no triangle sweep');
});
test('candidate bounds preserve low-work stops and high-work symmetric crush, including changed trajectories',()=>{
 for(const speed of [3,6,9,18]){
  const baseline=wall(Solver,{speed}),gated=wall(Solver,{speed,candidateGate:true});
  for(let i=1;i<=20;i++){
   baseline.solver.step(1/120);gated.solver.step(1/120);near(checkpoint(gated),checkpoint(baseline),'wall.'+speed+'.'+i);
   if([1,2,12,20].includes(i))near(checkpoint(gated),expected['wall'+speed][i],'v4.wall.'+speed+'.'+i);
  }
 }
});
test('trajectory candidates enclose every translated and rotated real sample endpoint',()=>{
 for(const quaternion of [{x:.2,y:-.3,z:.4,w:Math.sqrt(.71)},{x:0,y:0,z:0,w:1}]){
  const baseline=wall(Solver,{quaternion,spin:{x:.3,y:-.2,z:.4}}),gated=wall(Solver,{quaternion,spin:{x:.3,y:-.2,z:.4},candidateGate:true});
  for(let i=0;i<20;i++){baseline.solver.step(1/120);gated.solver.step(1/120);near(checkpoint(gated),checkpoint(baseline));}
  assert.ok(gated.counts.boundsChecks>100,'actual moving endpoints reach the conservative bounds check');
 }
});
