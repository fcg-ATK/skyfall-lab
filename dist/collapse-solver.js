/* Bounded contact-driven structural motion, not an engineering solver. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SkyfallCollapse=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const identity=()=>({x:0,y:0,z:0,w:1});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
function projectTranslation(velocity,rows){
 const contacts=[];
 for(const row of rows){const speed=dot(row.targetVelocity,row.normal);
  if(!contacts.some(c=>Math.abs(c.speed-speed)<1e-10&&Math.abs(c.normal.x-row.normal.x)<1e-10&&Math.abs(c.normal.y-row.normal.y)<1e-10&&Math.abs(c.normal.z-row.normal.z)<1e-10))contacts.push({normal:row.normal,speed});
 }
 const feasible=v=>contacts.every(c=>dot(c.normal,v)>=c.speed-1e-12);
 if(feasible(velocity))return {...velocity};
 function candidate(indices){
  const active=indices.map(i=>contacts[i]),n=active.length;
  const a=active.map(c=>[...active.map(d=>dot(c.normal,d.normal)),c.speed-dot(c.normal,velocity)]);
  for(let k=0;k<n;k++){
   let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
   if(Math.abs(a[pivot][k])<1e-13)return null;
   [a[k],a[pivot]]=[a[pivot],a[k]];
   const divisor=a[k][k];for(let j=k;j<=n;j++)a[k][j]/=divisor;
   for(let i=0;i<n;i++)if(i!==k){const factor=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=factor*a[k][j];}
  }
  const lambda=a.map(row=>row[n]);if(lambda.some(x=>x< -1e-10))return null;
  let v={...velocity};
  if(active.every(c=>c.speed===0)&&n===2){const line=cross(active[0].normal,active[1].normal),scale=dot(line,velocity)/dot(line,line);v={x:line.x*scale,y:line.y*scale,z:line.z*scale};}
  else if(active.every(c=>c.speed===0)&&n===3)v={x:0,y:0,z:0};
  else for(let i=0;i<n;i++)for(const axis of ['x','y','z'])v[axis]+=active[i].normal[axis]*lambda[i];
  return feasible(v)?v:null;
 }
 for(let i=0;i<contacts.length;i++){const v=candidate([i]);if(v)return v;}
 for(let i=0;i<contacts.length;i++)for(let j=i+1;j<contacts.length;j++){const v=candidate([i,j]);if(v)return v;}
 for(let i=0;i<contacts.length;i++)for(let j=i+1;j<contacts.length;j++)for(let k=j+1;k<contacts.length;k++){const v=candidate([i,j,k]);if(v)return v;}
 return null;
}
function mul(a,b){return{x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z};}
function rotate(v,q){const t=cross(q,v),u=cross(q,t);return{x:v.x+2*(q.w*t.x+u.x),y:v.y+2*(q.w*t.y+u.y),z:v.z+2*(q.w*t.z+u.z)};}
function turn(spin,h){const speed=Math.hypot(spin.x,spin.y,spin.z),s=speed?Math.sin(speed*h/2)/speed:0;return{x:spin.x*s,y:spin.y*s,z:spin.z*s,w:Math.cos(speed*h/2)};}
function bearsCenter(points,center){
 const sorted=points.slice().sort((a,b)=>a.x-b.x||a.z-b.z).filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>.001);
 const side=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x),half=[];
 for(const p of sorted){while(half.length>1&&side(half.at(-2),half.at(-1),p)<=0)half.pop();half.push(p);}
 const lower=half.length;for(let i=sorted.length-2;i>=0;i--){const p=sorted[i];while(half.length>lower&&side(half.at(-2),half.at(-1),p)<=0)half.pop();half.push(p);}half.pop();
 if(half.length<3)return false;
 return half.every((p,i)=>side(p,half[(i+1)%half.length],center)>=-.05);
}
function create(parts,options={}) {
 const floors=[...new Set(parts.map(p=>p.floor))].sort((a,b)=>a-b),level=new Map();
 for(const f of floors){const row=parts.filter(p=>p.floor===f);level.set(f,options.floorHeights?.[f]??Math.min(...row.map(p=>p.rest.y-p.halfExtents.y)));}
 const ceiling=f=>options.floorHeights?.[f+1]??level.get(f+1)??Math.max(...parts.filter(p=>p.floor===f).map(p=>p.rest.y+p.halfExtents.y));
 const adjacent=(a,b)=>{
  const dx=Math.abs(a.rest.x-b.rest.x),dz=Math.abs(a.rest.z-b.rest.z),hx=a.halfExtents.x+b.halfExtents.x,hz=a.halfExtents.z+b.halfExtents.z;
  // Shared edges carry a slab connection; overlapping diagonal bounds do not.
  return dx<=hx+.1&&dz<=hz+.1&&(dx<hx*.45||dz<hz*.45);
 };
 const vertical=(a,b)=>Math.abs(a.floor-b.floor)===1&&a.cell===b.cell&&adjacent(a,b);
 const key=(a,b)=>a.id<b.id?`${a.id}:${b.id}`:`${b.id}:${a.id}`;
 const seams=new Set();
 function components(list,neighbor){const remaining=new Set(list),out=[];while(remaining.size){const group=[remaining.values().next().value];remaining.delete(group[0]);for(let i=0;i<group.length;i++)for(const p of remaining)if(neighbor(group[i],p)){group.push(p);remaining.delete(p);}out.push(group);}return out;}
 const rows=floors.flatMap(f=>components(parts.filter(p=>p.floor===f),adjacent));
 const lowerCandidates=new Map(parts.map(p=>[p.id,parts.filter(q=>q.floor<p.floor).sort((a,b)=>(a.cell===p.cell?0:1)-(b.cell===p.cell?0:1)||b.floor-a.floor)]));
 const originalCell=new Map(parts.map(p=>[p.floor+':'+p.cell,p]));
 function deltaQ(p){const r=p.restQ||identity();return mul(p.node.quaternion||identity(),{x:-r.x,y:-r.y,z:-r.z,w:r.w});}
 function corners(p,y){const q=deltaQ(p),out=[];for(const x of [-p.halfExtents.x,p.halfExtents.x])for(const z of [-p.halfExtents.z,p.halfExtents.z])out.push(add(p.node.position,rotate({x,y:y-p.rest.y,z},q)));return out;}
 const bottom=p=>Math.min(...corners(p,level.get(p.floor)).map(c=>c.y));
 const top=p=>Math.max(...corners(p,ceiling(p.floor)).map(c=>c.y));
 // Copy every scalar: callers retain the prior support list for swept contacts.
 function snapshot(p){
  const center={x:p.node.position.x,y:p.node.position.y,z:p.node.position.z},q=deltaQ(p),inverse={x:-q.x,y:-q.y,z:-q.z,w:q.w};
  const normal=rotate({x:0,y:1,z:0},q),offset=ceiling(p.floor)-p.rest.y;
  const plane=add(center,rotate({x:0,y:offset,z:0},q));
  const points=corners(p,ceiling(p.floor)),vx=p.vel.x||0,vy=p.vel.y||0,vz=p.vel.z||0,spin={x:p.spin.x||0,y:p.spin.y||0,z:p.spin.z||0};
  const hx=p.halfExtents.x,hz=p.halfExtents.z;
  const surfaceAt=(x,z)=>normal.y>.15?plane.y-(normal.x*(x-plane.x)+normal.z*(z-plane.z))/normal.y:-Infinity;
  return{id:p.id,floor:p.floor,minX:Math.min(...points.map(c=>c.x)),maxX:Math.max(...points.map(c=>c.x)),minZ:Math.min(...points.map(c=>c.z)),maxZ:Math.max(...points.map(c=>c.z)),top:Math.max(...points.map(c=>c.y)),velocityY:vy,
   surfaceAt,
   contains(x,z,padX=0,padZ=0){if(normal.y<=.15)return false;const local=rotate(sub({x,y:surfaceAt(x,z),z},center),inverse);return Math.abs(local.x)<=hx+padX&&Math.abs(local.z)<=hz+padZ;},
   velocityAt(x,z){return add({x:vx,y:vy,z:vz},cross(spin,sub({x,y:surfaceAt(x,z),z},center)));}
  };
 }
 let changed=false;
 for(const p of parts){p.spin??={x:0,y:0,z:0};p.node.quaternion??=identity();}
 const threshold=.35;
 const storeys=floors.map(f=>ceiling(f)-level.get(f)).filter(h=>h>0).sort((a,b)=>a-b);
 // Game-scale slab capacity includes a modest short-span reserve: the refined
 // 3.43 x 3.71 m bays can bridge between opposing bearings at 3.3 m storeys.
 // Wider gaps still release; the tall roof AABB cannot grant an invisible beam.
 const maxBridgeSpan=(storeys[Math.floor(storeys.length/2)]||3.3)*1.15;
 const basePoint=p=>add(p.node.position,rotate({x:0,y:level.get(p.floor)-p.rest.y,z:0},deltaQ(p)));
 const onGround=p=>(p.phase==='resting'||p.floor===floors[0])&&bottom(p)<=(options.groundAt?.(p.node.position.x,p.node.position.z)??.24)+.12;
 function ownsLoad(q,point,cell){
  if(q.cell===cell)return true;
  const original=originalCell.get(q.floor+':'+cell);
  return !original||Math.hypot(point.x-q.node.position.x,point.z-q.node.position.z)<Math.hypot(point.x-original.rest.x,point.z-original.rest.z);
 }
 function bearingContacts(p,surfaces){
  if(onGround(p))return [];
  const point=basePoint(p);
  return lowerCandidates.get(p.id).filter(q=>{
   if(q.gone||q.active||!ownsLoad(q,point,p.cell))return false;
   if(!surfaces.has(q.id)){
    const rotation=deltaQ(q);
    surfaces.set(q.id,{normal:rotate({x:0,y:1,z:0},rotation),plane:add(q.node.position,rotate({x:0,y:ceiling(q.floor)-q.rest.y,z:0},rotation)),inverse:{x:-rotation.x,y:-rotation.y,z:-rotation.z,w:rotation.w}});
   }
   const surface=surfaces.get(q.id),n=surface.normal,plane=surface.plane;
   if(n.y<=.15)return false;
   const height=plane.y-(n.x*(point.x-plane.x)+n.z*(point.z-plane.z))/n.y;
   if(Math.abs(point.y-height)>.12)return false;
   const local=rotate(sub({x:point.x,y:height,z:point.z},q.node.position),surface.inverse);
   return Math.abs(local.x)<=q.halfExtents.x+.02&&Math.abs(local.z)<=q.halfExtents.z+.02;
  });
 }
 const directlyBorne=(p,surfaces)=>wallRests.has(p)||onGround(p)||bearingContacts(p,surfaces).length>0;
 function supportState(live,surfaces=new Map()){
  const bearing=live.filter(p=>!p.active&&directlyBorne(p,surfaces)),ratio=live.length?bearing.length/live.length:0;
  const bridged=[],bridgeSpans=[],bridgeRejected=[];
  if(ratio>=threshold)for(const p of live){
   if(p.active||bearing.includes(p))continue;
   const anchors=bearing.filter(q=>adjacent(p,q)&&
    Math.hypot(p.node.position.x-p.rest.x-q.node.position.x+q.rest.x,p.node.position.z-p.rest.z-q.node.position.z+q.rest.z)<=.2&&
    Math.abs(basePoint(p).y-basePoint(q).y)<=.12);
   let best=null;
   for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){
    const a=anchors[i],b=anchors[j],ax=a.node.position.x-p.node.position.x,az=a.node.position.z-p.node.position.z,bx=b.node.position.x-p.node.position.x,bz=b.node.position.z-p.node.position.z;
    const da=Math.hypot(ax,az),db=Math.hypot(bx,bz);
    if(da===0||db===0||(ax*bx+az*bz)/da/db>=-.95)continue;
    // Cell territories end halfway to neighbouring centres. Unlike mesh AABBs,
    // these bearing edges cannot overlap to disguise a full missing bay.
    const span=(da+db)/2;
    if(!best||span<best.span)best={id:p.id,span,anchors:[a.id,b.id]};
   }
   if(best&&best.span<=maxBridgeSpan){bridged.push(p);bridgeSpans.push(best);}
   else bridgeRejected.push({id:p.id,reason:best?'span too wide':'no current opposing anchors',span:best?.span??null,anchors:best?.anchors??[]});
  }
  return {bearing,bridged,ratio,bridgeSpans,bridgeRejected,unsupported:live.filter(p=>!bearing.includes(p)&&!bridged.includes(p))};
 }
 // Relative game-scale loads, not engineering force units. Mesh boxes include
 // projecting slabs, so a column's weak width is bounded by its nearest bay.
 const widths=new Map(parts.map(p=>[p.id,Object.fromEntries(['x','z'].map(axis=>{
  const other=axis==='x'?'z':'x',neighbors=parts.filter(q=>q.floor===p.floor&&q!==p&&Math.abs(q.rest[other]-p.rest[other])<Math.min(p.halfExtents[other],q.halfExtents[other])*.65);
  return[axis,Math.max(.2,Math.min(p.halfExtents[axis]*2,...neighbors.map(q=>Math.abs(q.rest[axis]-p.rest[axis])).filter(d=>d>.1)))];
 }))]));
 const areas=parts.map(p=>widths.get(p.id).x*widths.get(p.id).z).sort((a,b)=>a-b),unitArea=areas[Math.floor(areas.length/2)]||1;
 const weights=new Map(parts.map(p=>[p.id,widths.get(p.id).x*widths.get(p.id).z/unitArea]));
 const nominalLoads=new Map(parts.map(p=>[p.id,parts.filter(q=>q.cell===p.cell&&q.floor>=p.floor).reduce((s,q)=>s+weights.get(q.id),0)]));
 const failures=new Map(),wallJams=new Set(),wallRests=new Map();let assessmentCache=null,assessmentKey='',settledSignature=null;
 function structuralSignature(){
  return parts.map(p=>p.gone?'g':[
   p.active,p.phase,p.node.position.x,p.node.position.y,p.node.position.z,
   p.node.quaternion.x,p.node.quaternion.y,p.node.quaternion.z,p.node.quaternion.w,
   options.groundAt?.(p.node.position.x,p.node.position.z)??.24
  ].join(',')).join('|');
 }
 const stillConnected=(a,b)=>adjacent(a,b)&&Math.hypot(a.node.position.x-a.rest.x-b.node.position.x+b.rest.x,a.node.position.z-a.rest.z-b.node.position.z+b.rest.z)<=.2&&Math.abs(basePoint(a).y-basePoint(b).y)<=.12;
 function assessments(){
  const signature=parts.map(p=>p.gone?'g':p.active?'a':[p.node.position.x,p.node.position.y,p.node.position.z,p.node.quaternion.x,p.node.quaternion.y,p.node.quaternion.z,p.node.quaternion.w].join(',')).join('|');
  if(assessmentCache&&signature===assessmentKey)return assessmentCache;
  const surfaces=new Map(),states=new Map(parts.map(p=>[p.id,{id:p.id,floor:p.floor,cell:p.cell,state:p.gone?'gone':p.active?'falling':'standing',anchored:false,grounded:!p.gone&&!p.active&&onGround(p),load:0,capacity:0,utilization:0,supportIds:[],carriedIds:[],centerOfLoad:{...p.node.position},unbracedHeight:0,weakWidth:Math.min(widths.get(p.id).x,widths.get(p.id).z),reason:p.gone?'gone':p.active?'falling':'unsupported',criticalReason:null,failure:failures.get(p.id)||null}]));
  for(const [p,rest] of wallRests){const s=states.get(p.id);if(s){s.supportIds=rest.supports.map(s=>s.part.id);s.reason='wall contact';}}
  for(const row of rows)for(const group of components(row.filter(p=>!p.gone&&!p.active&&!wallRests.has(p)),stillConnected)){
   const support=supportState(group,surfaces);
   for(const p of support.bearing){const s=states.get(p.id);s.supportIds=bearingContacts(p,surfaces).map(q=>q.id);s.reason='bearing';}
   for(const bridge of support.bridgeSpans){const s=states.get(bridge.id);s.supportIds=bridge.anchors.slice();s.reason='bridged';}
  }
  if(wallRests.size)for(const s of states.values())if(!wallRests.has(parts.find(p=>p.id===s.id)))s.supportIds=s.supportIds.filter(id=>!wallRests.get(parts.find(p=>p.id===id))?.anchorIds.has(s.id));
  function anchored(s,visiting=new Set()){
   if(s.grounded)return true;if(!s.supportIds.length||visiting.has(s.id))return false;
   const next=new Set(visiting);next.add(s.id);return s.supportIds.every(id=>anchored(states.get(id),next));
  }
  for(const s of states.values())s.anchored=anchored(s);
  const braced=new Set();
  for(const row of rows)for(const group of components(row.filter(p=>states.get(p.id).anchored&&!wallRests.has(p)),stillConnected)){
   // A line of surviving columns cannot restrain sway perpendicular to itself.
   // Require a connected floor footprint with a substantial second dimension.
   let area=0;
   const sufficient=Math.max(...group.map(p=>{const w=widths.get(p.id);return w.x*w.z*.35;}));
   // The area is only compared with these thresholds. Once all are exceeded,
   // larger triangles cannot change any bracing decision in this component.
   triangleSearch:for(const a of group)for(const b of group)for(const c of group){
    area=Math.max(area,Math.abs((b.node.position.x-a.node.position.x)*(c.node.position.z-a.node.position.z)-(b.node.position.z-a.node.position.z)*(c.node.position.x-a.node.position.x)));
    if(area>sufficient)break triangleSearch;
   }
   for(const p of group){const w=widths.get(p.id);if(group.length>=3&&area>w.x*w.z*.35)braced.add(p.id);}
  }
  let order=parts.filter(p=>!p.gone&&!p.active).sort((a,b)=>b.floor-a.floor||(states.get(a.id).reason==='bridged'?-1:0)-(states.get(b.id).reason==='bridged'?-1:0));
  if(wallRests.size){
   // Side bearings may be above the carried member. A topological order sends
   // every own weight through the validated support DAG exactly once, without
   // changing the ordinary floor-order path when there are no wall rests.
   const byId=new Map(order.map(p=>[p.id,p])),incoming=new Map(order.map(p=>[p.id,0]));
   for(const p of order)for(const id of states.get(p.id).supportIds)if(incoming.has(id))incoming.set(id,incoming.get(id)+1);
   const queue=order.filter(p=>incoming.get(p.id)===0),sorted=[];
   for(let i=0;i<queue.length;i++){const p=queue[i];sorted.push(p);for(const id of states.get(p.id).supportIds)if(incoming.has(id)){incoming.set(id,incoming.get(id)-1);if(!incoming.get(id))queue.push(byId.get(id));}}
   const done=new Set(sorted);order=[...sorted,...order.filter(p=>!done.has(p))];
  }
  for(const p of order){const s=states.get(p.id),own=weights.get(p.id),total=s.load+own;
   s.centerOfLoad={x:(s.centerOfLoad.x*s.load+p.node.position.x*own)/total,y:(s.centerOfLoad.y*s.load+p.node.position.y*own)/total,z:(s.centerOfLoad.z*s.load+p.node.position.z*own)/total};s.load=total;
   for(const id of s.supportIds){const q=states.get(id),share=total/s.supportIds.length,next=q.load+share;
    q.centerOfLoad={x:(q.centerOfLoad.x*q.load+s.centerOfLoad.x*share)/next,y:(q.centerOfLoad.y*q.load+s.centerOfLoad.y*share)/next,z:(q.centerOfLoad.z*q.load+s.centerOfLoad.z*share)/next};q.load=next;
    q.carriedIds.push(p.id,...s.carriedIds);
   }
  }
  for(const p of order){const s=states.get(p.id);s.carriedIds=[...new Set(s.carriedIds)];
   const stack=[p,...s.carriedIds.map(id=>parts.find(q=>q.id===id))],highest=Math.max(...stack.map(top));
   const nextBrace=stack.filter(q=>q.floor>p.floor&&braced.has(q.id)).map(q=>basePoint(q).y);
   s.unbracedHeight=Math.max(.1,(nextBrace.length?Math.min(...nextBrace):highest)-basePoint(p).y);
   // A 60% intact reserve supports real short spans. Slender, unrestrained
   // full-height remnants lose capacity; a short grounded stump retains it.
   const slenderness=s.unbracedHeight/(5.9*s.weakWidth);
   s.capacity=nominalLoads.get(p.id)*1.6/(1+slenderness*slenderness);
   s.utilization=s.capacity?s.load/s.capacity:0;
   if(!s.anchored)s.reason='unsupported';
   else if(s.load>s.capacity){s.reason='overload';s.criticalReason='unbraced load exceeds capacity';}
   else if(s.carriedIds.length&&s.utilization>=.85)s.criticalReason='limited bearing reserve';
  }
  assessmentKey=signature;assessmentCache=states;return states;
 }
 function assessPart(part){const value=assessments().get(typeof part==='object'?part.id:part);return value?{...value,supportIds:value.supportIds.slice(),carriedIds:value.carriedIds.slice(),centerOfLoad:{...value.centerOfLoad},failure:value.failure?{...value.failure}:null}:null;}
 function failOverloaded(only){
  // Only the lowest overloaded bearing on a load path fails this substep.
  // Upper members then descend through the existing contact/gravity solver.
  const states=assessments(),overloaded=parts.filter(p=>!p.gone&&!p.active&&(!only||only.has(p.id))&&states.get(p.id).reason==='overload');
  const lowest=overloaded.filter(p=>!overloaded.some(q=>q.floor<p.floor&&states.get(q.id).carriedIds.includes(p.id)));
  for(const p of lowest){const s=states.get(p.id);failures.set(p.id,{reason:s.criticalReason,load:s.load,capacity:s.capacity,unbracedHeight:s.unbracedHeight,weakWidth:s.weakWidth});
   options.fracture?.(p,{cause:'overload',energy:Math.max(2,s.utilization*2),point:basePoint(p)});changed=true;
  }
  if(lowest.length)assessmentCache=null;
 }
 function releaseUnsupported(){
  const surfaces=new Map();
  for(const row of rows)for(const live of components(row.filter(p=>!p.gone&&!p.active&&!wallRests.has(p)),adjacent)){
   const {bearing,bridged,unsupported}=supportState(live,surfaces);
   if(!unsupported.length)continue;
   for(const island of components(unsupported,adjacent)){
    // A slab edge transfers the weight above the missing bearing. Its finite
    // bending reserve can yield the immediately connected bearing strip before
    // that strip fractures. Never walk this recruitment through another strip.
    const tower=p=>{
     const stack=[p];
     for(const floor of floors.filter(f=>f>p.floor)){
      const q=originalCell.get(floor+':'+p.cell),below=stack.at(-1);
      if(!q||q.gone||q.active||!vertical(below,q)||Math.abs(basePoint(q).y-top(below))>.12||Math.hypot(q.node.position.x-q.rest.x-below.node.position.x+below.rest.x,q.node.position.z-q.rest.z-below.node.position.z+below.rest.z)>.2)break;
      stack.push(q);
     }
     return stack;
    };
    const towerMass=p=>tower(p).reduce((sum,q)=>sum+weights.get(q.id),0);
    const demand=new Map();
    for(const p of island){
     const anchors=bearing.filter(q=>stillConnected(p,q)),load=towerMass(p);
     for(const q of anchors)demand.set(q,(demand.get(q)||0)+load/anchors.length);
    }
    const recruited=[...demand].filter(([p,load])=>load>Math.max(.7,towerMass(p)*.38)).map(([p])=>p);
    // Only an eccentric strip is recruited. Opposed connections can shed a
    // failed central slab without prescribing a turn to a balanced building.
    const massCenter=island.reduce((c,p)=>add(c,{x:p.node.position.x/island.length,y:0,z:p.node.position.z/island.length}),{x:0,y:0,z:0});
    const anchorPoints=[...demand.keys()].map(p=>p.node.position);
    const eccentric=!bearsCenter(anchorPoints,massCenter);
    const starters=eccentric?[...island,...recruited]:island;
    const released=[...new Set(starters.flatMap(tower))];
    for(const p of released)if(recruited.some(q=>q.cell===p.cell))p.coupledBearing=true;
    for(const floor of floors){
    const levelIsland=released.filter(p=>p.floor===floor&&!p.active);if(!levelIsland.length)continue;
    const center={x:0,y:0,z:0},connections=[];
    const standing=parts.filter(p=>p.floor===floor&&!p.gone&&!p.active&&!released.includes(p));
    for(const p of levelIsland)for(const axis of ['x','y','z'])center[axis]+=p.node.position[axis]/levelIsland.length;
    for(const p of levelIsland){
     p.releaseConnections=[];
     for(const q of standing){
      if(recruited.length&&eccentric)continue;
      if(!stillConnected(p,q))continue;
      const wp=widths.get(p.id),wq=widths.get(q.id),dx=q.node.position.x-p.node.position.x,dz=q.node.position.z-p.node.position.z;
      const axis=Math.abs(dx)/(wp.x+wq.x)>=Math.abs(dz)/(wp.z+wq.z)?'x':'z',other=axis==='x'?'z':'x';
      const lo=Math.max(p.node.position[other]-wp[other]/2,q.node.position[other]-wq[other]/2),hi=Math.min(p.node.position[other]+wp[other]/2,q.node.position[other]+wq[other]/2);
      if(hi<=lo)continue;
      // The shared territory edge is the slab connection, not the remote
      // centroid of all surviving bearings or the overlapping mesh AABBs.
      const point={x:0,y:(basePoint(p).y+basePoint(q).y)/2,z:0};
      point[axis]=(p.node.position[axis]+q.node.position[axis])/2;point[other]=(lo+hi)/2;
      const rotation=deltaQ(p),inverse={x:-rotation.x,y:-rotation.y,z:-rotation.z,w:rotation.w};
      const anchorRotation=deltaQ(q),anchorInverse={x:-anchorRotation.x,y:-anchorRotation.y,z:-anchorRotation.z,w:anchorRotation.w};
      const link={anchor:q,point,local:rotate(sub(point,p.node.position),inverse),anchorLocal:rotate(sub(point,q.node.position),anchorInverse),length:hi-lo,
       opening:Math.min(.9,(ceiling(p.floor)-level.get(p.floor))*.25)};
      p.releaseConnections.push(link);connections.push(link);
     }
    }
    const span=connections.reduce((sum,c)=>sum+c.length,0),pivot={...center};
    if(span)for(const axis of ['x','y','z'])pivot[axis]=connections.reduce((sum,c)=>sum+c.point[axis]*c.length,0)/span;
    const hinges=levelIsland.filter(p=>p.coupledBearing);
    if(!span&&hinges.length)for(const axis of ['x','y','z'])pivot[axis]=hinges.reduce((sum,p)=>sum+basePoint(p)[axis],0)/hinges.length;
    const bias={x:span||hinges.length?center.x-pivot.x:0,z:span||hinges.length?center.z-pivot.z:0},length=Math.hypot(bias.x,bias.z);
    if(length>0){bias.x/=length;bias.z/=length;}
    for(const p of levelIsland){
     options.activate?.(p);p.active=true;p.fallBias={...bias};
     changed=true;
    }
    options.onRelease?.({parts:levelIsland.map(p=>p.id),point:{...pivot},direction:{x:bias.x,y:0,z:bias.z},floor,
     kind:length>.05?'tipping':'dropping',mass:levelIsland.reduce((sum,p)=>sum+weights.get(p.id),0)});
    }
   }
  }
 }
 function connectionReaction(group,center,velocity,spin,h){
  let force=0,torqueX=0,torqueZ=0,inertiaX=0,inertiaZ=0;
  for(const p of group){
   const offset=sub(p.node.position,center),w=widths.get(p.id),height=ceiling(p.floor)-level.get(p.floor);
   inertiaX+=offset.y*offset.y+offset.z*offset.z+(height*height+w.z*w.z)/12;
   inertiaZ+=offset.y*offset.y+offset.x*offset.x+(height*height+w.x*w.x)/12;
   const links=p.releaseConnections||[],span=links.reduce((sum,c)=>sum+c.length,0),retained=[];
   for(const link of links){
    if(link.anchor.gone||link.anchor.active)continue;
    const point=add(p.node.position,rotate(link.local,deltaQ(p))),anchor=add(link.anchor.node.position,rotate(link.anchorLocal,deltaQ(link.anchor)));
    const opening=Math.hypot(point.x-anchor.x,point.y-anchor.y,point.z-anchor.z);
    if(opening>=link.opening)continue;
    retained.push(link);
    // A failing slab edge retains at most 42% of its tributary weight. It
    // always descends, stretching and opening the seam; no timer suspends it.
    // The real lever and mass inertia determine its turn before impact.
    const reaction=9.8*.42*(1-opening/link.opening)*link.length/span;
    force+=reaction;torqueX-=(point.z-center.z)*reaction;torqueZ+=(point.x-center.x)*reaction;
   }
   p.releaseConnections=retained;
  }
  velocity.y+=force/group.length*h;
  spin.x+=torqueX/Math.max(.01,inertiaX)*h;spin.z+=torqueZ/Math.max(.01,inertiaZ)*h;
 }
 function diagnostics(){
  const surfaces=new Map(),loads=assessments();
  return floors.map(floor=>{
   const live=parts.filter(p=>p.floor===floor&&!p.gone),groups=components(live,adjacent),states=groups.map(group=>supportState(group,surfaces));
   const bearing=states.reduce((n,s)=>n+s.bearing.length,0),bridged=states.flatMap(s=>s.bridged.map(p=>p.id));
   const falling=live.filter(p=>p.active).map(p=>p.id),unsupported=states.flatMap(s=>s.unsupported.map(p=>p.id));
   return {floor,live:live.length,bearing,ratio:live.length?bearing/live.length:0,threshold,maxBridgeSpan,bridged,bridgeSpans:states.flatMap(s=>s.bridgeSpans),bridgeRejected:states.flatMap(s=>s.bridgeRejected),unsupported,falling,
    loads:live.map(p=>assessPart(p.id)),overloaded:live.filter(p=>loads.get(p.id).reason==='overload').map(p=>p.id),failures:parts.filter(p=>p.floor===floor&&failures.has(p.id)).map(p=>({id:p.id,...failures.get(p.id)})),
    reason:!live.length?'destroyed':live.some(p=>loads.get(p.id).reason==='overload')?'overload':falling.length||unsupported.length?'local support loss':bridged.length?'bridged gap':'bearing'};
  });
 }
 function breakAt(p,speed,point){if(p.gone)return;options.fracture?.(p,{cause:'compression',energy:Math.max(1,speed),point});changed=true;}
 function contactCorners(p){
  if(!p.coupledBearing)return corners(p,level.get(p.floor));
  // The bearing core occupies a fraction of a bay; projecting architectural
  // slabs are not a full-width column capable of holding an eccentric block.
  const w=widths.get(p.id),q=deltaQ(p),out=[];
  for(const x of [-w.x*.1,w.x*.1])for(const z of [-w.z*.1,w.z*.1])out.push(add(p.node.position,rotate({x,y:level.get(p.floor)-p.rest.y,z},q)));
  return out;
 }
 // Architectural cell boxes include windows and empty space. Only the mesh
 // adapter's actual local surface samples are swept against real triangles.
 function wallContacts(group,center,velocity,spin,h,initialPoses){
  if(!options.sweepContact||!options.contactSamples)return;
  const excludeIds=new Set(group.map(p=>p.id));
  for(const p of group)for(const link of p.releaseConnections||[])excludeIds.add(link.anchor.id);
  const samples=group.map(p=>options.contactSamples(p)||[]);
  // The collider can reject a whole coherent trajectory before transforming
  // every actual mesh sample. These local boxes enclose all supplied samples;
  // no geometry samples or narrow-phase contacts are substituted or removed.
  const sampleBounds=options.contactCandidates?samples.map(points=>{
   const half={x:0,y:0,z:0};
   for(const p of points){half.x=Math.max(half.x,Math.abs(p.x));half.y=Math.max(half.y,Math.abs(p.y));half.z=Math.max(half.z,Math.abs(p.z));}
   return half;
  }):null;
  const mass=group.reduce((sum,p)=>sum+weights.get(p.id),0);
  let poses=initialPoses,origin={...center},remaining=h;
  const world=(v,pose)=>{const q=pose.quaternion,p=pose.position,tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
   return{x:p.x+v.x+q.w*tx+q.y*tz-q.z*ty,y:p.y+v.y+q.w*ty+q.z*tx-q.x*tz,z:p.z+v.z+q.w*tz+q.x*ty-q.y*tx};};
  const query={radius:0,excludeIds,movingPart:null,maxTime:1,
   accept:hit=>Math.abs(hit.normal?.y??1)<.8&&!hit.part?.gone&&!excludeIds.has(hit.partId??hit.part?.id)};
  let constrained=group.some(p=>wallJams.has(p)),constrainedAxis=null;
  function separate(normal,center){
   if(constrainedAxis){
    const along=dot(normal,constrainedAxis),tangent=sub(normal,{x:constrainedAxis.x*along,y:constrainedAxis.y*along,z:constrainedAxis.z*along}),length=Math.hypot(tangent.x,tangent.y,tangent.z);
    if(length>1e-8)normal=tangent;
   }
   let fraction=1,blocker=null;
   if(constrained){
    // Numerical separation must not push a previously wedged finite shape
    // through its other wall. Sweep this straight 2mm correction itself;
    // current-face departure is rejected by the same exact triangle collider.
    const pool=query.candidates;query.candidates=null;
    correctionSearch:for(let i=0;i<group.length;i++)for(const local of samples[i]){
     const before=world(local,group[i].node),after=add(before,{x:normal.x*.002,y:normal.y*.002,z:normal.z*.002});
     query.movingPart=group[i];query.maxTime=fraction;
     const hit=options.sweepContact(before,after,query),time=hit?.time??hit?.t;
     if(hit&&query.accept(hit)&&Number.isFinite(time)&&time>=0&&time<=fraction){fraction=time;blocker={...hit,source:group[i],local};if(time===0)break correctionSearch;}
    }
    query.candidates=pool;
    fraction=Math.max(0,fraction-1e-6);
    // This is a real second contact, not just a clamp of numerical slop.
    // Retain it in the current solve so repeated first-wall t=0 hits cannot
    // hide the opposing constraint that blocked their separation correction.
    if(blocker)manifold.push({normal:blocker.normal,point:blocker.point,source:blocker.source,local:blocker.local,target:blocker.part||parts.find(p=>p.id===blocker.partId),targetVelocity:blocker.velocity||{x:0,y:0,z:0}});
   }
   for(const p of group)for(const axis of ['x','y','z'])p.node.position[axis]+=normal[axis]*.002*fraction;
   for(const axis of ['x','y','z'])center[axis]+=normal[axis]*.002*fraction;
  }
  function candidates(from){
   const bounds={min:{x:Infinity,y:Infinity,z:Infinity},max:{x:-Infinity,y:-Infinity,z:-Infinity}};
   for(let i=0;i<group.length;i++){
    if(!samples[i].length)continue;
    const half=sampleBounds[i];
    for(const pose of [from.get(group[i]),group[i].node]){
     const q=pose.quaternion,p=pose.position;
     // Absolute linear quaternion transform bounds each endpoint independently,
     // including non-unit input quaternions. A line segment lies in their union.
     const x=Math.abs(1-2*q.y*q.y-2*q.z*q.z)*half.x+Math.abs(2*q.x*q.y-2*q.w*q.z)*half.y+Math.abs(2*q.x*q.z+2*q.w*q.y)*half.z;
     const y=Math.abs(2*q.x*q.y+2*q.w*q.z)*half.x+Math.abs(1-2*q.x*q.x-2*q.z*q.z)*half.y+Math.abs(2*q.y*q.z-2*q.w*q.x)*half.z;
     const z=Math.abs(2*q.x*q.z-2*q.w*q.y)*half.x+Math.abs(2*q.y*q.z+2*q.w*q.x)*half.y+Math.abs(1-2*q.x*q.x-2*q.y*q.y)*half.z;
     const guard=1e-9*Math.max(1,Math.abs(p.x),Math.abs(p.y),Math.abs(p.z),x,y,z);
     bounds.min.x=Math.min(bounds.min.x,p.x-x-guard);bounds.max.x=Math.max(bounds.max.x,p.x+x+guard);
     bounds.min.y=Math.min(bounds.min.y,p.y-y-guard);bounds.max.y=Math.max(bounds.max.y,p.y+y+guard);
     bounds.min.z=Math.min(bounds.min.z,p.z-z-guard);bounds.max.z=Math.max(bounds.max.z,p.z+z+guard);
    }
   }
   // Invalid caller samples retain the original unrestricted query path.
   if(!Number.isFinite(bounds.min.x+bounds.min.y+bounds.min.z+bounds.max.x+bounds.max.y+bounds.max.z))return null;
   return options.contactCandidates(bounds,query);
  }
  const save=()=>new Map(group.map(p=>[p,poseOf(p)]));
  function advance(from,start,duration){
   const rotation=turn(spin,duration),next=add(start,{x:velocity.x*duration,y:velocity.y*duration,z:velocity.z*duration});
   for(const p of group){const pose=from.get(p);
    Object.assign(p.node.position,add(next,rotate(sub(pose.position,start),rotation)));
    Object.assign(p.node.quaternion,mul(rotation,pose.quaternion));
    Object.assign(p.vel,add(velocity,cross(spin,sub(p.node.position,next))));Object.assign(p.spin,spin);
   }
   return next;
  }
  const manifold=[];let iterationLimit=4,restingCandidate=null;
  function tryRest(){
   if(!restingCandidate)return false;
   const states=assessments(),valid=[],supports=new Set(),pool=query.candidates;query.candidates=null;
   for(const row of restingCandidate){
    if(!row.source||row.source.gone||!row.local)continue;
    const point=world(row.local,row.source.node),skin=.0025;
    query.movingPart=row.source;query.maxTime=1;
    const hit=options.sweepContact(add(point,{x:row.normal.x*skin,y:row.normal.y*skin,z:row.normal.z*skin}),add(point,{x:-row.normal.x*skin,y:-row.normal.y*skin,z:-row.normal.z*skin}),query);
    const target=hit?.part||parts.find(p=>p.id===hit?.partId),state=target&&states.get(target.id);
    if(!hit||!query.accept(hit)||!target||target.gone||target.active||!state?.anchored||state.reason==='overload')continue;
    valid.push({normal:hit.normal,targetVelocity:{x:0,y:0,z:0}});supports.add(target);
   }
   query.candidates=pool;
   const gravity=projectTranslation({x:0,y:-9.8*h,z:0},valid);
   if(!gravity||Math.hypot(gravity.x,gravity.y,gravity.z)>1e-9)return false;
   const memberIds=new Set(group.map(p=>p.id)),anchorIds=new Set();
   function witness(id,visiting=new Set()){
    if(memberIds.has(id)||visiting.has(id))return false;
    const state=states.get(id);if(!state?.anchored)return false;
    anchorIds.add(id);if(state.grounded)return true;
    const next=new Set(visiting);next.add(id);
    return state.supportIds.length>0&&state.supportIds.every(id=>witness(id,next));
   }
   if(![...supports].every(p=>witness(p.id)))return false;
   const record={anchorIds,members:group.map(p=>({part:p,pose:poseOf(p),scale:scaleOf(p),visibility:visibilityOf(p),direct:p.direct})),supports:[...supports].map(p=>({part:p,pose:poseOf(p),scale:scaleOf(p),visibility:visibilityOf(p)}))};
   for(const p of group){p.active=false;p.phase='resting';Object.assign(p.vel,{x:0,y:0,z:0});Object.assign(p.spin,{x:0,y:0,z:0});wallRests.set(p,record);}
   assessmentCache=null;
   const loaded=assessments(),overloaded=new Set(parts.filter(p=>!p.gone&&!p.active&&loaded.get(p.id).reason==='overload'&&(memberIds.has(p.id)||loaded.get(p.id).carriedIds.some(id=>memberIds.has(id)))).map(p=>p.id));
   if(overloaded.size){failOverloaded(overloaded);validateWallRests();return 'released';}
   return 'resting';
  }
  function projectContacts(inertia,at=origin){
   restingCandidate=null;
   const rows=manifold.filter(c=>!c.target?.gone).map(c=>{
    const lever=sub(c.point,at),arm=cross(lever,c.normal);
    return{...c,arm,lambda:0,denom:1/mass+arm.x*arm.x/inertia.x+arm.y*arm.y/inertia.y+arm.z*arm.z/inertia.z};
   });
   // Project the rigid twist against all retained unilateral contact rows.
   // Opposing walls constrain rotation through their different lever arms;
   // vertical wall normals leave downward translation completely free.
   for(let pass=0;pass<32;pass++){
    let adjustment=0;
    for(const row of rows){
     const relative=dot(velocity,row.normal)+dot(spin,row.arm)-dot(row.targetVelocity,row.normal);
     const next=Math.max(0,row.lambda-relative/row.denom),impulse=next-row.lambda;row.lambda=next;
     adjustment=Math.max(adjustment,Math.abs(impulse));
     for(const axis of ['x','y','z']){velocity[axis]+=row.normal[axis]*impulse/mass;spin[axis]+=row.arm[axis]*impulse/inertia[axis];}
    }
    if(adjustment<1e-10)break;
   }
   const pair=rows.find((a,i)=>!a.target?.active&&rows.slice(i+1).some(b=>
    !b.target?.active&&dot(a.normal,b.normal)<-.5&&Math.abs(dot(sub(a.targetVelocity,b.targetVelocity),a.normal))<1e-8));
   if(pair){
    // A finite mass bound by opposite static vertical faces can slide and
    // turn about their shared normal. Transverse turn otherwise restarts
    // the same two zero-time contacts through finite-rotation curvature.
    // Preserve angular momentum about the free axis using the inertia metric;
    // this projection dissipates constrained rotation without adding energy.
    const axis=pair.normal,along=(inertia.x*spin.x*axis.x+inertia.y*spin.y*axis.y+inertia.z*spin.z*axis.z)/
     (inertia.x*axis.x*axis.x+inertia.y*axis.y*axis.y+inertia.z*axis.z*axis.z);
    const normalVelocity=dot(pair.targetVelocity,axis)-dot(velocity,axis);
    for(const name of ['x','y','z']){spin[name]=axis[name]*along;velocity[name]+=axis[name]*normalVelocity;}
    constrainedAxis=axis;
    const axisInertia=inertia.x*axis.x*axis.x+inertia.y*axis.y*axis.y+inertia.z*axis.z*axis.z;
    const freeTurn=!rows.some(row=>!row.target?.active&&Math.abs(dot(row.normal,axis))<1-1e-8);
    if(!freeTurn)spin.x=spin.y=spin.z=0;
    for(const row of rows){row.lambda=0;row.angular=freeTurn?dot(row.arm,axis):0;row.denom=1/mass+row.angular*row.angular/axisInertia;}
    // Other walls must still constrain the surviving translation/axis turn.
    // Solve in those four free degrees instead of reintroducing blocked spin.
    const translation=!freeTurn?projectTranslation(velocity,rows):null;
    if(translation)Object.assign(velocity,translation);
    if(!freeTurn&&Math.hypot(velocity.x,velocity.y,velocity.z)<1e-9){
     const stationary=rows.filter(c=>c.target&&!c.target.gone&&!c.target.active&&Math.hypot(c.targetVelocity.x,c.targetVelocity.y,c.targetVelocity.z)<1e-9);
     const gravity=projectTranslation({x:0,y:-9.8*h,z:0},stationary);
     if(gravity&&Math.hypot(gravity.x,gravity.y,gravity.z)<1e-9)restingCandidate=stationary;
    }
    for(let pass=0;!translation&&pass<32;pass++){
     let adjustment=0;
     for(const row of rows){
      const relative=dot(velocity,row.normal)+dot(spin,row.arm)-dot(row.targetVelocity,row.normal);
      const next=Math.max(0,row.lambda-relative/row.denom),impulse=next-row.lambda;row.lambda=next;
      adjustment=Math.max(adjustment,Math.abs(impulse));
      for(const name of ['x','y','z']){velocity[name]+=row.normal[name]*impulse/mass;spin[name]+=axis[name]*row.angular*impulse/axisInertia;}
     }
     if(adjustment<1e-10)break;
    }
   }
   const angularSpeed=Math.hypot(spin.x,spin.y,spin.z);
   if(angularSpeed>.9)for(const axis of ['x','y','z'])spin[axis]*=.9/angularSpeed;
  }
  // Each hit spends motion time and kinetic work. A small fixed iteration
  // bound retains the last safe pose at crowded corners instead of tunnelling.
  for(let iteration=0;iteration<iterationLimit;iteration++){
   if(sampleBounds){query.candidates=candidates(poses);if(query.candidates?.length===0)return;}
   let earliest=null;
   sampleSearch:for(let i=0;i<group.length;i++){
    const p=group[i],pose=poses.get(p);
    for(const local of samples[i]){
    const before=world(local,pose),after=world(local,p.node);
    if(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)<1e-8)continue;
    query.movingPart=p;query.maxTime=earliest?.time??1;
    const hit=options.sweepContact(before,after,query);
    if(!hit||!hit.normal||Math.abs(hit.normal.y)>=.8||hit.part?.gone||excludeIds.has(hit.partId??hit.part?.id))continue;
    const time=hit.time??hit.t;if(!Number.isFinite(time)||time<0||time>1)continue;
    if(!earliest||time<earliest.time)earliest={...hit,time,source:p,local};
    if(time===0)break sampleSearch;
    }
   }
   if(!earliest)return tryRest()||undefined;
   const hit=earliest,elapsed=remaining*hit.time;
   const impactCenter=advance(poses,origin,elapsed),normalLength=Math.hypot(hit.normal.x,hit.normal.y,hit.normal.z);
   if(normalLength<1e-8)return;
   const normal={x:hit.normal.x/normalLength,y:hit.normal.y/normalLength,z:hit.normal.z/normalLength};
   const lever=sub(hit.point,impactCenter),target=hit.part||parts.find(p=>p.id===hit.partId);
   const targetVelocity=hit.velocity||{x:0,y:0,z:0};
   manifold.push({normal,point:hit.point,source:hit.source,local:hit.local,target,targetVelocity});
   const speed=Math.max(0,-dot(sub(add(velocity,cross(spin,lever)),targetVelocity),normal));
   const inertia={x:0,y:0,z:0};
   for(const p of group){const w=widths.get(p.id),m=weights.get(p.id),r=sub(p.node.position,impactCenter),height=ceiling(p.floor)-level.get(p.floor);
    inertia.x+=m*(r.y*r.y+r.z*r.z+(height*height+w.z*w.z)/12);
    inertia.y+=m*(r.x*r.x+r.z*r.z+(w.x*w.x+w.z*w.z)/12);
    inertia.z+=m*(r.y*r.y+r.x*r.x+(height*height+w.x*w.x)/12);
   }
   const arm=cross(lever,normal),denom=1/mass+arm.x*arm.x/inertia.x+arm.y*arm.y/inertia.y+arm.z*arm.z/inertia.z;
   const work=.5*speed*speed/denom,capacity=target?Math.max(145,(nominalLoads.get(target.id)||1)*1.6*13):Infinity;
   // Concrete on both sides has finite material reserve. Crushing the actual
   // incoming contact cell spends work first; a coherent block cannot remain
   // an indestructible ram while repeatedly paying only the target's reserve.
   const source=hit.source,sourceCapacity=Math.max(145,(nominalLoads.get(source.id)||1)*1.6*13);
   const crushing=target&&!target.gone&&work>sourceCapacity;
   const breaching=crushing&&work>sourceCapacity+capacity;
   const outgoing=breaching?Math.sqrt(Math.max(0,speed*speed-2*(sourceCapacity+capacity)*denom)):0;
   const impulse=(speed-outgoing)/denom;
   for(const axis of ['x','y','z']){velocity[axis]+=normal[axis]*impulse/mass;spin[axis]+=arm[axis]*impulse/inertia[axis];}
   const angularSpeed=Math.hypot(spin.x,spin.y,spin.z);
   if(angularSpeed>.9)for(const axis of ['x','y','z'])spin[axis]*=.9/angularSpeed;
   if(constrainedAxis&&!crushing&&!breaching)projectContacts(inertia,impactCenter);
   // The bounded turn can remove some of the separating point velocity. Keep
   // the surviving wall unilateral even after applying that angular limit.
   if(!breaching){
    const inward=Math.min(0,dot(sub(add(velocity,cross(spin,lever)),targetVelocity),normal));
    for(const axis of ['x','y','z'])velocity[axis]-=normal[axis]*inward;
    separate(normal,impactCenter);
   }
   for(const p of group){Object.assign(p.spin,spin);Object.assign(p.vel,add(velocity,cross(spin,sub(p.node.position,impactCenter))));}
   // Apply the energy-spending impulse before fragment release so a newly
   // broken source inherits its reduced motion and exact contact pose.
   if(crushing)options.fracture?.(source,{cause:'side-crush',energy:speed,work,spentWork:sourceCapacity,point:{...hit.point},normal:{...normal},sourceId:source.id,targetId:target.id});
   if(breaching)options.fracture?.(target,{cause:'side-impact',energy:speed,work:work-sourceCapacity,spentWork:capacity,point:{...hit.point},normal:{...normal},sourceId:source.id});
   if(source.gone||target?.gone){changed=true;assessmentCache=null;}
   if(breaching&&!target?.gone){
    const inward=Math.min(0,dot(sub(add(velocity,cross(spin,lever)),targetVelocity),normal));
    for(const axis of ['x','y','z'])velocity[axis]-=normal[axis]*inward;
    for(const p of group)if(!p.gone){for(const axis of ['x','y','z'])p.node.position[axis]+=normal[axis]*.002;Object.assign(p.vel,add(velocity,cross(spin,sub(p.node.position,impactCenter))));}
   }
   // Rebuild the surviving islands and their true mass on the next substep.
   // Never advance a gone proxy after its fragments captured the release pose.
   if(source.gone)return true;
   // Spend the remaining time on the post-impact trajectory, including its
   // tangential fall. Returning at a zero-time wall block would freeze the
   // pose indefinitely while gravity continued accumulating in its velocity.
   remaining-=elapsed;origin=impactCenter;poses=save();
   if(remaining<1e-8)return;
   if(iteration===iterationLimit-1){
    // Repeated opposite zero-time contacts can undo each other's positional
    // slop and impulses. Resolve their shared velocity constraints, then spend
    // the unconsumed time through CCD again. Ordinary contacts keep the same
    // four-query budget and exact v4 path.
    const opposed=manifold.some((a,i)=>manifold.slice(i+1).some(b=>dot(a.normal,b.normal)<-.5));
    // CCD-safe correction leaves nanometre clearance, so the next blocking
    // TOI may be tiny positive rather than exactly zero. Spending <=0.01% of
    // the substep still discards effectively all motion unless resolved here.
    if(!constrained&&h-remaining>h*1e-4||!opposed||iterationLimit>=12)return;
    constrained=true;for(const p of group)wallJams.add(p);
    projectContacts(inertia);iterationLimit+=4;
   }
   advance(poses,origin,remaining);
  }
 }
 function poseOf(p){const v=p.node.position,q=p.node.quaternion;return{position:{x:v.x,y:v.y,z:v.z},quaternion:{x:q.x,y:q.y,z:q.z,w:q.w}};}
 function scaleOf(p){const s=p.node.scale;return{x:s?.x??1,y:s?.y??1,z:s?.z??1};}
 function visibilityOf(p){const values=[];if(p.node.traverse)p.node.traverse(n=>values.push(n.visible!==false?'1':'0'));else values.push(p.node.visible!==false?'1':'0');return values.join('');}
 function samePose(p,saved){const v=p.node.position,q=p.node.quaternion,s=scaleOf(p);return v.x===saved.pose.position.x&&v.y===saved.pose.position.y&&v.z===saved.pose.position.z&&q.x===saved.pose.quaternion.x&&q.y===saved.pose.quaternion.y&&q.z===saved.pose.quaternion.z&&q.w===saved.pose.quaternion.w&&s.x===saved.scale.x&&s.y===saved.scale.y&&s.z===saved.scale.z;}
 function validateWallRests(){
  let woke;
  do{woke=false;for(const record of new Set(wallRests.values())){
   let valid=record.members.every(s=>!s.part.gone&&!s.part.active&&s.part.phase==='resting'&&samePose(s.part,s)&&visibilityOf(s.part)===s.visibility&&s.part.direct===s.direct&&Math.hypot(s.part.vel.x,s.part.vel.y,s.part.vel.z,s.part.spin.x,s.part.spin.y,s.part.spin.z)===0)&&record.supports.every(s=>!s.part.gone&&!s.part.active&&samePose(s.part,s)&&visibilityOf(s.part)===s.visibility&&Math.hypot(s.part.vel.x,s.part.vel.y,s.part.vel.z,s.part.spin.x,s.part.spin.y,s.part.spin.z)===0);
   if(valid){const states=assessments();valid=record.supports.every(s=>states.get(s.part.id)?.anchored&&states.get(s.part.id)?.reason!=='overload');}
   if(valid)continue;
   for(const s of record.members){wallRests.delete(s.part);if(!s.part.gone){s.part.active=true;s.part.phase='falling';options.activate?.(s.part);}}
   assessmentCache=null;settledSignature=null;woke=true;
  }}while(woke&&wallRests.size);
 }
 function step(dt){
  if(!Number.isFinite(dt)||dt<=0)return false;
  validateWallRests();
  const movingInitially=parts.some(p=>p.active&&!p.gone);
  if(!movingInitially&&structuralSignature()===settledSignature)return false;
  changed=false;const n=Math.ceil(Math.min(dt,.1)/(1/120)),h=Math.min(dt,.1)/n;
  for(let k=0;k<n;k++){
   if(k)validateWallRests();
   releaseUnsupported();
   failOverloaded();
   validateWallRests();
   const moving=parts.filter(p=>p.active&&!p.gone);
   const groups=components(moving,(a,b)=>(a.floor===b.floor&&adjacent(a,b)||vertical(a,b))&&!seams.has(key(a,b)));
   for(const raw of groups){
    const group=raw.filter(p=>!p.gone);if(!group.length)continue;
    const members=new Set(group),center={x:0,y:0,z:0},velocity={x:0,y:0,z:0},spin={x:0,y:0,z:0};
    for(const p of group)for(const a of ['x','y','z']){center[a]+=p.node.position[a]/group.length;velocity[a]+=(p.vel[a]||0)/group.length;spin[a]+=(p.spin[a]||0)/group.length;}
    velocity.y-=9.8*h;
    connectionReaction(group,center,velocity,spin,h);
    const angularSpeed=Math.hypot(spin.x,spin.y,spin.z);if(angularSpeed>.9)for(const a of ['x','y','z'])spin[a]*=.9/angularSpeed;
    const rotation=turn(spin,h),old=new Map(),oldPoses=new Map();
    for(const p of group){
     old.set(p,contactCorners(p));
     if(options.sweepContact&&options.contactSamples)oldPoses.set(p,poseOf(p));
     const offset=rotate(sub(p.node.position,center),rotation);
     Object.assign(p.node.position,add(add(center,offset),{x:velocity.x*h,y:velocity.y*h,z:velocity.z*h}));
     const quaternion=mul(rotation,p.node.quaternion),norm=Math.hypot(quaternion.x,quaternion.y,quaternion.z,quaternion.w);
     for(const a of ['x','y','z','w'])p.node.quaternion[a]=quaternion[a]/norm;
     Object.assign(p.vel,add(velocity,cross(spin,offset)));Object.assign(p.spin,spin);p.age=(p.age||0)+h;changed=true;
    }
    const wallResult=wallContacts(group,center,velocity,spin,h,oldPoses);
    if(wallResult==='resting')continue;
    if(wallResult){
     for(let i=group.length-1;i>=0;i--)if(group[i].gone)group.splice(i,1);
     if(!group.length)continue;
     for(const axis of ['x','y','z']){center[axis]=group.reduce((sum,p)=>sum+p.node.position[axis],0)/group.length;velocity[axis]=group.reduce((sum,p)=>sum+p.vel[axis],0)/group.length;spin[axis]=group.reduce((sum,p)=>sum+p.spin[axis],0)/group.length;}
    }
    const contacts=[],surfaces=parts.filter(q=>!q.gone&&!members.has(q)).map(q=>({q,s:snapshot(q)}));
    for(const p of group){
     // Ground remains a persistent constraint even after a different member
     // has fractured or a rotating top face has become the lowest face. Cell
     // ownership and original floor ordering cannot exclude terrain contact.
     for(const point of [...corners(p,level.get(p.floor)),...corners(p,ceiling(p.floor))]){
      const ground=options.groundAt?.(point.x,point.z)??.24;
      if(point.y<=ground+.001)contacts.push({p,support:null,surface:ground,point:{x:point.x,y:ground,z:point.z},depth:ground-point.y,surfaceVelocity:{x:0,y:0,z:0}});
     }
     if(group.some(q=>q.floor<p.floor&&q.cell===p.cell))continue;
     const before=old.get(p),after=contactCorners(p);
     for(let i=0;i<after.length;i++){
      const point=after[i];let surface=options.groundAt?.(point.x,point.z)??.24,support=null,surfaceVelocity={x:0,y:0,z:0};
      for(const {q,s} of surfaces){if(q.floor>=p.floor)continue;
       // Overlapping imported AABBs cannot transfer a falling column's load
       // sideways on a corner alone. Its centre must cross the boundary to the
       // neighbouring column (the midpoint of their original centres).
       if(!ownsLoad(q,p.node.position,p.cell))continue;
       if(!s.contains(point.x,point.z,.02,.02))continue;
       const y=s.surfaceAt(point.x,point.z);
       if(y>surface&&y<=before[i].y+.12){surface=y;support=q;surfaceVelocity=s.velocityAt(point.x,point.z);}
      }
      if(point.y<=surface+.001&&before[i].y>=surface-.12)contacts.push({p,support,surface,point:{x:point.x,y:surface,z:point.z},depth:surface-point.y,surfaceVelocity});
     }
    }
    if(!contacts.length)continue;
    const correction=Math.max(0,...contacts.map(c=>c.depth));
    for(const p of group)p.node.position.y+=correction;
    const touching=contacts.filter(c=>c.depth>=correction-.035),handled=new Set();
    const balanced=bearsCenter(touching.map(c=>c.point),center);
    const mass=group.reduce((sum,p)=>sum+weights.get(p.id),0),cellCount=new Set(group.map(p=>p.cell)).size;
    const inertia={x:0,z:0};
    for(const p of group){const w=widths.get(p.id),m=weights.get(p.id),r=sub(p.node.position,center),height=ceiling(p.floor)-level.get(p.floor);
     inertia.x+=m*(r.y*r.y+r.z*r.z+(height*height+w.z*w.z)/12);inertia.z+=m*(r.y*r.y+r.x*r.x+(height*height+w.x*w.x)/12);
    }
    for(const c of touching){
     if(handled.has(c.p)||c.p.gone)continue;handled.add(c.p);
     const contactVelocity=add(c.p.vel,cross(c.p.spin,sub(c.point,c.p.node.position)));
     const speed=Math.max(0,c.surfaceVelocity.y-contactVelocity.y);
     if(c.support?.overloaded&&speed<1.5){breakAt(c.support,2.2,c.point);continue;}
     if(speed<1.5){
      if(!balanced){
       // A real unilateral normal impulse holds the bearing point, while its
       // lever arm turns the whole connected mass. This removes contact speed
       // rather than accumulating a fictitious free-fall speed at the hinge.
       const r=sub(c.point,center),denom=1/mass+r.z*r.z/inertia.x+r.x*r.x/inertia.z;
       const impulse=speed/Math.max(.001,denom);
       velocity.y+=impulse/mass;spin.x-=r.z*impulse/inertia.x;spin.z+=r.x*impulse/inertia.z;
       for(const p of group){Object.assign(p.spin,spin);Object.assign(p.vel,add(velocity,cross(spin,sub(p.node.position,center))));}
       continue;
      }
      // Low-energy contact rests; moving bearings carry their true point velocity.
      for(const p of group){p.vel.y=c.surfaceVelocity.y;if(!c.support?.active){p.active=false;p.phase='resting';Object.assign(p.spin,{x:0,y:0,z:0});p.vel.x=p.vel.z=0;}}
      continue;
     }
     // Crushing the incoming member absorbs a normal single-storey fall.
     // Only a major impact can also punch through its intact supporting slab.
     breakAt(c.p,speed,c.point);
     const incidentMass=mass/Math.max(1,cellCount),work=.5*incidentMass*speed*speed;
     const crushCapacity=c.support?Math.max(145,nominalLoads.get(c.support.id)*1.6*13):Infinity;
     if(c.support&&!c.support.gone&&work>crushCapacity){c.support.vel.y=velocity.y*.5;breakAt(c.support,speed,c.point);}
     // Compression opens seams around the impacted column. Remaining columns
     // retain momentum, with the off-centre contact producing differing turns.
     for(const p of group)if(!p.gone){
      if(p.cell!==c.p.cell)continue;
      // Compression expends kinetic energy in this column. Keep descending
      // momentum, but do not let successive floors hit with an undamped fall.
      p.vel.y=Math.max(p.vel.y,velocity.y*.65);
      for(const q of group)if(q.cell!==p.cell)seams.add(key(p,q));
      const lever=sub(c.point,p.node.position),impulse=Math.min(.45,speed*.045);
      p.spin.x-=lever.z*impulse*.6;p.spin.z+=lever.x*impulse*.6;
     }
    }
   }
  }
  settledSignature=changed||parts.some(p=>p.active&&!p.gone)?null:structuralSignature();
  return changed;
 }
 function reset(){changed=false;seams.clear();failures.clear();wallJams.clear();wallRests.clear();assessmentCache=null;assessmentKey='';settledSignature=null;for(const p of parts){p.overloaded=false;p.fallBias=null;p.releaseConnections=[];p.coupledBearing=false;Object.assign(p.spin,{x:0,y:0,z:0});}}
 function supports(){return parts.filter(p=>!p.gone).map(snapshot);}
 return{step,reset,supports,bottom,top,diagnostics,assessPart};
}
return{create};
});
