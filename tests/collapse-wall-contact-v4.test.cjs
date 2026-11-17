'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require('../dist/collapse-solver.js');
const rotate=(v,q)=>{const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};return{x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};};
function fixture({speed=6,count=1,axis='x',direction=1,samples,wallMinimum=0}={}){
 const identity=()=>({x:0,y:0,z:0,w:1}),other=axis==='x'?'z':'x';
 const wall={id:100,floor:0,cell:100,rest:{x:0,y:1.5,z:0},halfExtents:{x:.5,y:1.5,z:.5},node:{position:{x:0,y:1.5,z:0},quaternion:identity()},vel:{x:0,y:0,z:0},spin:{x:0,y:0,z:0},active:false,gone:false};
 const movers=Array.from({length:count},(_,i)=>{const z=i===0?0:(i%2?1:-1)*Math.ceil(i/2),rest={x:0,y:1,z:0};rest[axis]=-2*direction;rest[other]=z;
  const node={position:{...rest,y:2},quaternion:identity()},vel={x:0,y:0,z:0};node.position[axis]=-.53*direction;vel[axis]=speed*direction;
  return{id:i,floor:0,cell:i,rest,halfExtents:{x:.5,y:1,z:.5},node,vel,spin:{x:0,y:0,z:0},active:true,gone:false};});
 const points=samples||[{x:axis==='x'?.5*direction:0,y:0,z:axis==='z'?.5*direction:0},...[-1,1].flatMap(y=>[-.5,.5].map(v=>({x:axis==='x'?.5*direction:v,y,z:axis==='z'?.5*direction:v})))];
 const events=[],queries=[];
 // Exact finite plane fixture is the geometry boundary; the real solver owns
 // moving poses, finite shape samples, coherent momentum, and fracture work.
 const sweepContact=(start,end,options)=>{
  queries.push({start,end,maxTime:options.maxTime});
  if(wall.gone||options.excludeIds?.has(wall.id))return null;
  const delta=end[axis]-start[axis];if(Math.abs(delta)<1e-12)return null;
  const time=-start[axis]/delta;if(time<0||time>1)return null;
  const point={x:start.x+(end.x-start.x)*time,y:start.y+(end.y-start.y)*time,z:start.z+(end.z-start.z)*time};
  if(Math.abs(point[other])>.5||point.y<wallMinimum||point.y>3)return null;
  const normal={x:0,y:0,z:0};normal[axis]=-Math.sign(delta);
  const hit={part:wall,partId:wall.id,time,point,normal,velocity:{x:0,y:0,z:0}};
  return options.accept&&!options.accept(hit)?null:hit;
 };
 const solver=Solver.create([...movers,wall],{floorHeights:[0,3],groundAt:()=>0,contactSamples:p=>p===wall?[]:points,sweepContact,
  fracture(p,event){events.push({id:p.id,...event,releasedVelocity:{...p.vel},releasedPosition:{...p.node.position}});p.gone=true;p.active=true;}});
 const worldPoints=p=>points.map(local=>{const r=rotate(local,p.node.quaternion);return{x:p.node.position.x+r.x,y:p.node.position.y+r.y,z:p.node.position.z+r.z};});
 return{solver,movers,wall,events,worldPoints,axis,direction,queries};
}
test('finite intact shape stops against the current same-floor rear or side wall before its centre crosses',()=>{
 for(const axis of ['x','z'])for(const direction of [-1,1]){
  const f=fixture({axis,direction});f.solver.step(1/120);
  assert.ok(f.worldPoints(f.movers[0]).every(p=>p[axis]*direction<=.001),'all approaching actual surface samples stay on the incident side');
  assert.ok(f.movers[0].vel[axis]*direction<6,'contact transfers normal momentum before the centre touches');
  assert.equal(f.wall.gone,false,'a low-work member cannot destroy the wall');
 }
});
test('an eccentric actual wall contact turns the connected member without creating energy',()=>{
 const f=fixture({wallMinimum:2.5});f.solver.step(1/120);const p=f.movers[0];
 assert.ok(Math.abs(p.spin.z)>.001,'upper-face collision must create a lever-arm rotation');
 assert.ok(Math.abs(p.vel.x)<6,'wall reaction dissipates incident motion');
 const kinetic=.5*(p.vel.x**2+p.vel.y**2+p.vel.z**2)+(5/12)*(p.spin.x**2+p.spin.z**2)+(1/12)*p.spin.y**2;
 assert.ok(kinetic<=18.01,'normal reaction cannot create energy while transferring translation into rotation');
 assert.ok(f.worldPoints(p).filter(v=>v.y>=2.5).every(v=>v.x<=.001),'tipping cannot leave the contacted upper face behind the wall');
 assert.equal(f.events.length,0);
});
test('coherent mass pays both local concrete crush reserves before breaching the struck wall',()=>{
 const weak=fixture({speed:12}),heavy=fixture({speed:12,count:5});weak.solver.step(1/120);heavy.solver.step(1/120);
 assert.equal(weak.wall.gone,false,'a single body cannot pay the finite wall fracture work');
 assert.equal(heavy.wall.gone,true,'the same speed with five connected members can pay that work');
 assert.deepEqual(heavy.events.map(e=>e.id),[0,100],'local concrete impact crushes the incoming cell and just its contacted wall cell');
 assert.ok(heavy.events[0].work>=heavy.events[0].spentWork&&heavy.events[0].spentWork>0,'fracture consumes a finite part of incident work');
 assert.equal(heavy.movers.filter(p=>p.gone).length,1,'only the actual incoming contact cell crushes');
 assert.ok(heavy.movers.filter(p=>!p.gone).every(p=>p.vel.x>0&&p.vel.x<12),'the surviving coherent block keeps reduced momentum');
});
test('unpaid wall reserve crushes only the incoming cell instead of leaving an indestructible ram',()=>{
 const f=fixture({speed:9,count:5});f.solver.step(1/120);
 assert.equal(f.wall.gone,false,'incident work cannot pay both concrete fracture reserves');
 assert.deepEqual(f.events.map(e=>e.id),[0],'the actual contact cell absorbs finite crush work first');
 assert.equal(f.events[0].cause,'side-crush');
 assert.ok(f.movers.filter(p=>!p.gone).every(p=>p.vel.x<.001),'the unbroken wall blocks remaining normal motion');
 const broken=f.movers[0],released={...broken.node.position};
 for(let i=0;i<12;i++)f.solver.step(1/120);
 assert.equal(f.wall.gone,false,'an expended ram cannot keep cracking fresh wall cells');
 assert.deepEqual(broken.node.position,released,'a released source proxy cannot teleport after fragments inherit its pose');
 assert.equal(f.events.length,1,'a broken source cannot crush again');
});
test('source fragments inherit the spent-energy pose and momentum while the surviving body loses its mass',()=>{
 const f=fixture({speed:18,count:5});f.solver.step(1/120);const source=f.events.find(e=>e.id===0),wall=f.events.find(e=>e.id===100);
 assert.ok(source&&wall,'the energetic local impact may fracture both contact cells');
 assert.ok(source.releasedVelocity.x>0&&source.releasedVelocity.x<18,'new fragments inherit post-impact momentum');
 const survivors=f.movers.filter(p=>!p.gone),kinetic=.5*(survivors.reduce((sum,p)=>sum+p.vel.x**2,0)+source.releasedVelocity.x**2);
 assert.ok(kinetic<=810-source.spentWork-wall.spentWork+.01,'both crush reserves are paid before mass becomes fragments');
 assert.ok(survivors.every(p=>Math.abs(p.vel.x-source.releasedVelocity.x)<1e-8),'remaining body retains coherent reduced velocity');
 assert.deepEqual(f.movers[0].node.position,source.releasedPosition,'no continuation moves the already-released source mesh');
});
test('rotating intact geometry cannot sweep through a rear wall while its centre is stationary',()=>{
 const f=fixture({speed:0,samples:[{x:0,y:1,z:0},{x:0,y:-1,z:0}]});const p=f.movers[0];p.node.position.x=-.004;p.spin.z=-.9;
 f.solver.step(1/120);
 assert.ok(f.worldPoints(p).every(v=>v.x<=.001),'angular surface travel also requires a swept contact');
 assert.ok(p.vel.x<0||Math.abs(p.spin.z)<.9,'the wall must react to angular momentum');
});
test('actual sparse geometry passes an empty region inside its loose cell box',()=>{
 const f=fixture({samples:[{x:0,y:0,z:0}]});const p=f.movers[0];p.halfExtents.x=10;
 f.solver.step(1/120);
 assert.ok(Math.abs(p.node.position.x+.48)<1e-8,'loose structural extents must not synthesize a wall collision');
 assert.equal(p.vel.x,6);assert.equal(f.events.length,0);
});
test('gone wall geometry releases the coherent body immediately',()=>{
 const f=fixture();f.wall.gone=true;f.solver.step(1/120);
 assert.ok(f.worldPoints(f.movers[0]).some(p=>p.x>0),'destroyed walls stop constraining motion immediately');
 assert.equal(f.movers[0].vel.x,6);
});
test('a zero-time wall hit stops redundant candidate sweeps before resolving the same safe rigid pose',()=>{
 const f=fixture(),p=f.movers[0];p.node.position.x=-.5;f.solver.step(1/120);
 assert.ok(f.worldPoints(p).every(v=>v.x<=.001),'query pruning preserves the safe shape constraint');
 assert.ok(f.queries.filter(q=>q.end.x-q.start.x>.001).length<=1,'no remaining sample can precede an accepted zero-time hit');
});
test('a zero-time wall block spends the remaining substep on downward tangential motion',()=>{
 const f=fixture({speed:.1}),p=f.movers[0];p.node.position.x=-.5;p.vel.y=-10;
 f.solver.step(1/120);
 assert.ok(f.worldPoints(p).every(v=>v.x<=.001),'tangent progress cannot cross the blocking wall');
 assert.ok(p.node.position.y<1.95,'the wall constrains normal motion without discarding downward travel');
 assert.ok(p.vel.y<-9.9,'a vertical wall cannot erase downward momentum');
});
test('intact solver uses the production triangle collider and excludes its own coherent geometry',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),context=vm.createContext({window:{},console});
 for(const file of ['three-local.js','fragment-contact.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context);
 const T=context.window.THREE;
 function part(id,position,rest,geometry,halfExtents,active=false){const node=new T.Mesh(geometry,new T.MeshBasicMaterial());node.position.copy(position);
  return{id,cell:id,floor:0,rest,halfExtents,node,vel:new T.Vector3(active?6:0,0,0),spin:new T.Vector3(),active,gone:false};}
 const moving=part(0,new T.Vector3(-.53,2,0),{x:-2,y:1,z:0},new T.BoxGeometry(1,2,1),{x:.5,y:1,z:.5},true);
 const wall=part(1,new T.Vector3(0,1.5,0),{x:0,y:1.5,z:0},new T.BoxGeometry(.05,3,1),{x:.5,y:1.5,z:.5});
 const collider=context.window.SkyfallFragmentContact.create([moving,wall]);
 const vertices=Array.from({length:moving.node.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(moving.node.geometry.attributes.position,i));
 const solver=Solver.create([moving,wall],{floorHeights:[0,3],groundAt:()=>0,contactSamples:()=>vertices,sweepContact:(a,b,o)=>collider.sweep(a,b,o),fracture:p=>{p.gone=true;}});
 solver.step(1/120);
 assert.equal(wall.gone,false);
 const leading=Math.max(...vertices.map(v=>v.clone().applyQuaternion(moving.node.quaternion).add(moving.node.position).x));
 assert.ok(leading<=-.024,'actual thin triangle wall stops the leading geometry before contact penetration: '+JSON.stringify({leading,position:moving.node.position,spin:moving.spin,velocity:moving.vel}));
 assert.ok(moving.vel.x<6,'actual triangle contact supplies a finite rigid-body impulse');
 wall.gone=true;moving.vel.set(6,0,0);solver.step(1/120);
 assert.ok(moving.node.position.x>-.525,'once the wall is gone, stale self geometry cannot hold its own moving body');
});
test('an intact body touching two walls still slides under gravity and reaches a finite ground end',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),context=vm.createContext({window:{},console});
 for(const file of ['three-local.js','fragment-contact.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context);
 const T=context.window.THREE;
 function part(id,geometry,position,rest,halfExtents,active=false){const node=new T.Mesh(geometry,new T.MeshBasicMaterial());node.position.copy(position);return{id,cell:id,floor:0,node,rest,halfExtents,active,gone:false,vel:new T.Vector3(),spin:new T.Vector3()};}
 const p=part(0,new T.BoxGeometry(1,2,1),new T.Vector3(-.525,2,-.525),{x:-5,y:1,z:-5},{x:.5,y:1,z:.5},true);
 const walls=[part(1,new T.BoxGeometry(.05,3,6),new T.Vector3(0,1.5,0),{x:0,y:1.5,z:0},{x:.5,y:1.5,z:3}),part(2,new T.BoxGeometry(6,3,.05),new T.Vector3(0,1.5,0),{x:0,y:1.5,z:0},{x:3,y:1.5,z:.5})];
 p.vel.set(1,-.1,1);p.spin.set(.6,.4,.6);
 const collider=context.window.SkyfallFragmentContact.create([p,...walls]),vertices=Array.from({length:p.node.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(p.node.geometry.attributes.position,i));
 const solver=Solver.create([p,...walls],{floorHeights:[0,3],groundAt:()=>0,contactSamples:()=>vertices,sweepContact:(a,b,o)=>collider.sweep(a,b,o),fracture:q=>{q.gone=true;}});
 for(let i=0;i<240&&!p.gone;i++){collider.sync();solver.step(1/120);}
 assert.ok(p.gone||!p.active,'a wedged member must slide to ground or reach a physical resting end: '+JSON.stringify({position:p.node.position,velocity:p.vel,spin:p.spin}));
 assert.ok(p.gone||p.node.position.y<1.6,'wall contact cannot consume all downward displacement');
 assert.ok(walls.every(w=>!w.gone),'gentle side contacts do not turn settlement into new wall damage');
});
