/* Fixed mobile concrete-grain pool. One Points draw, no per-impact GPU assets. */
(function () {
  'use strict';
  const T = window.THREE;
  const clamp = T.MathUtils.clamp;
  const CAPACITY = 5000;
  const vertex = `
    attribute vec4 aGrain;
    attribute vec3 aTint;
    uniform float projectionScale;
    uniform float pixelRatio;
    varying vec4 vGrain;
    varying vec3 vTint;
    void main() {
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * view;
      float projected = aGrain.x * projectionScale / max(0.1, -view.z);
      gl_PointSize = clamp(projected, 1.05 * pixelRatio, 12.0 * pixelRatio);
      vGrain = aGrain;
      vTint = aTint;
    }`;
  const fragment = `
    varying vec4 vGrain;
    varying vec3 vTint;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float c = cos(vGrain.z), s = sin(vGrain.z);
      p = mat2(c, -s, s, c) * p;
      // Unequal clipped facets make matte chips, rather than soft smoke circles
      // or additive star-shaped sparks. No textures or external assets.
      float edge = max(abs(p.x * 0.92 + p.y * 0.18), abs(p.y * 1.08 - p.x * 0.12));
      edge = max(edge, (abs(p.x) + abs(p.y)) * 0.68);
      edge += p.x * 0.055 * sin(vGrain.w) + p.y * 0.045;
      float alpha = (1.0 - smoothstep(0.69, 0.92, edge)) * vGrain.y;
      if (alpha < 0.015) discard;
      float facet = 0.80 + clamp(0.11 * p.x - 0.09 * p.y + 0.1, 0.0, 0.2);
      gl_FragColor = vec4(vTint * facet, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function finiteVector(v) {
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }
  function create(scene) {
    const geometry = new T.BufferGeometry();
    const position = new T.BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(T.DynamicDrawUsage);
    const grain = new T.BufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(T.DynamicDrawUsage);
    const tint = new T.BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('position', position); geometry.setAttribute('aGrain', grain); geometry.setAttribute('aTint', tint);
    geometry.setDrawRange(0, 0);
    const material = new T.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
      uniforms: { projectionScale: { value: 720 }, pixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, blending: T.NormalBlending, toneMapped: true });
    const points = new T.Points(geometry, material);
    points.name = 'powder_grains'; points.frustumCulled = false; points.visible = false;
    points.renderOrder = 7; scene.add(points);

    // Intrusive FIFO plus free stack: both reclaiming the oldest grain and
    // retiring any expired grain take O(1), even during a complete upper fall.
    const next = new Int32Array(CAPACITY), previous = new Int32Array(CAPACITY), free = new Int32Array(CAPACITY);
    const xyz = new Float32Array(CAPACITY * 3), velocity = new Float32Array(CAPACITY * 3);
    const colors = new Float32Array(CAPACITY * 3), age = new Float32Array(CAPACITY), life = new Float32Array(CAPACITY);
    const sizes = new Float32Array(CAPACITY), angles = new Float32Array(CAPACITY), spins = new Float32Array(CAPACITY);
    const seeds = new Float32Array(CAPACITY), grounded = new Float32Array(CAPACITY), drag = new Float32Array(CAPACITY);
    const direction = new T.Vector3(), right = new T.Vector3(), up = new T.Vector3();
    let head = -1, tail = -1, active = 0, freeCount = CAPACITY, limit = 3000, quality = 'balanced';
    let serial = 0, spawned = 0, dirty = false, lastEmission = null;

    function retire(i) {
      const before = previous[i], after = next[i];
      if (before < 0) head = after; else next[before] = after;
      if (after < 0) tail = before; else previous[after] = before;
      free[freeCount++] = i; active--; dirty = true;
    }
    function acquire() {
      if (active >= limit) retire(head);
      const i = free[--freeCount];
      previous[i] = tail; next[i] = -1;
      if (tail < 0) head = i; else next[tail] = i;
      tail = i; active++;
      return i;
    }
    function random(seed) {
      const n = Math.sin(seed * 127.1 + 91.73) * 43758.5453;
      return n - Math.floor(n);
    }
    function emit(point, options = {}) {
      if (!finiteVector(point)) return 0;
      const requested = options.count === undefined ? 180 : options.count;
      if (!Number.isFinite(requested) || requested <= 0) return 0;
      const count = Math.min(limit, Math.floor(requested));
      const energy = clamp(Number.isFinite(options.energy) ? options.energy : 1, .1, 3);
      const spread = clamp(Number.isFinite(options.spread) ? options.spread : .45, 0, 30);
      const falling = !!options.falling;
      direction.set(0, 0, -1);
      if (finiteVector(options.direction)) direction.copy(options.direction);
      if (direction.lengthSq() < .00001) direction.set(0, 0, -1); else direction.normalize();
      right.set(Math.abs(direction.y) > .95 ? 1 : 0, Math.abs(direction.y) > .95 ? 0 : 1, 0);
      right.cross(direction).normalize(); up.crossVectors(direction, right).normalize();
      for (let j = 0; j < count; j++) {
        const i = acquire(), k = i * 3, seed = ++serial;
        const a = random(seed + .17), b = random(seed + 13.8), c = random(seed + 37.2);
        const theta = seed * 2.39996323, rx = Math.cos(theta), ry = Math.sin(theta);
        const radius = Math.sqrt(a) * spread;
        xyz[k] = point.x + (falling ? rx * radius : right.x * rx * radius + up.x * ry * radius);
        xyz[k + 1] = point.y + (falling ? (b - .5) * spread * .55 : right.y * rx * radius + up.y * ry * radius);
        xyz[k + 2] = point.z + (falling ? ry * radius : right.z * rx * radius + up.z * ry * radius);
        if (falling) {
          // Detached facade powder already lacks support. No initial upward
          // plume: a broad, uneven waterfall with a small inherited shot drift.
          const lateral = (.45 + b * 2.1) * Math.sqrt(energy);
          velocity[k] = rx * lateral + direction.x * energy * .45;
          velocity[k + 1] = -(1.8 + c * 4.8) * Math.sqrt(energy);
          velocity[k + 2] = ry * lateral + direction.z * energy * .45;
        } else {
          const speed = (9 + b * 11) * Math.sqrt(energy);
          const forward = j % 7 === 0 ? -.36 : 1;
          const lateral = (.14 + c * .32) * speed;
          velocity[k] = direction.x * speed * forward + (right.x * rx + up.x * ry) * lateral;
          velocity[k + 1] = direction.y * speed * forward + (right.y * rx + up.y * ry) * lateral + .5;
          velocity[k + 2] = direction.z * speed * forward + (right.z * rx + up.z * ry) * lateral;
        }
        age[i] = 0; life[i] = 2.35 + c * 1.6; grounded[i] = -1;
        sizes[i] = .015 + Math.pow(b, 1.65) * .105;
        angles[i] = theta; spins[i] = (a - .5) * 8; seeds[i] = seed % 1000;
        drag[i] = falling ? .38 : .72;
        // Linear-space neutral/warm concrete, with a few darker aggregate grains.
        const shade = j % 11 === 0 ? .055 + a * .06 : .13 + a * .17;
        colors[k] = shade * 1.025; colors[k + 1] = shade; colors[k + 2] = shade * .93;
      }
      spawned += count; dirty = true;
      lastEmission = { x: point.x, y: point.y, z: point.z, count, falling };
      return count;
    }
    function step(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || !active) return;
      for (let i = head; i >= 0;) {
        const following = next[i], k = i * 3;
        age[i] += dt;
        if (age[i] >= life[i]) { retire(i); i = following; continue; }
        if (grounded[i] >= 0) {
          grounded[i] += dt;
          if (grounded[i] >= .8) { retire(i); i = following; continue; }
          const decay = Math.exp(-4.8 * dt), travel = (1 - decay) / 4.8;
          xyz[k] += velocity[k] * travel; xyz[k + 2] += velocity[k + 2] * travel;
          velocity[k] *= decay; velocity[k + 2] *= decay;
        } else {
          const decay = Math.exp(-drag[i] * dt), travel = (1 - decay) / drag[i];
          xyz[k] += velocity[k] * travel;
          xyz[k + 1] += velocity[k + 1] * travel - 15.5 * (dt - travel) / drag[i];
          xyz[k + 2] += velocity[k + 2] * travel;
          velocity[k] *= decay; velocity[k + 1] = velocity[k + 1] * decay - 15.5 * travel; velocity[k + 2] *= decay;
          const floor = .025 + sizes[i] * .3;
          if (xyz[k + 1] <= floor) {
            xyz[k + 1] = floor; grounded[i] = 0;
            velocity[k] *= .18; velocity[k + 1] = 0; velocity[k + 2] *= .18;
          }
        }
        angles[i] += spins[i] * dt; i = following;
      }
      dirty = true;
    }
    function render(camera, viewportHeight = 720, devicePixelRatio = 1) {
      const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 720;
      const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? clamp(devicePixelRatio, .5, 3) : 1;
      // viewportHeight is CSS pixels. projectionMatrix includes camera zoom/FOV.
      const projection = camera?.projectionMatrix?.elements[5];
      material.uniforms.projectionScale.value = height * ratio * .5 * (Number.isFinite(projection) ? projection : 2.4);
      material.uniforms.pixelRatio.value = ratio;
      if (!dirty) return;
      let n = 0;
      for (let i = head; i >= 0; i = next[i]) {
        const k = i * 3, p = n * 3, g = n * 4;
        position.array[p] = xyz[k]; position.array[p + 1] = xyz[k + 1]; position.array[p + 2] = xyz[k + 2];
        tint.array[p] = colors[k]; tint.array[p + 1] = colors[k + 1]; tint.array[p + 2] = colors[k + 2];
        grain.array[g] = sizes[i];
        grain.array[g + 1] = .94 * Math.min(1, (life[i] - age[i]) / .7) * (grounded[i] < 0 ? 1 : Math.max(0, 1 - grounded[i] / .8));
        grain.array[g + 2] = angles[i]; grain.array[g + 3] = seeds[i];
        n++;
      }
      geometry.setDrawRange(0, n); points.visible = n > 0;
      if (n) {
        for (const attribute of [position, tint, grain]) {
          attribute.clearUpdateRanges(); attribute.addUpdateRange(0, n * attribute.itemSize); attribute.needsUpdate = true;
        }
      }
      dirty = false;
    }
    function reset() {
      head = tail = -1; active = 0; freeCount = CAPACITY;
      for (let i = 0; i < CAPACITY; i++) free[i] = CAPACITY - 1 - i;
      geometry.setDrawRange(0, 0); points.visible = false;
      serial = spawned = 0; lastEmission = null; dirty = false;
    }
    function setQuality(profile) {
      quality = typeof profile === 'string' ? profile : profile?.fragments <= 100 ? 'low' : profile?.fragments >= 300 ? 'high' : 'balanced';
      if (quality !== 'low' && quality !== 'high') quality = 'balanced';
      limit = quality === 'low' ? 1400 : quality === 'high' ? 5000 : 3000;
      while (active > limit) retire(head);
      geometry.setDrawRange(0, Math.min(geometry.drawRange.count, active));
      if (!active) points.visible = false;
    }
    function stats() {
      let resting = 0;
      for (let i = head; i >= 0; i = next[i]) if (grounded[i] >= 0) resting++;
      return { active, capacity: limit, allocated: CAPACITY, spawned, grounded: resting,
        maxDrawCalls: 1, drawCalls: points.visible ? 1 : 0, quality,
        lastEmission: lastEmission ? { ...lastEmission } : null };
    }
    reset();
    return { emit, step, render, reset, setQuality, stats };
  }
  window.SkyfallPowder = Object.freeze({ create });
})();
