/* Bounded contact-driven structural motion, not an engineering solver. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SkyfallCollapse=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const identity=()=>({x:0,y:0,z:0,w:1});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
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
 const below=new Map(parts.map(p=>[p.id,parts.filter(q=>q.floor===p.floor-1&&q.cell===p.cell&&adjacent(p,q))]));
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
 // Game-scale slab capacity: a short gap can span at most one typical storey
 // height. The tall roof AABB must not grant an extra-long invisible beam.
 const maxBridgeSpan=storeys[Math.floor(storeys.length/2)]||3.3;
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
 const directlyBorne=(p,surfaces)=>onGround(p)||bearingContacts(p,surfaces).length>0;
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
 const failures=new Map();let assessmentCache=null,assessmentKey='';
 const stillConnected=(a,b)=>adjacent(a,b)&&Math.hypot(a.node.position.x-a.rest.x-b.node.position.x+b.rest.x,a.node.position.z-a.rest.z-b.node.position.z+b.rest.z)<=.2&&Math.abs(basePoint(a).y-basePoint(b).y)<=.12;
 function assessments(){
  const signature=parts.map(p=>p.gone?'g':p.active?'a':[p.node.position.x,p.node.position.y,p.node.position.z,p.node.quaternion.x,p.node.quaternion.y,p.node.quaternion.z,p.node.quaternion.w].join(',')).join('|');
  if(assessmentCache&&signature===assessmentKey)return assessmentCache;
  const surfaces=new Map(),states=new Map(parts.map(p=>[p.id,{id:p.id,floor:p.floor,cell:p.cell,state:p.gone?'gone':p.active?'falling':'standing',anchored:false,grounded:!p.gone&&!p.active&&onGround(p),load:0,capacity:0,utilization:0,supportIds:[],carriedIds:[],centerOfLoad:{...p.node.position},unbracedHeight:0,weakWidth:Math.min(widths.get(p.id).x,widths.get(p.id).z),reason:p.gone?'gone':p.active?'falling':'unsupported',criticalReason:null,failure:failures.get(p.id)||null}]));
  for(const row of rows)for(const group of components(row.filter(p=>!p.gone&&!p.active),stillConnected)){
   const support=supportState(group,surfaces);
   for(const p of support.bearing){const s=states.get(p.id);s.supportIds=bearingContacts(p,surfaces).map(q=>q.id);s.reason='bearing';}
   for(const bridge of support.bridgeSpans){const s=states.get(bridge.id);s.supportIds=bridge.anchors.slice();s.reason='bridged';}
  }
  function anchored(s,visiting=new Set()){
   if(s.grounded)return true;if(!s.supportIds.length||visiting.has(s.id))return false;
   const next=new Set(visiting);next.add(s.id);return s.supportIds.every(id=>anchored(states.get(id),next));
  }
  for(const s of states.values())s.anchored=anchored(s);
  const braced=new Set();
  for(const row of rows)for(const group of components(row.filter(p=>states.get(p.id).anchored),stillConnected)){
   // A line of surviving columns cannot restrain sway perpendicular to itself.
   // Require a connected floor footprint with a substantial second dimension.
   let area=0;for(const a of group)for(const b of group)for(const c of group)area=Math.max(area,Math.abs((b.node.position.x-a.node.position.x)*(c.node.position.z-a.node.position.z)-(b.node.position.z-a.node.position.z)*(c.node.position.x-a.node.position.x)));
   for(const p of group){const w=widths.get(p.id);if(group.length>=3&&area>w.x*w.z*.35)braced.add(p.id);}
  }
  const order=parts.filter(p=>!p.gone&&!p.active).sort((a,b)=>b.floor-a.floor||(states.get(a.id).reason==='bridged'?-1:0)-(states.get(b.id).reason==='bridged'?-1:0));
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
 function failOverloaded(){
  // Only the lowest overloaded bearing on a load path fails this substep.
  // Upper members then descend through the existing contact/gravity solver.
  const states=assessments(),overloaded=parts.filter(p=>!p.gone&&!p.active&&states.get(p.id).reason==='overload');
  const lowest=overloaded.filter(p=>!overloaded.some(q=>q.floor<p.floor&&states.get(q.id).carriedIds.includes(p.id)));
  for(const p of lowest){const s=states.get(p.id);failures.set(p.id,{reason:s.criticalReason,load:s.load,capacity:s.capacity,unbracedHeight:s.unbracedHeight,weakWidth:s.weakWidth});
   options.fracture?.(p,{cause:'overload',energy:Math.max(2,s.utilization*2),point:basePoint(p)});changed=true;
  }
  if(lowest.length)assessmentCache=null;
 }
 function releaseUnsupported(){
  const surfaces=new Map();
  for(const row of rows)for(const live of components(row.filter(p=>!p.gone&&!p.active),adjacent)){
   const {bearing,unsupported}=supportState(live,surfaces);
   if(!unsupported.length)continue;
   const average=(items,axis)=>items.reduce((sum,p)=>sum+p.node.position[axis],0)/items.length;
   for(const island of components(unsupported,adjacent)){
    let bias={x:0,z:0};
    if(bearing.length)bias={x:average(island,'x')-average(bearing,'x'),z:average(island,'z')-average(bearing,'z')};
    else{
     const lower=island.flatMap(p=>below.get(p.id)).filter(q=>q.active&&!q.gone&&q.fallBias);
     if(lower.length)bias={x:lower.reduce((sum,q)=>sum+q.fallBias.x,0)/lower.length,z:lower.reduce((sum,q)=>sum+q.fallBias.z,0)/lower.length};
    }
    const length=Math.hypot(bias.x,bias.z);if(length>1){bias.x/=length;bias.z/=length;}
    for(const p of island){
     options.activate?.(p);p.active=true;p.fallBias={...bias};
     p.spin.x+=bias.z*.04;p.spin.z-=bias.x*.04;
     p.vel.x+=bias.x*.08;p.vel.z+=bias.z*.08;changed=true;
    }
   }
  }
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
 function step(dt){
  if(!Number.isFinite(dt)||dt<=0)return false;
  changed=false;const n=Math.ceil(Math.min(dt,.1)/(1/120)),h=Math.min(dt,.1)/n;
  for(let k=0;k<n;k++){
   releaseUnsupported();
   failOverloaded();
   const moving=parts.filter(p=>p.active&&!p.gone);
   const groups=components(moving,(a,b)=>(a.floor===b.floor&&adjacent(a,b)||vertical(a,b))&&!seams.has(key(a,b)));
   for(const raw of groups){
    const group=raw.filter(p=>!p.gone);if(!group.length)continue;
    const members=new Set(group),center={x:0,y:0,z:0},velocity={x:0,y:0,z:0},spin={x:0,y:0,z:0};
    for(const p of group)for(const a of ['x','y','z']){center[a]+=p.node.position[a]/group.length;velocity[a]+=(p.vel[a]||0)/group.length;spin[a]+=(p.spin[a]||0)/group.length;}
    velocity.y-=9.8*h;
    const angularSpeed=Math.hypot(spin.x,spin.y,spin.z);if(angularSpeed>.9)for(const a of ['x','y','z'])spin[a]*=.9/angularSpeed;
    const rotation=turn(spin,h),old=new Map();
    for(const p of group){
     old.set(p,corners(p,level.get(p.floor)));
     const offset=rotate(sub(p.node.position,center),rotation);
     Object.assign(p.node.position,add(add(center,offset),{x:velocity.x*h,y:velocity.y*h,z:velocity.z*h}));
     const quaternion=mul(rotation,p.node.quaternion),norm=Math.hypot(quaternion.x,quaternion.y,quaternion.z,quaternion.w);
     for(const a of ['x','y','z','w'])p.node.quaternion[a]=quaternion[a]/norm;
     Object.assign(p.vel,add(velocity,cross(spin,offset)));Object.assign(p.spin,spin);p.age=(p.age||0)+h;changed=true;
    }
    const contacts=[],surfaces=parts.filter(q=>!q.gone&&!members.has(q)).map(q=>({q,s:snapshot(q)}));
    for(const p of group){
     if(group.some(q=>q.floor<p.floor&&q.cell===p.cell))continue;
     const before=old.get(p),after=corners(p,level.get(p.floor));
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
    for(const c of touching){
     if(handled.has(c.p)||c.p.gone)continue;handled.add(c.p);
     const contactVelocity=add(c.p.vel,cross(c.p.spin,sub(c.point,c.p.node.position)));
     const speed=Math.max(0,c.surfaceVelocity.y-contactVelocity.y);
     if(c.support?.overloaded&&speed<1.5){breakAt(c.support,2.2,c.point);continue;}
     if(speed<1.5){
      if(!balanced){
       // A single touching edge does not suspend the rest of an upper mass.
       // Gravity about that edge adds tipping torque while descent continues.
       for(const p of group){p.spin.x+=(center.z-c.point.z)*h*.5;p.spin.z-=(center.x-c.point.x)*h*.5;}
       continue;
      }
      // Low-energy contact rests; moving bearings carry their true point velocity.
      for(const p of group){p.vel.y=c.surfaceVelocity.y;if(!c.support?.active){p.active=false;p.phase='resting';Object.assign(p.spin,{x:0,y:0,z:0});p.vel.x=p.vel.z=0;}}
      continue;
     }
     // Crushing the incoming member absorbs a normal single-storey fall.
     // Only a major impact can also punch through its intact supporting slab.
     breakAt(c.p,speed,c.point);
     if(c.support&&!c.support.gone&&speed>=18){c.support.vel.y=velocity.y*.5;breakAt(c.support,speed,c.point);}
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
  return changed;
 }
 function reset(){changed=false;seams.clear();failures.clear();assessmentCache=null;assessmentKey='';for(const p of parts){p.overloaded=false;p.fallBias=null;Object.assign(p.spin,{x:0,y:0,z:0});}}
 function supports(){return parts.filter(p=>!p.gone).map(snapshot);}
 return{step,reset,supports,bottom,top,diagnostics,assessPart};
}
return{create};
});
