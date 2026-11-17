'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require('../dist/collapse-solver.js');
function fixture(columns=6,rows=4,floors=6){
 const count=columns*rows,parts=Array.from({length:count*floors},(_,id)=>{
  const floor=Math.floor(id/count),cell=id%count,rest={x:(cell%columns)*3.43,y:floor*3.3+1.65,z:Math.floor(cell/columns)*3.706};
  return{id,floor,cell,rest,halfExtents:{x:1.715,y:1.65,z:1.853},node:{position:{...rest},quaternion:{x:0,y:0,z:0,w:1}},vel:{x:0,y:0,z:0},spin:{x:0,y:0,z:0},active:false,gone:false};
 });
 const events=[],releases=[],solver=Solver.create(parts,{floorHeights:Array.from({length:floors+1},(_,i)=>i*3.3),groundAt:()=>0,
  activate(p){p.active=true;p.phase='falling';},fracture(p,e){events.push({id:p.id,...e});p.gone=true;p.active=true;},onRelease(e){releases.push(e);}});
 return{parts,solver,events,releases};
}
const advance=(s,t)=>{for(let i=0;i<Math.ceil(t*120);i++)s.step(1/120);};
const tilt=p=>2*Math.acos(Math.min(1,Math.abs(p.node.quaternion.w)));
test('shared slab bending moves a healthy neighboring strip before that strip becomes rubble',()=>{
 const {parts,solver,events}=fixture();
 for(const p of parts)if(p.floor===2&&[18,19].includes(p.cell))p.gone=true;
 const neighbors=parts.filter(p=>p.floor>=3&&[12,13,20].includes(p.cell));
 advance(solver,.45);
 const moved=neighbors.filter(p=>!p.gone&&tilt(p)>.025&&Math.hypot(p.node.position.x-p.rest.x,p.node.position.y-p.rest.y,p.node.position.z-p.rest.z)>.04);
 assert.ok(moved.length>=2,'an adjacent intact section must actually bend/rotate, not just the directly unsupported shaft');
 assert.ok(!events.some(e=>neighbors.some(p=>p.id===e.id)),'neighbor motion must precede its fracture');
 assert.ok(parts.filter(p=>p.cell<6).every(p=>!p.active&&!p.gone),'opposite distant facade must retain healthy bearings');
});
test('mirrored eccentric support loss produces opposite coherent block lean',()=>{
 const results=[];
 for(const lost of [[0,6],[5,11]]){
  const {parts,solver}=fixture();for(const p of parts)if(p.floor===0&&lost.includes(p.cell))p.gone=true;
  advance(solver,.8);
  const strip=parts.filter(p=>p.floor>0&&!p.gone&&p.active);
  assert.ok(strip.some(p=>!lost.includes(p.cell)&&tilt(p)>.025),'remaining bearing strip must be recruited by actual slab moment');
  results.push(strip.reduce((s,p)=>s+p.node.quaternion.z,0)/strip.length);
 }
 assert.ok(results[0]*results[1]<0,`eccentricity must determine turn: ${results}`);
});
test('coherent incident mass transfers finite impact work while a single moderate member is absorbed',()=>{
 function impact(floors){const result=fixture(1,1,7);for(const p of result.parts)if(p.floor===1||p.floor>floors+1)p.gone=true;
  for(const p of result.parts)if(p.floor>=2&&!p.gone){p.active=true;p.vel.y=-9;}
  advance(result.solver,.5);return result;
 }
 const small=impact(1),heavy=impact(5);
 assert.equal(small.parts[0].gone,false,'one moderate falling member must expend its energy on itself');
 assert.ok(heavy.events.some(e=>e.id===0&&e.cause==='compression'),'the same contact speed with a five-storey coherent mass must overload the lower bearing');
 assert.ok(heavy.parts.every(p=>Number.isFinite(p.node.position.y)&&Number.isFinite(p.node.quaternion.w)));
});
test('healthy geometry and a short opposing bridge remain static, and reset clears coupling',()=>{
 const {parts,solver,events}=fixture();advance(solver,.2);assert.ok(parts.every(p=>!p.active&&tilt(p)===0));
 for(const p of parts)if(p.floor===0&&p.cell===8)p.gone=true;advance(solver,.3);
 assert.ok(parts.filter(p=>p.floor>0&&p.cell===8).every(p=>!p.active&&tilt(p)===0),'central short bay keeps its opposing bearings');
 assert.equal(events.length,0);
 for(const p of parts)if(p.floor===0&&[0,6].includes(p.cell))p.gone=true;advance(solver,.4);
 for(const p of parts){p.gone=p.active=false;p.node.position={...p.rest};p.node.quaternion={x:0,y:0,z:0,w:1};p.vel={x:0,y:0,z:0};p.phase=null;}solver.reset();advance(solver,.2);
 assert.ok(parts.every(p=>!p.active&&!p.gone&&tilt(p)===0&&p.node.position.y===p.rest.y));
});
test('ground contact recovers existing penetration and an inverted body uses its real lowest face',()=>{
 for(const inverted of [false,true]){
  const {parts,solver}=fixture(1,1,1),p=parts[0];p.active=true;p.node.position.y=inverted?.2:-2;
  if(inverted)p.node.quaternion={x:0,y:0,z:1,w:0};
  solver.step(1/120);
  const bottom=p.node.position.y-p.halfExtents.y;
  assert.ok(p.gone||bottom>=-.001,'terrain must recover body penetration, including the upper face when inverted');
  advance(solver,2);assert.ok(p.gone||!p.active,'resolved terrain contact must have a finite end');
 }
});
test('neighbor recruitment stops at a missing storey beneath a genuinely bridged roof island',()=>{
 const {parts,solver}=fixture();parts[108].gone=true;solver.step(1/120);
 assert.equal(parts[132].active,false);assert.equal(solver.assessPart(132).reason,'bridged');
 for(const p of parts)if(p.floor===2&&[18,19].includes(p.cell))p.gone=true;
 solver.step(1/120);
 assert.equal(parts[132].active,false,'a broken vertical connection cannot recruit the independently bridged higher island');
 assert.equal(parts[132].node.position.y,parts[132].rest.y);
});
test('a recruited hinge event reports its actual surviving bearing and eccentric direction',()=>{
 const {parts,solver,releases}=fixture(2,2,5);for(const p of parts)if(p.floor===0&&p.cell%2===0)p.gone=true;
 solver.step(1/120);assert.equal(releases.length,4);
 for(const event of releases){assert.equal(event.kind,'tipping');assert.equal(event.point.x,3.43);assert.ok(event.direction.x<-.99);assert.equal(event.parts.length,4);}
});
