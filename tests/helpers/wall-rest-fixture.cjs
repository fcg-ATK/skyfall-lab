// Test-only restoration of a historical multi-wall jam; the production step
// still owns finite CCD, gravity certification, anchor validation and strength.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),scope={module:{exports:{}}};
const source=fs.readFileSync(path.resolve(__dirname,'../../dist/collapse-solver.js'),'utf8'),marker='return{step,reset,supports,bottom,top,diagnostics,assessPart};';
if(!source.includes(marker))throw new Error('solver fixture restore marker changed');
vm.runInNewContext(source.replace(marker,'return{step,reset,supports,bottom,top,diagnostics,assessPart,restoreJam:p=>wallJams.add(p)};'),scope);
const Solver=scope.module.exports;
function fixture(options={}){
 const identity=()=>({x:0,y:0,z:0,w:1}),theta=70*Math.PI/180,s=Math.sin(theta),c=Math.cos(theta);
 const make=(id,rest,half,active=false)=>({id,cell:id,floor:0,rest:{...rest},restQ:identity(),halfExtents:half,node:{position:{...rest},quaternion:identity(),visible:true},vel:{x:0,y:0,z:0},spin:{x:0,y:0,z:0},active,gone:false,phase:active?'falling':'intact',direct:false});
 const body=make(0,{x:0,y:.5,z:-30},{x:.5,y:.5,z:.5},true);body.node.position={x:.03,y:1+.53*Math.tan(theta)+.005,z:0};body.vel.y=-.1;body.spin.z=.1;
 const walls=[make(1,{x:0,y:.5,z:0},{x:10,y:.5,z:10}),make(2,{x:0,y:.5,z:0},{x:10,y:.5,z:10})];
 const normals=[{x:s,y:c,z:0},{x:-s,y:c,z:0}],samples=[...[-.5,.5].flatMap(x=>[-.5,.5].flatMap(y=>[-.5,.5].map(z=>({x,y,z}))))],events=[],stats={hits:0};
 const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
 const initial=JSON.parse(JSON.stringify([body,...walls]));
 const solver=Solver.create([body,...walls],{floorHeights:[0,2],groundAt:()=>0,contactSamples:p=>p===body?samples:[],
  sweepContact(start,end,o){let best=null;const delta={x:end.x-start.x,y:end.y-start.y,z:end.z-start.z};
   for(let i=0;i<walls.length;i++){const wall=walls[i],n=normals[i];if(wall.gone||wall.node.visible===false||o.excludeIds.has(wall.id))continue;
    const relative={x:start.x-wall.node.position.x,y:start.y-wall.node.position.y,z:start.z-wall.node.position.z},offset=dot(relative,n),d=dot(delta,n);if(Math.abs(d)<1e-12)continue;
    const time=-offset/d,onFace=Math.abs(offset)<=1e-8;if(time<0&&!onFace||time>o.maxTime+1e-8||onFace&&d>=0)continue;
    const t=Math.max(0,Math.min(o.maxTime,time)),point={x:start.x+delta.x*t,y:start.y+delta.y*t,z:start.z+delta.z*t};if(Math.abs(point.x-wall.node.position.x)>10||Math.abs(point.z-wall.node.position.z)>10)continue;
    const hit={part:wall,partId:wall.id,time:t,point,normal:d>0?{x:-n.x,y:-n.y,z:0}:n,velocity:{...wall.vel}};
    if(o.accept(hit)&&(!best||t<best.time))best=hit;
   }if(best)stats.hits++;return best;
  },fracture:(p,e)=>{p.gone=true;events.push({id:p.id,...e});}});
 if(options.knownJam!==false)solver.restoreJam(body);
 return{body,walls,solver,events,stats,initial};
}
module.exports={fixture};
