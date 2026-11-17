/* Actual PC fracture meshes, two fixed surface batches. Swept structural mesh
   contacts and floor/terrain motion use bounded mobile approximations. */
(function () {
  'use strict';
  const T = window.THREE;
  const GROUND = .24, GRAVITY = 9.8, CELL = 1.6, GRID = 100, ORIGIN = GRID * CELL * .5;
  const clamp = T.MathUtils.clamp;
  const validVector = v => v && Number.isFinite(v.x + v.y + v.z);
  const noise = (id, salt) => {
    const n = Math.sin((id + 1) * 127.1 + salt * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const vertexDeclarations = `
attribute float pieceId;
uniform sampler2D uFragmentTransforms;
uniform vec2 uFragmentTextureSize;
vec4 fragmentPose(float index) {
  vec2 pixel = vec2(mod(index, uFragmentTextureSize.x), floor(index / uFragmentTextureSize.x));
  return texture2D(uFragmentTransforms, (pixel + .5) / uFragmentTextureSize);
}
vec3 fragmentRotate(vec3 p, vec4 q) {
  return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p);
}
`;

  function create(scene) {
    const states = [], byPart = new Map(), batches = [];
    // Ground sleepers keep their geometry and heightfield deposit, but have
    // no per-frame work. Support sleepers must still follow/wake with floors.
    const moving = new Set(), restingOnSupport = new Set();
    const pile = new Float32Array(GRID * GRID), supportMap = new Map();
    const tempPosition = new T.Vector3(), tempScale = new T.Vector3();
    const tempQuaternion = new T.Quaternion(), deltaQuaternion = new T.Quaternion();
    const direction = new T.Vector3(), radial = new T.Vector3(), tangent = new T.Vector3();
    const normal = new T.Vector3(), surfaceVelocity = new T.Vector3(), relative = new T.Vector3();
    const contactStart = new T.Vector3(), contactEnd = new T.Vector3();
    let collider = null, onContact = null;
    const acceptContactNormal = (normal, part) => !(normal.y>.8&&supportMap.has(part.id));
    let prepared = false, texture = null, transformData = null, depthMaterial = null;
    let dirty = false, triangles = 0, profile = { shadows: true, targetFps: 30 };
    let activeCount = 0, movingCount = 0, settledCount = 0, carriedCount = 0, uploads = 0;
    let relevantMovingCount = 0, simulated = 0, supportChecks = 0;

    function inject(material) {
      material.onBeforeCompile = shader => {
        shader.uniforms.uFragmentTransforms = { value: texture };
        shader.uniforms.uFragmentTextureSize = { value: new T.Vector2(texture.image.width, texture.image.height) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + vertexDeclarations)
          .replace('void main() {', `void main() {
            vec4 sfTranslation = fragmentPose(pieceId * 2.0);
            vec4 sfRotation = fragmentPose(pieceId * 2.0 + 1.0);`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal = fragmentRotate(objectNormal, sfRotation);
            #ifdef USE_TANGENT
              objectTangent = fragmentRotate(objectTangent, sfRotation);
            #endif`)
          .replace('#include <begin_vertex>', 'vec3 transformed = fragmentRotate(position, sfRotation) + sfTranslation.xyz;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            if (sfTranslation.w < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
      };
      material.customProgramCacheKey = () => 'skyfall-pc-fragments-v1';
    }

    function writePose(s) {
      if (s.active && !s.settled) setRelevant(s, !quietGroundContact(s));
      const i = s.id * 8, p = s.position, q = s.quaternion;
      transformData[i] = p.x; transformData[i + 1] = p.y; transformData[i + 2] = p.z;
      transformData[i + 3] = s.active ? 1 : 0;
      transformData[i + 4] = q.x; transformData[i + 5] = q.y;
      transformData[i + 6] = q.z; transformData[i + 7] = q.w;
      dirty = true;
    }

    function prepare(parts, descriptor, arrayBuffer) {
      // Preparing is a load-time operation. Shots and resets never allocate GPU resources.
      if (prepared) throw new Error('Structural fragment resources have already been prepared');
      if (!descriptor || descriptor.version !== 1 || !descriptor.pieces?.length) throw new Error('Invalid structural fragment descriptor');
      const partMap = new Map(parts.map(part => [String(part.id), part]));
      const rest = new Map(), sourceMaterials = {};
      for (const part of parts) {
        part.node.updateWorldMatrix(true, false);
        part.node.matrixWorld.decompose(tempPosition, tempQuaternion, tempScale);
        rest.set(String(part.id), { inverse: part.node.matrixWorld.clone().invert(), quaternion: tempQuaternion.clone().invert() });
        part.node.traverse(node => {
          if (!node.isMesh) return;
          for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
            if (!material) continue;
            const kind = /glass/i.test(node.name + ' ' + material.name) ? 'glass' : 'structure';
            if (!sourceMaterials[kind]) sourceMaterials[kind] = material;
          }
        });
      }
      for (let index = 0; index < descriptor.pieces.length; index++) {
        const data = descriptor.pieces[index], part = partMap.get(String(data.partId));
        if (data.id !== index || !part) throw new Error('Structural fragment part/index mismatch: ' + data.id);
        const partRest = rest.get(String(data.partId));
        const s = {
          id: index, partId: part.id, part, kind: data.kind,
          restCenter: new T.Vector3(...data.center), localCenter: new T.Vector3(...data.center).applyMatrix4(partRest.inverse),
          inverseRestQuaternion: partRest.quaternion, half: new T.Vector3(...data.half),
          position: new T.Vector3(...data.center), quaternion: new T.Quaternion(),
          velocity: new T.Vector3(), angular: new T.Vector3(), extent: new T.Vector3(...data.half),
          // Approximate solid mass, not the full (mostly empty) cut-mesh AABB.
          // Capped broad slabs and cubic scaling keep chips from acting like
          // whole structural members in the support damage accumulator.
          mass: Math.min(900, 8 * data.half[0] * data.half[1] * data.half[2] * .12 * (data.kind === 'glass' ? 2500 : 1800)),
          active: false, settled: false, supportId: null, supportTop: GROUND, contacts: 0, angularTime: 0,
          grounded: false, stableTime: 0, deposited: false, relevant: false, surfaceVelocity: new T.Vector3(),
          wallContacts: new Set(), damageEnergy: 0,
        };
        states.push(s);
        const key = String(part.id);
        if (!byPart.has(key)) byPart.set(key, []);
        byPart.get(key).push(s);
      }
      const width = Math.min(1024, Math.max(2, T.MathUtils.ceilPowerOfTwo(states.length * 2)));
      const height = Math.ceil(states.length * 2 / width);
      transformData = new Float32Array(width * height * 4);
      texture = new T.DataTexture(transformData, width, height, T.RGBAFormat, T.FloatType);
      texture.minFilter = texture.magFilter = T.NearestFilter;
      texture.generateMipmaps = false; texture.flipY = false;
      depthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
      inject(depthMaterial);
      const attributeSpec = { position: [3, Float32Array], normal: [3, Float32Array], uv: [2, Float32Array], color: [3, Uint8Array], pieceId: [1, Float32Array] };
      for (const range of descriptor.materialRanges) {
        if (!range.count) continue;
        if (batches.length >= 2) throw new Error('Structural fragments require at most two material batches');
        const geometry = new T.BufferGeometry();
        for (const [name, [size, ArrayType]] of Object.entries(attributeSpec)) {
          const block = descriptor.buffers[name];
          const values = new ArrayType(arrayBuffer, block.offset + range.start * size * ArrayType.BYTES_PER_ELEMENT, range.count * size);
          geometry.setAttribute(name, new T.BufferAttribute(values, size, name === 'color'));
        }
        const source = sourceMaterials[range.kind];
        const material = source ? source.clone() : new T.MeshStandardMaterial({ color: range.kind === 'glass' ? 0x9bb9be : 0xb1aca2, roughness: .75 });
        material.name = 'PCFracture_' + range.kind;
        // Detailed-building raycast proxies use invisible materials. Debris
        // must still render when cloned from one of those source materials.
        material.visible = true;
        material.vertexColors = true;
        material.side = T.DoubleSide;
        if (range.kind === 'glass') {
          material.opacity = Math.max(.68, material.opacity); material.transparent = true;
          material.forceSinglePass = true;
          material.depthWrite = false; material.roughness = .16; material.metalness = .35;
          material.envMapIntensity = 1.4;
        }
        inject(material);
        const mesh = new T.Mesh(geometry, material);
        mesh.name = 'ActualPCFragments_' + range.kind;
        mesh.frustumCulled = false; mesh.visible = false;
        mesh.castShadow = range.kind === 'structure' && profile.shadows;
        mesh.receiveShadow = range.kind === 'structure';
        mesh.customDepthMaterial = depthMaterial;
        mesh.userData.fragmentKind = range.kind;
        scene.add(mesh); batches.push(mesh);
      }
      triangles = descriptor.triangleCount;
      prepared = true;
      reset();
      render();
      return stats();
    }

    function release(part, options = {}) {
      if (!prepared) return 0;
      const group = byPart.get(String(part.id));
      if (!group) return 0;
      part.node.updateWorldMatrix(true, false);
      part.node.matrixWorld.decompose(tempPosition, tempQuaternion, tempScale);
      deltaQuaternion.copy(tempQuaternion).multiply(group[0].inverseRestQuaternion).normalize();
      direction.copy(validVector(options.direction) ? options.direction : { x: 0, y: 0, z: -1 }).normalize();
      const inherited = validVector(options.velocity) ? options.velocity : validVector(part.vel) ? part.vel : { x: 0, y: 0, z: 0 };
      const angular = validVector(options.angularVelocity) ? options.angularVelocity : validVector(part.spin) ? part.spin : { x: 0, y: 0, z: 0 };
      const direct = options.direct === true;
      const impactSpeed = Number.isFinite(options.energy) ? clamp(options.energy, 0, 30) : Math.max(0, -inherited.y);
      let released = 0;
      for (const s of group) {
        if (s.active) continue;
        s.active = true; s.settled = false; s.supportId = null; s.contacts = 0; s.angularTime = 0;
        s.grounded = false; s.stableTime = 0; s.deposited = false; s.surfaceVelocity.set(0,0,0);
        s.wallContacts.clear();
        s.position.copy(s.localCenter).applyMatrix4(part.node.matrixWorld);
        s.quaternion.copy(deltaQuaternion);
        s.velocity.copy(inherited);
        // spin is world angular velocity, so both its lever arm and cross
        // product must be world-space, including transformed parents.
        radial.copy(s.position).sub(tempPosition);
        tangent.crossVectors(angular, radial);
        s.velocity.add(tangent);
        if (direct) {
          const strength = (options.weapon === 'meteor' ? 10 : options.weapon === 'ball' ? 8 : 9) + noise(s.id, 2) * 2;
          s.velocity.addScaledVector(direction, strength);
          if (validVector(options.point)) radial.copy(s.position).sub(options.point).normalize();
          else radial.set(noise(s.id, 3) - .5, noise(s.id, 4) - .5, noise(s.id, 5) - .5).normalize();
          s.velocity.addScaledVector(radial, .8 + noise(s.id, 6) * 1.6);
          s.velocity.y += .4 + noise(s.id, 7) * .8;
        } else {
          // Contact crush is primarily downward motion inherited from the
          // parent, with only a small amount of energy escaping sideways.
          // There is no new explosion or retained projectile-direction kick.
          radial.set(s.position.x - tempPosition.x, 0, s.position.z - tempPosition.z);
          if (radial.lengthSq() < .0001) {
            const angle = noise(s.id, 3) * Math.PI * 2;
            radial.set(Math.cos(angle), 0, Math.sin(angle));
          } else radial.normalize();
          const spread = Math.min(3, impactSpeed * .16) * (.65 + noise(s.id, 6) * .35);
          s.velocity.x += radial.x * spread;
          s.velocity.z += radial.z * spread;
        }
        s.angular.set(noise(s.id, 11) - .5, noise(s.id, 12) - .5, noise(s.id, 13) - .5);
        if (direct) s.angular.multiplyScalar(4.5);
        else s.angular.normalize().multiplyScalar(Math.min(2, impactSpeed * .12) * (.7 + noise(s.id, 14) * .3));
        s.angular.add(angular);
        s.damageEnergy=.5*s.mass*s.velocity.lengthSq();
        moving.add(s);
        extent(s); writePose(s); released++;
      }
      activeCount += released; movingCount += released;
      if (released) for (const mesh of batches) mesh.visible = true;
      return released;
    }

    function extent(s) {
      const q = s.quaternion, h = s.half;
      const xx = q.x*q.x, yy = q.y*q.y, zz = q.z*q.z;
      const xy = q.x*q.y, xz = q.x*q.z, yz = q.y*q.z;
      const wx = q.w*q.x, wy = q.w*q.y, wz = q.w*q.z;
      s.extent.set(
        Math.abs(1-2*(yy+zz))*h.x + Math.abs(2*(xy-wz))*h.y + Math.abs(2*(xz+wy))*h.z,
        Math.abs(2*(xy+wz))*h.x + Math.abs(1-2*(xx+zz))*h.y + Math.abs(2*(yz-wx))*h.z,
        Math.abs(2*(xz-wy))*h.x + Math.abs(2*(yz+wx))*h.y + Math.abs(1-2*(xx+yy))*h.z);
    }

    function rotate(s, dt) {
      const q = s.quaternion, a = s.angular;
      const x = q.x, y = q.y, z = q.z, w = q.w, k = dt * .5;
      q.set(x + k*(a.x*w + a.y*z - a.z*y),
        y + k*(a.y*w + a.z*x - a.x*z), z + k*(a.z*w + a.x*y - a.y*x),
        w - k*(a.x*x + a.y*y + a.z*z)).normalize();
      a.multiplyScalar(Math.exp(-.55 * dt));
      extent(s);
    }

    function cellIndex(x, z) {
      const ix = Math.floor((x + ORIGIN) / CELL), iz = Math.floor((z + ORIGIN) / CELL);
      return ix < 0 || iz < 0 || ix >= GRID || iz >= GRID ? -1 : iz * GRID + ix;
    }
    function groundHeight(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return GROUND;
      // Interpolate between cell centers so moving debris encounters a finite
      // slope rather than a staircase that repeatedly creates new impacts.
      const gx = (x + ORIGIN) / CELL - .5, gz = (z + ORIGIN) / CELL - .5;
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx-ix, fz = gz-iz;
      if (ix < 0 || iz < 0 || ix+1 >= GRID || iz+1 >= GRID) return GROUND;
      const i = iz*GRID+ix;
      return GROUND + (pile[i]*(1-fx)+pile[i+1]*fx)*(1-fz) + (pile[i+GRID]*(1-fx)+pile[i+GRID+1]*fx)*fz;
    }
    function deposit(s) {
      // Fixed heightfield conserves a fraction of the fragment AABB volume,
      // avoiding an O(n²) fragment contact solver or a second rubble mesh pool.
      const e = s.extent, p = s.position;
      const x0 = clamp(Math.floor((p.x - e.x + ORIGIN) / CELL), 0, GRID-1);
      const x1 = clamp(Math.floor((p.x + e.x + ORIGIN) / CELL), 0, GRID-1);
      const z0 = clamp(Math.floor((p.z - e.z + ORIGIN) / CELL), 0, GRID-1);
      const z1 = clamp(Math.floor((p.z + e.z + ORIGIN) / CELL), 0, GRID-1);
      if (cellIndex(p.x,p.z) < 0) return;
      // Fracture AABBs include empty corners; a conservative fill fraction
      // prevents six storeys of thin wall/slab meshes creating tall box piles.
      const volume = 8 * s.half.x * s.half.y * s.half.z * .20;
      const rise = Math.min(.6, volume / (CELL * CELL * (x1-x0+1) * (z1-z0+1)));
      for (let z=z0; z<=z1; z++) for (let x=x0; x<=x1; x++) pile[z*GRID+x] += rise;
    }
    function overlap(s, support, x = s.position.x, z = s.position.z) {
      if (support.contains) return support.contains(x,z,s.extent.x,s.extent.z);
      return x+s.extent.x >= support.minX && x-s.extent.x <= support.maxX &&
        z+s.extent.z >= support.minZ && z-s.extent.z <= support.maxZ;
    }

    function heightAt(support, x, z) {
      return support ? support.surfaceAt ? support.surfaceAt(x,z) : support.top : groundHeight(x,z);
    }
    function velocityAt(support, x, z, result) {
      const value = support && support.velocityAt ? support.velocityAt(x,z) : null;
      return validVector(value) ? result.copy(value) : result.set(0,support && Number.isFinite(support.velocityY) ? support.velocityY : 0,0);
    }
    function normalAt(support, x, z) {
      const span = support ? .2 : CELL*.5;
      const dx = (heightAt(support,x+span,z)-heightAt(support,x-span,z))/(2*span);
      const dz = (heightAt(support,x,z+span)-heightAt(support,x,z-span))/(2*span);
      return normal.set(Number.isFinite(dx) ? -dx : 0,1,Number.isFinite(dz) ? -dz : 0).normalize();
    }
    function sweepHeight(surface, x, z, alpha, duration) {
      const end = heightAt(surface,x,z);
      let start;
      if (surface.previous) start = heightAt(surface.previous,x,z);
      else {
        normalAt(surface,x,z); velocityAt(surface,x,z,surfaceVelocity);
        // A translating tilted plane changes height at a fixed world X/Z by
        // vy - slopeX*vx - slopeZ*vz, not by its point velocity Y alone.
        start = end - surfaceVelocity.dot(normal)/normal.y*duration;
      }
      return Number.isFinite(start) ? start+(end-start)*alpha : end;
    }
    function wake(s) {
      s.settled = false; s.grounded = false; s.supportId = null; s.stableTime = 0;
      restingOnSupport.delete(s); moving.add(s); setRelevant(s, true);
      movingCount++; settledCount--;
    }

    function quietGroundContact(s) {
      // Never treat an airborne apex or motion on a structural support as a
      // cosmetic tail. Bound both translation and rotational surface speed.
      const radius = Math.max(s.extent.x,s.extent.y,s.extent.z);
      return s.grounded && s.supportId == null &&
        s.velocity.lengthSq() <= .35*.35 && s.angular.lengthSq()*radius*radius <= .25*.25;
    }
    function setRelevant(s, value) {
      if (s.relevant === value) return;
      s.relevant = value; relevantMovingCount += value ? 1 : -1;
    }
    function sleep(s) {
      s.settled = true; s.velocity.copy(s.surfaceVelocity); s.angular.set(0,0,0);
      updateDamageEnergy(s,s.position.y);
      moving.delete(s); setRelevant(s, false);
      movingCount--; settledCount++;
      if (s.supportId != null) restingOnSupport.add(s);
      else if (!s.deposited) { deposit(s); s.deposited = true; }
    }
    function quietTail() {
      let slept = 0;
      for (const s of moving) {
        if (!quietGroundContact(s)) continue;
        sleep(s); writePose(s); slept++;
      }
      return slept;
    }

    function setCollider(value, handler) {
      collider = value || null; onContact = typeof handler === 'function' ? handler : null;
    }
    function updateDamageEnergy(s, fromY, toY = s.position.y) {
      // Physical transport can borrow momentum from a moving support. Only
      // launch energy and a real loss of gravitational potential fund damage;
      // changing the carrier's velocity cannot refill that separate balance.
      s.damageEnergy=Math.max(0,Math.min(s.damageEnergy+s.mass*GRAVITY*(fromY-toY),.5*s.mass*s.velocity.lengthSq()));
    }
    function floorContactTime(s, start, end, surfaces, alpha0, alpha1, frameDuration) {
      let earliest=Infinity;
      const oldBottom=start.y-s.extent.y,bottom=end.y-s.extent.y;
      for(const support of surfaces) {
        const previous=support.previous||support;
        if(Math.max(start.x,end.x)+s.extent.x<Math.min(previous.minX,support.minX)||
           Math.min(start.x,end.x)-s.extent.x>Math.max(previous.maxX,support.maxX)||
           Math.max(start.z,end.z)+s.extent.z<Math.min(previous.minZ,support.minZ)||
           Math.min(start.z,end.z)-s.extent.z>Math.max(previous.maxZ,support.maxZ)) continue;
        const oldGap=oldBottom-sweepHeight(support,start.x,start.z,alpha0,frameDuration);
        const newGap=bottom-sweepHeight(support,end.x,end.z,alpha1,frameDuration);
        if(!Number.isFinite(oldGap+newGap)||oldGap<-.06||newGap>1e-7||newGap>oldGap+1e-8) continue;
        const t=clamp(oldGap/Math.max(.0001,oldGap-newGap),0,1);
        if(t<earliest&&overlap(s,support,start.x+(end.x-start.x)*t,start.z+(end.z-start.z)*t)) earliest=t;
      }
      if(end.y<=start.y) {
        const oldGap=oldBottom-groundHeight(start.x,start.z),newGap=bottom-groundHeight(end.x,end.z);
        if(newGap<=0) earliest=Math.min(earliest,clamp(oldGap/Math.max(.0001,oldGap-newGap),0,1));
      }
      return earliest;
    }
    function moveWithContacts(s, duration, activeCollider, events, surfaces, alpha0, frameDuration) {
      const p=s.position,v=s.velocity;
      if(!activeCollider) {const fromY=p.y;p.addScaledVector(v,duration);updateDamageEnergy(s,fromY);return;}
      let remaining=duration, elapsed=0, ignored=null;
      // A broken front wall may expose a second real wall in the same step.
      // Bound this loop; a wedged chip stops rather than tunnelling through an
      // unbounded stack of surfaces or consuming a frame in collision work.
      for(let contact=0;contact<4&&remaining>1e-7;contact++) {
        contactStart.copy(p);contactEnd.copy(p).addScaledVector(v,remaining);
        const hit=activeCollider.sweep(contactStart,contactEnd,{
          excludePartId:s.partId,excludeIds:ignored,halfExtents:s.extent,
          // Existing moving support tops already own these landings and their
          // relative-height sweep. Side and underside triangles remain solid.
          acceptNormal: acceptContactNormal,
        });
        if(!hit) {p.copy(contactEnd);updateDamageEnergy(s,contactStart.y);return;}
        // A lower wall cannot receive damage after an earlier intact floor
        // already intercepted this trajectory. Let the existing top solver
        // handle that earlier contact, including its moving-plane response.
        if(!s.grounded&&hit.time>floorContactTime(s,contactStart,contactEnd,surfaces,
          alpha0+elapsed/frameDuration,alpha0+(elapsed+remaining)/frameDuration,frameDuration)+1e-7) {
          p.copy(contactEnd);updateDamageEnergy(s,contactStart.y);return;
        }
        updateDamageEnergy(s,contactStart.y,hit.center.y);
        p.copy(hit.center).addScaledVector(hit.normal,.002);
        if(p.y>hit.center.y)s.damageEnergy=Math.max(0,s.damageEnergy-s.mass*GRAVITY*(p.y-hit.center.y));
        relative.copy(v).sub(hit.velocity);
        const impact=Math.max(0,-relative.dot(hit.normal));
        const kineticEnergy=.5*s.mass*impact*impact;
        let outcome=null;
        const key=String(hit.partId);
        if(impact>1.3&&!s.wallContacts.has(key)) {
          s.wallContacts.add(key);
          const event={type:'fragment-wall',point:hit.point,normal:hit.normal,velocity:v.clone(),
            floor:hit.part.floor,partId:s.partId,sourcePartId:s.partId,pieceId:s.id,targetPartId:hit.partId,supportId:hit.partId,
            energy:impact,normalSpeed:impact,mass:s.mass,impulse:s.mass*impact*1.08,kineticEnergy,availableEnergy:s.damageEnergy,
            firstContact:s.wallContacts.size===1,time:hit.time,target:hit.part};
          events.push(event);
          // Damage is synchronous: later fragments in this frame see the
          // changed target visibility instead of hitting an already gone wall.
          if(onContact) outcome=onContact(event);
        }
        relative.addScaledVector(hit.normal,impact);
        if(outcome?.broken) {
          const spent=Number.isFinite(outcome.spentEnergy)?Math.max(0,outcome.spentEnergy):kineticEnergy;
          s.damageEnergy=Math.max(0,s.damageEnergy-spent);
          const speed=Math.sqrt(Math.max(0,impact*impact-2*spent/Math.max(.0001,s.mass)));
          relative.multiplyScalar(.9).addScaledVector(hit.normal,-speed);
          if(!ignored) ignored=new Set();ignored.add(hit.partId);
          s.angular.multiplyScalar(.85);
        } else {
          relative.multiplyScalar(.78).addScaledVector(hit.normal,impact*.08);
          s.angular.multiplyScalar(.65);
        }
        v.copy(hit.velocity).add(relative);
        updateDamageEnergy(s,p.y);
        if(!outcome?.broken) return;
        elapsed+=remaining*hit.time;remaining*=Math.max(0,1-hit.time);
      }
    }

    function step(dt, supports = [], activeCollider = collider) {
      const events = [];
      simulated = supportChecks = 0;
      if (!prepared || !activeCount || !Number.isFinite(dt) || dt <= 0) return events;
      // The structural solver has already advanced supports to this frame's
      // end. Sweep their tops alongside the fragments instead of treating a
      // descending floor as a stationary wall at its final elevation.
      const duration = Math.min(dt,.25), steps = Math.ceil(duration/(1/60)), h = duration/steps;
      const surfaces = supports.map(support => ({ ...support, previous: supportMap.get(support.id) }));
      supportMap.clear();
      // Save only raw immutable snapshots, never a recursively linked history.
      for (const support of supports) supportMap.set(support.id, support);
      carriedCount = 0;
      for (const s of restingOnSupport) {
        supportChecks++;
        const support = supportMap.get(s.supportId);
        velocityAt(support,s.position.x,s.position.z,surfaceVelocity);
        const x = s.position.x+surfaceVelocity.x*duration, z = s.position.z+surfaceVelocity.z*duration;
        normalAt(support,x,z);
        if (!support || !overlap(s,support,x,z) || !Number.isFinite(heightAt(support,x,z))) {
          wake(s);
        } else if (Math.hypot(normal.x,normal.z) > .28*normal.y) {
          // A previously level floor may tilt after the fragment has rested.
          // Wake on real support changes; settled ground never self-wakes
          // from its own heightfield deposit or from later rubble deposits.
          wake(s); s.grounded = true; s.supportId = support.id;
        } else {
          const top = heightAt(support,x,z), y = top+s.extent.y;
          const moved = Math.abs(x-s.position.x)+Math.abs(y-s.position.y)+Math.abs(z-s.position.z) > 1e-8;
          const oldY=s.position.y;
          s.position.set(x,y,z); s.supportTop = top;
          s.velocity.copy(surfaceVelocity); s.surfaceVelocity.copy(surfaceVelocity);
          updateDamageEnergy(s,oldY);
          if (moved || surfaceVelocity.lengthSq() > 1e-8) carriedCount++;
          if (moved) writePose(s);
        }
      }
      if (!movingCount) return events;
      // A bounded substep prevents fast shots crossing multiple thin floors.
      const drag = Math.exp(-.22*h), angularInterval = profile.targetFps >= 60 ? 0 : 1/30;
      for (let iteration = 0; iteration < steps; iteration++) {
        for (const s of moving) {
          simulated++;
          const p = s.position, v = s.velocity;
          const oldX = p.x, oldZ = p.z, oldBottom = p.y-s.extent.y;
          s.angularTime += h;
          if (s.angularTime >= angularInterval) { rotate(s,s.angularTime); s.angularTime = 0; }
          if (s.grounded) {
            const support = s.supportId == null ? null : surfaces.find(item => item.id === s.supportId);
            if ((s.supportId != null && (!support || !overlap(s,support))) || !Number.isFinite(heightAt(support,p.x,p.z))) {
              s.grounded = false; s.supportId = null; s.stableTime = 0;
            } else {
              normalAt(support,p.x,p.z); velocityAt(support,p.x,p.z,surfaceVelocity);
              // Keep relative motion when the support accelerates. Gravity
              // and Coulomb friction act in the plane, so a finite ramp can
              // slide a fragment off its edge without invented blast energy.
              relative.copy(v).sub(s.surfaceVelocity);
              relative.addScaledVector(normal,-relative.dot(normal));
              relative.y -= GRAVITY*h;
              relative.addScaledVector(normal,-relative.dot(normal));
              const speed = relative.length();
              const friction = (support ? .28 : .34) * (.85+noise(s.id,18)*.3) * GRAVITY*normal.y*h;
              relative.multiplyScalar(speed > 0 ? Math.max(0,1-friction/speed) : 0);
              tangent.crossVectors(normal,relative).multiplyScalar(1/Math.max(.18,s.extent.y));
              s.angular.lerp(tangent,1-Math.exp(-5*h));
              v.copy(surfaceVelocity).add(relative);
              moveWithContacts(s,h,activeCollider,events,surfaces,iteration/steps,duration);
              if (!support || overlap(s,support)) {
                const top = support ? sweepHeight(support,p.x,p.z,(iteration+1)/steps,duration) : groundHeight(p.x,p.z);
                const priorY=p.y;p.y = top+s.extent.y; s.supportTop = top;
                updateDamageEnergy(s,priorY);
                s.surfaceVelocity.copy(surfaceVelocity);
                s.stableTime = relative.lengthSq() < .0064 && s.angular.lengthSq() < .0324 ? s.stableTime+h : 0;
                if (s.stableTime >= .28) {
                  sleep(s);
                  if (support) {
                    const remaining = (steps-iteration-1)*h;
                    p.addScaledVector(surfaceVelocity,remaining);
                    const priorY=p.y;p.y = heightAt(support,p.x,p.z)+s.extent.y;
                    updateDamageEnergy(s,priorY);
                    if (surfaceVelocity.lengthSq() > 1e-8) carriedCount++;
                  }
                }
                writePose(s); continue;
              }
              // Walked beyond the actual footprint, not an infinite plane.
              s.grounded = false; s.supportId = null; s.stableTime = 0;
              writePose(s); continue;
            }
          }
          v.y -= GRAVITY*h; v.x *= drag; v.z *= drag;
          moveWithContacts(s,h,activeCollider,events,surfaces,iteration/steps,duration);
          const bottom = p.y-s.extent.y;
          let landing = null, top = -Infinity;
          for (const support of surfaces) {
            const previous = support.previous || support;
            // Reject distant sectors before sampling tilted planes or point
            // velocities; all 5,633 pieces share this bounded contact pass.
            if (Math.max(oldX,p.x)+s.extent.x < Math.min(previous.minX,support.minX) ||
                Math.min(oldX,p.x)-s.extent.x > Math.max(previous.maxX,support.maxX) ||
                Math.max(oldZ,p.z)+s.extent.z < Math.min(previous.minZ,support.minZ) ||
                Math.min(oldZ,p.z)-s.extent.z > Math.max(previous.maxZ,support.maxZ)) continue;
            const oldTop = sweepHeight(support,oldX,oldZ,iteration/steps,duration);
            const newTop = sweepHeight(support,p.x,p.z,(iteration+1)/steps,duration);
            const oldGap = oldBottom-oldTop, newGap = bottom-newTop;
            if (!Number.isFinite(newTop) || newTop <= top || oldGap < -.06 || newGap > 1e-7 || newGap > oldGap+1e-8) continue;
            const t = clamp(oldGap/Math.max(.0001,oldGap-newGap),0,1);
            if (!overlap(s,support,oldX+(p.x-oldX)*t,oldZ+(p.z-oldZ)*t)) continue;
            landing = support; top = newTop;
          }
          if (v.y <= 0) {
            const floor = groundHeight(p.x,p.z);
            if (bottom <= floor && floor > top) { top = floor; landing = null; }
          }
          if (top > -Infinity) {
            normalAt(landing,p.x,p.z); velocityAt(landing,p.x,p.z,surfaceVelocity);
            relative.copy(v).sub(surfaceVelocity);
            const impact = Math.max(0,-relative.dot(normal));
            const priorY=p.y;p.y = top+s.extent.y;
            updateDamageEnergy(s,priorY);
            s.contacts++;
            s.supportId = landing ? landing.id : null; s.supportTop = top;
            if (impact > 1.3 && s.contacts <= 3) events.push({
              point: new T.Vector3(p.x,top,p.z), floor: landing ? landing.floor : 0,
              energy: impact, partId: s.partId, pieceId: s.id, supportId: s.supportId,
              mass: s.mass, impulse: s.mass * impact, kineticEnergy: .5 * s.mass * impact * impact,
              firstContact: s.contacts === 1,
            });
            relative.addScaledVector(normal,-relative.dot(normal));
            if (impact > 1.3) { relative.multiplyScalar(.82); s.angular.multiplyScalar(.72); }
            const rebound = impact*.12;
            s.grounded = rebound < .35; s.stableTime = 0;
            v.copy(surfaceVelocity).add(relative);
            if (!s.grounded) v.addScaledVector(normal,rebound);
            updateDamageEnergy(s,p.y);
            s.surfaceVelocity.copy(surfaceVelocity);
          }
          writePose(s);
        }
      }
      return events;
    }

    function render() {
      if (dirty && texture) { texture.needsUpdate = true; uploads++; dirty = false; }
    }
    function reset() {
      pile.fill(0); supportMap.clear(); activeCount = movingCount = settledCount = carriedCount = 0;
      moving.clear(); restingOnSupport.clear(); relevantMovingCount = simulated = supportChecks = 0;
      for (const s of states) {
        s.active = s.settled = s.relevant = false; s.supportId = null; s.contacts = 0;
        s.position.copy(s.restCenter); s.quaternion.identity(); s.extent.copy(s.half);
        s.velocity.set(0,0,0); s.angular.set(0,0,0); s.angularTime = 0;
        s.grounded = false; s.stableTime = 0; s.deposited = false; s.surfaceVelocity.set(0,0,0);
        s.wallContacts.clear();s.damageEnergy=0;
        writePose(s);
      }
      for (const mesh of batches) mesh.visible = false;
    }
    function setQuality(value) {
      profile = value || profile;
      for (const mesh of batches) mesh.castShadow = mesh.userData.fragmentKind === 'structure' && !!profile.shadows;
    }
    function stats() {
      return { prepared, pieceCount: states.length, active: activeCount, moving: movingCount + carriedCount, settled: settledCount - carriedCount, carried: carriedCount,
        relevantMoving: relevantMovingCount + carriedCount, simulated, supportChecks,
        maxDrawCalls: batches.length, geometries: batches.length, materials: batches.length + (depthMaterial ? 1 : 0),
        triangles, textures: texture ? 1 : 0, uploads };
    }
    function sample(partId, limit = 8) {
      const result = [], group = partId == null ? states : byPart.get(String(partId)) || [];
      for (const s of group) {
        if (!s.active) continue;
        if (result.length >= limit) break;
        result.push({ id:s.id, partId:s.partId, kind:s.kind, position:s.position.clone(), quaternion:s.quaternion.clone(),
          velocity:s.velocity.clone(), settled:s.settled, supportId:s.supportId });
      }
      return result;
    }
    return { prepare, release, step, render, reset, setQuality, stats, sample, groundHeight, quietTail, setCollider };
  }
  window.SkyfallStructuralFragments = { create };
})();
