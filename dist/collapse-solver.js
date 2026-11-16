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
 const adjacent=(a,b)=>Math.abs(a.center.x-b.center.x)<=a.halfExtents.x+b.halfExtents.x+.1&&Math.abs(a.center.z-b.center.z)<=a.halfExtents.z+b.halfExtents.z+.1;
 const vertical=(a,b)=>Math.abs(a.floor-b.floor)===1&&a.cell===b.cell&&adjacent(a,b);
 const key=(a,b)=>a.id<b.id?`${a.id}:${b.id}`:`${b.id}:${a.id}`;
 const seams=new Set();
 function components(list,neighbor){const remaining=new Set(list),out=[];while(remaining.size){const group=[remaining.values().next().value];remaining.delete(group[0]);for(let i=0;i<group.length;i++)for(const p of remaining)if(neighbor(group[i],p)){group.push(p);remaining.delete(p);}out.push(group);}return out;}
 const rows=floors.flatMap(f=>components(parts.filter(p=>p.floor===f),adjacent));
 const below=new Map(parts.map(p=>[p.id,parts.filter(q=>q.floor===p.floor-1&&q.cell===p.cell&&adjacent(p,q))]));
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
 function releaseUnsupported(){
  for(const row of rows)for(const live of components(row.filter(p=>!p.gone&&!p.active&&!(p.phase==='resting'&&bottom(p)<=(options.groundAt?.(p.node.position.x,p.node.position.z)??.24)+.12)),adjacent)){
   const bearing=live.filter(p=>!below.get(p.id).length||below.get(p.id).some(q=>!q.gone&&!q.active));
   if(bearing.length/live.length>=.6)continue;
   const average=(items,axis)=>items.reduce((s,p)=>s+p.node.position[axis],0)/items.length;
   let bias={x:0,z:0};
   if(bearing.length){
    bias={x:average(live,'x')-average(bearing,'x'),z:average(live,'z')-average(bearing,'z')};
    for(const p of bearing)for(const q of below.get(p.id))if(!q.gone&&!q.active)q.overloaded=true;
   }else{
    const lower=live.flatMap(p=>below.get(p.id)).filter(q=>q.active&&!q.gone&&q.fallBias);
    if(lower.length)bias={x:lower.reduce((s,q)=>s+q.fallBias.x,0)/lower.length,z:lower.reduce((s,q)=>s+q.fallBias.z,0)/lower.length};
   }
   const length=Math.hypot(bias.x,bias.z);if(length>4){bias.x*=4/length;bias.z*=4/length;}
   for(const p of live){
    options.activate?.(p);p.active=true;p.fallBias={...bias};
    // Eccentric load at the last bearings supplies a buckling impulse. A
    // symmetric removal has zero torque; gravity supplies all later descent.
    p.spin.x+=bias.z*.16;p.spin.z-=bias.x*.16;
    p.vel.x+=bias.x*.22;p.vel.z+=bias.z*.22;changed=true;
   }
  }
 }
 function breakAt(p,speed,point){if(p.gone)return;options.fracture?.(p,{cause:'compression',energy:Math.max(1,speed),point});changed=true;}
 function step(dt){
  if(!Number.isFinite(dt)||dt<=0)return false;
  changed=false;const n=Math.ceil(Math.min(dt,.1)/(1/120)),h=Math.min(dt,.1)/n;
  for(let k=0;k<n;k++){
   releaseUnsupported();
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
       // Source sectors overlap neighbouring cells substantially. Require a
       // real relative translation before a different original cell can bear.
       const drift=Math.hypot(p.node.position.x-p.rest.x-q.node.position.x+q.rest.x,p.node.position.z-p.rest.z-q.node.position.z+q.rest.z);
       if(q.cell!==p.cell&&drift<Math.min(p.halfExtents.x+q.halfExtents.x,p.halfExtents.z+q.halfExtents.z)*.35)continue;
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
     breakAt(c.p,speed,c.point);
     if(c.support&&!c.support.gone&&speed>=2.2){c.support.vel.y=velocity.y*.5;breakAt(c.support,speed,c.point);}
     // Compression opens seams around the impacted column. Remaining columns
     // retain momentum, with the off-centre contact producing differing turns.
     for(const p of group)if(!p.gone){
      p.vel.y=Math.min(p.vel.y,velocity.y*.92);
      if(p.cell!==c.p.cell)continue;
      for(const q of group)if(q.cell!==p.cell)seams.add(key(p,q));
      const lever=sub(c.point,p.node.position),impulse=Math.min(.45,speed*.045);
      p.spin.x-=lever.z*impulse*.6;p.spin.z+=lever.x*impulse*.6;
     }
    }
   }
  }
  return changed;
 }
 function reset(){changed=false;seams.clear();for(const p of parts){p.overloaded=false;p.fallBias=null;Object.assign(p.spin,{x:0,y:0,z:0});}}
 function supports(){return parts.filter(p=>!p.gone).map(snapshot);}
 return{step,reset,supports,bottom,top};
}
return{create};
});
