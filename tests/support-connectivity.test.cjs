'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Solver=require('../dist/collapse-solver.js');
const manifest=require('../dist/assets/mobile-building.json');
function make(pieces,heights){
 const parts=pieces.map(p=>({...p,rest:{...p.center},node:{position:{...p.center}},vel:{x:0,y:0,z:0},active:false,gone:false}));
 const activated=[];
 const solver=Solver.create(parts,{floorHeights:heights,groundAt:()=>heights[0],activate(p){activated.push(p.id);p.active=true;},fracture(p){p.gone=true;p.active=true;}});
 return {parts,solver,activated};
}
function shortSpan(){return make(Array.from({length:6},(_,id)=>({id,floor:Math.floor(id/3),cell:id%3,center:{x:(id%3)*2,y:1.5+Math.floor(id/3)*3,z:0},halfExtents:{x:1,y:1.5,z:1}})),[0,3,6]);}
function step(s,t=.15){for(let i=0;i<t*120;i++)s.step(1/120);}
test('actual roof sector cannot float across a full wide bay after its own lower support disappears',()=>{
 const {parts,solver}=make(manifest.pieces,manifest.floorHeights);parts[33].gone=true;
 const before=solver.diagnostics()[5],rejected=before.bridgeRejected.find(b=>b.id===41);
 assert.ok(rejected&&rejected.reason==='span too wide'&&rejected.span>before.maxBridgeSpan,'debug must identify the rejected wide span');
 step(solver);
 assert.ok(parts[41].active&&parts[41].node.position.y<parts[41].rest.y,'wide unsupported roof slab must descend');
 assert.ok(parts.filter(p=>p.floor===5&&p.id!==41).every(p=>!p.active&&p.node.position.y===p.rest.y),'directly supported roof sectors stay in place');
 assert.ok(!solver.diagnostics()[5].bridged.includes(41));
});
test('a two-metre bridge holds until anchor loss pulls its immediate bearing neighbor but preserves the next supported bay',()=>{
 // Four bays distinguish the immediately connected remaining anchor from a
 // healthy second-ring bay. The extra bay has its own unchanged lower bearing.
 const {parts,solver}=make(Array.from({length:8},(_,id)=>({id,floor:Math.floor(id/4),cell:id%4,center:{x:(id%4)*2,y:1.5+Math.floor(id/4)*3,z:0},halfExtents:{x:1,y:1.5,z:1}})),[0,3,6]);
 parts[1].gone=true;step(solver);
 assert.ok(solver.diagnostics()[1].bridged.includes(5));
 assert.ok(parts.filter(p=>p.floor===1).every(p=>!p.active&&!p.gone&&p.node.position.y===p.rest.y),'both current opposing anchors preserve the whole bridge before anchor loss');
 parts[4].gone=true;step(solver);
 assert.ok(parts[5].active&&parts[5].node.position.y<parts[5].rest.y,'the slab releases after losing one real anchor');
 assert.ok(parts[6].active&&!parts[6].gone&&Math.hypot(parts[6].node.position.x-parts[6].rest.x,parts[6].node.position.y-parts[6].rest.y)>1e-4,'the eccentric connected slab pulls its immediate intact bearing neighbor');
 assert.ok(Math.hypot(parts[6].node.quaternion.x,parts[6].node.quaternion.z)>1e-5,'the recruited neighbor actually rotates before fragmenting');
 for(const axis of ['x','y','z','w'])assert.ok(Math.abs(parts[5].node.quaternion[axis]-parts[6].node.quaternion[axis])<1e-8,'the newly released cells briefly remain one coherent patch');
 assert.ok(!parts[7].active&&!parts[7].gone&&parts[7].node.position.x===parts[7].rest.x&&parts[7].node.position.y===parts[7].rest.y,'the next healthy supported bay stays in place instead of joining a global release');
 const remote=solver.assessPart(parts[7]);
 assert.equal(remote.anchored,true);assert.deepEqual(remote.supportIds,[3]);
});
for(const shift of [{x:0,y:-1,z:0},{x:20,y:0,z:0}])test(`inactive original bearing moved by ${JSON.stringify(shift)} cannot hold a floating member`,()=>{
 const {parts,solver}=shortSpan();
 for(const p of parts)if(![0,3].includes(p.id))p.gone=true;
 Object.assign(parts[0].node.position,{x:parts[0].rest.x+shift.x,y:parts[0].rest.y+shift.y,z:shift.z});parts[0].phase='resting';
 step(solver);
 assert.ok(parts[3].active&&parts[3].node.position.y<parts[3].rest.y,'support needs current contact, not an old cell id');
});
test('a softly resting member on a different current cell retains its actual bearing',()=>{
 const {parts,solver,activated}=shortSpan();for(const p of parts)if(![0,4].includes(p.id))p.gone=true;
 parts[4].node.position.x=parts[0].node.position.x;parts[4].phase='resting';step(solver);
 assert.equal(parts[4].active,false);assert.equal(parts[4].node.position.y,parts[4].rest.y);
 assert.ok(!activated.includes(4),'a real current bearing must not repeatedly release and re-land');
});

test('bridge anchors must still meet the slab after their supported column translates away',()=>{
 const {parts,solver}=shortSpan();parts[1].gone=true;step(solver);
 assert.equal(parts[4].active,false);
 parts[2].node.position.x+=5;parts[5].node.position.x+=5;
 step(solver);
 assert.ok(parts[4].active,'old AABB adjacency cannot bridge through a new horizontal gap');
 assert.equal(parts[5].active,false,'translated column retains its real lower bearing');
});
