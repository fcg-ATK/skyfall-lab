'use strict';
// CPU/geometry integration checks. Renderer and canvas are stubs; this does not
// verify GPU rendering, shader compilation, browser touch input, or phone FPS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../dist');
const physics = require('../dist/physics.js');

const gradient = { addColorStop() {} };
function makeCanvas(width = 390, height = 844) {
  const canvas = { clientWidth: width, clientHeight: height, width, height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  };
  const ctx = { canvas, createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    fillRect() {}, clearRect() {}, strokeRect() {}, drawImage() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, bezierCurveTo() {}, arc() {}, fill() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    fillText() {}, measureText: text => ({ width: String(text).length * 8 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
  canvas.getContext = () => ctx;
  return canvas;
}

// Read and validate the actual image container, but leave raster decoding/GPU
// upload to browser QA. This keeps GLTF textures/materials real in CPU checks.
function imageSize(bytes) {
  const b = Buffer.from(bytes);
  if (b.length >= 24 && b.toString('hex', 0, 8) === '89504e470d0a1a0a')
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < b.length) {
      if (b[offset] !== 0xff) { offset++; continue; }
      const marker = b[offset + 1]; offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
      const length = b.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { width: b.readUInt16BE(offset + 5), height: b.readUInt16BE(offset + 3) };
      if (length < 2) break;
      offset += length;
    }
  }
  throw new Error('CPU fixture image must be a valid PNG or JPEG');
}
async function readImage(url) {
  if (String(url).startsWith('blob:') || String(url).startsWith('data:')) {
    const response = await fetch(url); return new Uint8Array(await response.arrayBuffer());
  }
  return fs.readFileSync(path.resolve(root, String(url).split('?')[0]));
}
class FixtureImage {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  set src(url) {
    this.currentSrc = url;
    readImage(url).then(bytes => {
      Object.assign(this, imageSize(bytes)); this.naturalWidth = this.width; this.naturalHeight = this.height;
      this.listeners.get('load')?.call(this, { target: this });
    }).catch(error => this.listeners.get('error')?.call(this, error));
  }
  get src() { return this.currentSrc; }
}
const context = vm.createContext({ console, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout,
  Blob, AbortController, AbortSignal, ArrayBuffer, Uint8Array, Uint8ClampedArray, Float32Array, Uint16Array, Uint32Array,
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
  document: { createElement: tag => tag === 'img' ? new FixtureImage() : makeCanvas(), createElementNS: (ns, tag) => tag === 'img' ? new FixtureImage() : makeCanvas() },
  createImageBitmap: async blob => ({ ...imageSize(await blob.arrayBuffer()), close() {} }),
  SkyfallPhysics: physics,
});
context.window = context; context.self = context;
context.fetch = async url => {
  if (String(url).startsWith('blob:') || String(url).startsWith('data:')) return fetch(url);
  const file = path.resolve(root, String(url));
  return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, 'utf8')),
    arrayBuffer: async () => Uint8Array.from(fs.readFileSync(file)).buffer,
    blob: async () => new Blob([fs.readFileSync(file)]),
  };
};
vm.runInContext(fs.readFileSync(path.join(root, 'three-local.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'three-addons-local.js'), 'utf8'), context);
const T = context.THREE;
T.WebGLRenderer = class {
  constructor(options) { this.options = options; this.domElement = options.canvas; this.shadowMap = {}; this.capabilities = { getMaxAnisotropy: () => 4 }; this.info = { render: { calls: 0, triangles: 0 } }; }
  setPixelRatio(ratio) { this.ratio = ratio; }
  setSize(w, h) { this.domElement.width = Math.floor(w * this.ratio); this.domElement.height = Math.floor(h * this.ratio); }
  render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }
};
T.PMREMGenerator = class {
  fromEquirectangular() { return { texture: new T.Texture(), dispose() {} }; }
  dispose() {}
};
T.GLTFLoader.prototype.loadAsync = async function (url) {
  const bytes = fs.readFileSync(path.join(root, url));
  return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
if (fs.existsSync(path.join(root, 'environment.js')))
  vm.runInContext(fs.readFileSync(path.join(root, 'environment.js'), 'utf8'), context);
for (const file of ['collapse-solver.js','structural-fragments.js', 'powder.js', 'impact-fx.js']) if (fs.existsSync(path.join(root, file)))
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), context);

async function engine() {
  const events = [];
  const value = new context.SkyfallEngine(makeCanvas(), (name, data) => events.push({ name, data }));
  await value.load(); value.render(); value.events = events;
  return value;
}
function advance(game, seconds, callback) {
  const frames = Math.ceil(seconds * 30);
  for (let i = 0; i < frames; i++) { game.step(1 / 30); if (callback) callback(game); }
}
function resourceCounts(game) {
  const geometries = new Set(), materials = new Set(), textures = new Set(); let objects = 0;
  game.scene.traverse(n => {
    objects++;
    if (n.geometry) geometries.add(n.geometry);
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      for (const uniform of Object.values(m.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
    });
  });
  if (game.scene.environment) textures.add(game.scene.environment);
  return { objects, geometries: geometries.size, materials: materials.size, textures: textures.size };
}

test('building contains self-contained mobile textures with real UV coordinates', async () => {
  const bytes = fs.readFileSync(path.join(root, 'assets/mobile-building.glb'));
  assert.ok(bytes.length < 10 * 1024 * 1024, 'building download must remain mobile-sized');
  const jsonLength = bytes.readUInt32LE(12);
  const model = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryStart = 20 + jsonLength + 8;
  assert.ok(model.images?.length >= 2, 'keep actual concrete colour and surface detail maps');
  for (const image of model.images) {
    assert.equal(image.uri, undefined, 'building textures must not depend on another host');
    const view = model.bufferViews[image.bufferView];
    assert.ok(view && view.byteLength > 128);
    const { width, height } = imageSize(bytes.subarray(binaryStart + (view.byteOffset || 0), binaryStart + (view.byteOffset || 0) + view.byteLength));
    assert.ok(width > 0 && width <= 2048 && height > 0 && height <= 2048);
  }
  const game = await engine();
  const solidMaterials = new Set(), glassMaterials = new Set();
  let triangles = 0, batches = 0;
  game.model.traverse(node => {
    if (!node.isMesh) return;
    batches++;
    triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
    if (/glass/i.test(node.name + ' ' + node.material.name)) glassMaterials.add(node.material);
    else {
      solidMaterials.add(node.material);
      assert.ok(node.geometry.attributes.uv?.count > 0, 'solid geometry needs projected texture coordinates');
    }
  });
  assert.ok([...solidMaterials].some(m => m.map && m.normalMap));
  assert.ok(glassMaterials.size > 0 && [...glassMaterials].every(m => !solidMaterials.has(m)), 'glazing remains a different material');
  assert.ok(batches <= 140, `building batch budget exceeded: ${batches}`);
  assert.ok(triangles <= 140000, `building triangle budget exceeded: ${triangles}`);
});

test('restored environment has bounded batches and lighting keeps directional contrast', async () => {
  const game = await engine();
  const group = game.scene.getObjectByName('mobile_environment_v2');
  assert.ok(group, 'the new streetscape must actually be attached to the scene');
  let batches = 0, triangles = 0;
  group.traverse(node => {
    if (!node.isMesh) return;
    batches += Array.isArray(node.material) ? node.material.length : 1;
    const count = node.geometry.index?.count || node.geometry.attributes.position.count;
    triangles += count / 3 * (node.isInstancedMesh ? node.count : 1);
  });
  assert.ok(batches <= 24, `environment batches exceed mobile budget: ${batches}`);
  assert.ok(triangles <= 50000, `environment triangles exceed mobile budget: ${triangles}`);
  assert.ok(game.renderer.options.antialias);
  const ambient = game.scene.children.find(node => node.isHemisphereLight);
  assert.ok(ambient.intensity < game.sun.intensity * 0.55, 'ambient light must not wash out the directional shading');
  assert.ok(game.scene.environment, 'glass needs a reflected environment');
});

test('real optimized GLB loads into 48 sectors prepared with 5633 actual PC fragments', async () => {
  const game = await engine();
  assert.equal(game.parts.length, 48);
  assert.equal(game.loaded, true);
  assert.equal(game.state, 'ready');
  const fragments = game.structuralFragments.stats();
  assert.equal(fragments.prepared, true);
  assert.equal(fragments.pieceCount, 5633);
  assert.equal(fragments.active, 0);
  assert.equal(game.erosion, undefined, 'PC collapse must not retain the stationary shader-erasure manager');
  for (const p of game.parts) {
    assert.ok(p.node && p.node.children.length);
    assert.ok(Math.abs(p.node.position.x - p.center.x) < 0.001);
    assert.ok(Math.abs(p.node.position.y - p.center.y) < 0.001);
    assert.ok(Math.abs(p.node.position.z - p.center.z) < 0.001);
    assert.equal(p.crumbleProgress, 0);
    assert.equal(p.phase, 'intact');
  }
});
for (const weapon of ['rocket', 'meteor', 'ball']) {
  test(`a horizontal ${weapon} above the roof cannot trigger damage or score`, async () => {
    const game = await engine(); game.aim.height = 30;
    assert.equal(game.fire(weapon), true);
    advance(game, 8);
    assert.equal(game.damage, 0); assert.equal(game.score, 0);
    assert.equal(game.structuralFragments.stats().active, 0);
    assert.ok(game.parts.every(p => p.phase === 'intact'));
    assert.ok(!game.events.some(e => e.name === 'impact'));
    assert.ok(game.events.some(e => e.name === 'miss'));
    assert.equal(game.state, 'finished');
  });
}
test('real triangle contact starts rocket damage and completes a finite round', async () => {
  const game = await engine(); game.fire('rocket');
  advance(game, 15);
  assert.ok(game.events.some(e => e.name === 'impact'));
  assert.ok(game.damage > 0 && game.score > 0);
  assert.equal(game.state, 'finished');
  assert.ok(game.shot.traveled > 60, 'rocket continues through the building');
  assert.ok(game.parts.filter(p => p.active).every(p => p.gone));
});
for (const [weapon, angle] of [['rocket', 0], ['meteor', 0], ['meteor', 20], ['ball', 0]]) {
  test(`${weapon} at ${angle} degrees penetrates the rear of the building`, async () => {
    const game = await engine(); game.aim.angle = angle;
    assert.equal(game.fire(weapon), true);
    advance(game, 4);
    assert.equal(game.shot.hit, true, 'only an actual building contact starts destruction');
    assert.equal(game.shot.stopped, false, 'every weapon continues after its entry contact');
    assert.ok(game.shot.traveled > 60, 'projectile must travel through and beyond the building');
    assert.ok(game.shot.penetrated.size >= 2, 'the rear-side geometry must receive a distinct contact');
    assert.ok(game.events.some(e => e.name === 'penetration'), 'the rear contact produces an exit response');
    assert.ok(game.damage > 0);
  });
}
test('pick still works after a completed shot and rebuilding', async () => {
  const game = await engine(); assert.equal(game.pick(195, 422), true);
  game.fire('rocket'); advance(game, 15); game.reset(); game.render();
  assert.equal(game.pick(195, 422), true);
});
test('the scene contains no people before, during, or after destruction', async () => {
  const game = await engine();
  function assertNoPeople() {
    assert.equal(game.peopleMesh, undefined, 'the pedestrian instanced mesh must be removed');
    assert.ok(!game.people || game.people.length === 0, 'no pedestrian simulation may remain active');
    game.scene.traverse(node => {
      assert.ok(!/people|pedestrian|person(?:_|$)/i.test(node.name), `unexpected pedestrian object: ${node.name}`);
    });
  }
  assertNoPeople(); game.fire('rocket'); advance(game, 2); game.render();
  assertNoPeople(); game.reset(); game.render(); assertNoPeople();
});
test('rendering alone never advances falling parents, actual fragments, or particles', async () => {
  const game = await engine(); game.fire('rocket'); advance(game, 2);
  assert.equal(game.shot.hit, true);
  const snapshot = () => ({
    time: game.time,
    parts: game.parts.map(p => [p.phase, p.crumbleProgress, p.node.position.x, p.node.position.y, p.node.position.z]),
    structural: game.parts.flatMap(p => game.structuralFragments.sample(p.id, 3)
      .map(f => [f.id, ...f.position.toArray(), ...f.quaternion.toArray(), ...f.velocity.toArray(), f.settled])),
    dust: game.dust.map(p => [p.p.x, p.p.y, p.p.z, p.age]),
    powder: [game.powder.stats().active, game.powder.stats().spawned],
  });
  const before = snapshot();
  for (let i = 0; i < 50; i++) game.render();
  assert.deepEqual(snapshot(), before);
});
test('projectile nose points along its velocity instead of backwards', async () => {
  const game = await engine(); game.fire('rocket');
  const nose = new T.Vector3(0, 0, -1).applyQuaternion(game.projectile.quaternion);
  assert.ok(nose.dot(game.shot.dir) > 0.99);
});
test('supported upward aim never spawns the projectile underground', async () => {
  const game = await engine(); game.aim.angle = -35; game.aim.height = 7;
  game.fire('rocket');
  assert.ok(game.projectile.position.y >= 0, 'negative launch angle currently starts below the ground');
});
test('repeated destruction and reset stays inside fixed pools without scene growth', async () => {
  const game = await engine(); const initial = resourceCounts(game);
  game.setQuality('low');
  for (let round = 0; round < 4; round++) {
    game.fire('meteor');
    advance(game, 15, g => {
      assert.ok(g.fragments.length <= g.profile.fragments);
      assert.ok(g.dust.length <= g.profile.dust);
      const powder = g.powder.stats();
      assert.ok(powder.active <= powder.capacity && powder.capacity <= powder.allocated);
      const structural = g.structuralFragments.stats();
      assert.ok(structural.active <= structural.pieceCount && structural.pieceCount === 5633);
    });
    game.reset(); game.render();
    assert.equal(game.fragments.length, 0); assert.equal(game.dust.length, 0);
    assert.equal(game.fragmentMesh.count, 0); assert.equal(game.dustMesh.count, 0);
    assert.equal(game.powder.stats().active, 0); assert.equal(game.powder.stats().spawned, 0);
    assert.equal(game.structuralFragments.stats().active, 0);
    assert.equal(game.structuralFragments.stats().moving, 0);
    assert.equal(game.structuralFragments.stats().settled, 0);
    assert.equal(game.damage, 0); assert.equal(game.score, 0);
    assert.ok(game.parts.every(p => !p.active && !p.gone && p.phase === 'intact' && p.crumbleProgress === 0 && p.node.visible && p.delay === Infinity));
    assert.ok(game.parts.every(p => p.node.position.distanceTo(p.rest) < 1e-6 && p.node.quaternion.angleTo(p.restQ) < 1e-6));
    assert.deepEqual(resourceCounts(game), initial);
  }
});
test('all quality modes respect their maximum mobile pixel and particle budgets', async () => {
  const game = await engine();
  for (const mode of ['low', 'balanced', 'high']) {
    game.setQuality(mode);
    assert.ok(game.canvas.width * game.canvas.height <= game.profile.maxPixels);
    assert.equal(game.renderer.shadowMap.enabled, game.profile.shadows);
    game.addDust(new T.Vector3(), 500); game.addFragments(new T.Vector3(), 600, 1);
    assert.equal(game.dust.length, game.profile.dust);
    assert.equal(game.fragments.length, game.profile.fragments);
  }
  game.setQuality('low');
  assert.ok(game.dust.length <= 45 && game.fragments.length <= 100);
});

test('a local hit schedules only blast-zone fracture; upper descent uses current support', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket');
  while (!game.shot.hit && game.time < 2) game.step(1 / 120);
  const hitFloor = game.parts.find(p => game.shot.penetrated.has(p.id)).floor;
  assert.ok(game.parts.filter(p=>Number.isFinite(p.delay)).every(p=>p.floor===hitFloor));
});

test('PC direct contact fractures the struck parent on the contact frame', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket');
  while (!game.shot.hit && game.time < 2) game.step(1 / 120);
  assert.ok(game.shot.hit, 'the fixture must reach an actual triangle');
  const part = game.parts.find(p => game.shot.penetrated.has(p.id));
  assert.ok(part);
  assert.equal(part.node.visible, false, 'PC direct contact immediately replaces the parent with its actual fragments');
  assert.equal(part.phase, 'fragmented');
  assert.equal(part.gone, true);
  assert.equal(part.crumbleProgress, 1);
  const fragments = game.structuralFragments.sample(part.id, 200);
  assert.ok(fragments.length > 10, 'the contact frame must contain actual small PC fragments');
  assert.ok(fragments.every(f => f.partId === part.id && Number.isFinite(f.position.y)));
  assert.ok(game.parts.some(p => p.node.visible && p.phase === 'intact'), 'unaffected architecture must remain visible');
});

for (const weapon of ['rocket', 'meteor', 'ball']) {
  test(`a fast ${weapon} sweep handles distinct contacts only inside its finite path`, async () => {
    const game = await engine(); game.fire(weapon);
    game.shot.speed = 10; game.step(.05);
    assert.equal(game.shot.hit, false, 'the sweep must not hit triangles ahead of this frame');
    assert.equal(game.damage, 0);
    game.shot.speed = 1500; game.step(.05);
    assert.ok(game.shot.penetrated.size >= 2, 'the rear-side contact must not be lost behind the first triangle');
    assert.equal(game.events.filter(e => e.name === 'impact').length, 1, 'many triangle intersections must not duplicate the entry explosion');
    assert.equal(game.events.filter(e => e.name === 'penetration').length, 1, 'many rear-side triangles must share one exit response');
  });
}

test('an already falling parent still receives a direct hit at its moved pose', async () => {
  const game = await engine(); game.aim.height = 11.5; game.fire('rocket'); game.scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(game.projectile.position, game.shot.dir, 0, 80);
  const contact = ray.intersectObjects(game.parts.map(p => p.node), true)[0];
  assert.ok(contact, 'the fixture must target actual parent triangles');
  const part = contact.object.userData.part;
  const localContact = part.node.worldToLocal(contact.point.clone());
  for (const lower of game.parts.filter(p => p.floor < part.floor)) {
    lower.direct = true;
    game.breakPart(lower);
  }
  game.breakPart(part);
  assert.equal(part.active, true);
  assert.equal(part.phase, 'falling');
  game.shot.speed = 0;
  advance(game, .2);
  assert.ok(part.node.position.y < part.rest.y - .15, 'loss of support must move the parent before fragmentation');
  assert.equal(part.node.visible, true);
  assert.equal(part.phase, 'falling');
  game.scene.updateMatrixWorld(true);
  const movedContact = part.node.localToWorld(localContact.clone());
  game.projectile.position.copy(movedContact).addScaledVector(game.shot.dir, -.4);
  game.shot.speed = 120;
  game.step(1 / 60);
  assert.ok(game.shot.penetrated.has(part.id), 'a falling parent must retain its real triangle collision surface');
  assert.equal(part.direct, true);
  assert.equal(part.node.visible, false, 'a direct contact immediately fragments an already falling parent');
  assert.equal(part.phase, 'fragmented');
  assert.ok(game.structuralFragments.sample(part.id, 50).length > 10);
});

test('connected upper architecture falls continuously until its contact front crushes', async () => {
  const game = await engine();
  for(const p of game.parts.filter(p=>p.floor===0)){p.direct=true;game.breakPart(p);}
  advance(game,.6);
  const upper=game.parts.filter(p=>p.floor>=2);
  assert.ok(upper.every(p=>p.active&&!p.gone&&p.node.position.y<p.rest.y-.8),'upper mass must move together and survive open-air descent');
  const shifts=upper.map(p=>p.node.position.y-p.rest.y);
  assert.ok(Math.max(...shifts)-Math.min(...shifts)<.03,'no floor-by-floor hover gaps');
  advance(game,8);
  assert.ok(game.parts.some(p=>p.floor>=4&&p.gone),'contact crushing must eventually consume upper architecture');
});

test('real PC sectors lean visibly toward missing side bearings before contact breakup', async () => {
  const game = await engine();
  for(const p of game.parts.filter(p=>p.floor===0&&p.center.x<0)){p.direct=true;game.breakPart(p);}
  advance(game,.5);
  const roof=game.parts.filter(p=>p.floor===5&&!p.gone);
  assert.ok(roof.length>=4,'open-air roof survives without an age fracture');
  assert.ok(roof.some(p=>p.node.quaternion.angleTo(p.restQ)>.07),'real source geometry must lean by more than four degrees');
  assert.ok(roof.reduce((s,p)=>s+p.node.position.x-p.rest.x,0)/roof.length<-.35,'missing left bearings must pull the roof left');
});

test('reactivating a resting sector retains its linear and angular momentum', async () => {
  const game=await engine(),p=game.parts[20];
  p.phase='resting';p.vel.set(1,-2,3);p.spin.set(.2,0,-.4);
  game.breakPart(p);
  assert.deepEqual(Array.from(p.vel.toArray()),[1,-2,3]);
  assert.deepEqual(Array.from(p.spin.toArray()),[.2,0,-.4]);
});

test('result cannot freeze an ongoing collapse after the minimum watch interval', async () => {
  const game=await engine();game.aim.height=1;game.fire('meteor');
  while(!game.shot.hit&&game.time<2)game.step(1/120);
  game.watchTime=10;game.hitStop=0;game.slow=0;
  game.step(1/30);
  assert.ok(game.structuralFragments.stats().moving>0,'fixture needs real airborne pieces');
  assert.equal(game.state,'watch','result modal must wait for physical settlement');
  advance(game,20);
  assert.equal(game.state,'finished');
  assert.equal(game.structuralFragments.stats().moving,0);
});

test('damage accounts for partial falling and completed fragmentation', async () => {
  const game = await engine(); game.fire('rocket');
  let sawPartialDamage = false;
  advance(game, 4, g => {
    const progress = g.parts.reduce((sum, p) => sum + p.crumbleProgress, 0);
    assert.equal(g.damage, Math.round(progress / 48 * 100));
    const activatedPercent = Math.round(g.parts.filter(p => p.active).length / 48 * 100);
    if (g.damage > 0 && g.damage < activatedPercent) sawPartialDamage = true;
  });
  assert.ok(sawPartialDamage, 'a falling parent contributes less than a fully fragmented sector');
});

test('progressive collapse emits dense fine powder and dust from real building damage', async () => {
  const game = await engine(); game.aim.height = 1; game.fire('meteor');
  assert.equal(game.powder.stats().spawned, 0);
  let maxPowder = 0, maxDust = 0, maxRenderedPowder = 0;
  advance(game, 6, g => {
    const stats = g.powder.stats();
    maxPowder = Math.max(maxPowder, stats.active);
    maxDust = Math.max(maxDust, g.dust.filter(p => !p.fire).length);
    assert.ok(stats.active <= stats.capacity);
    g.render();
    const powder = g.scene.getObjectByName('powder_grains');
    assert.ok(powder?.isPoints, 'fine grains must use the bounded point-particle renderer');
    maxRenderedPowder = Math.max(maxRenderedPowder, powder.geometry.drawRange.count);
  });
  assert.ok(maxPowder >= 300, `collapse must use dense fine particles, observed ${maxPowder}`);
  assert.ok(game.powder.stats().spawned >= 600, 'falling parents and real fragment impacts must continue to emit powder');
  assert.ok(maxDust > 0, 'fine airborne dust must accompany the granular powder');
  assert.ok(maxRenderedPowder >= 300, 'live powder must reach the renderer during the collapse');
});

test('every real GLB sector releases its corresponding original PC fragment geometry', async () => {
  const game = await engine();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/pc-fragments.json'), 'utf8'));
  assert.equal(manifest.pieces.length, 5633);
  assert.equal(new Set(manifest.pieces.map(p => p.partId)).size, 48);
  for (const part of game.parts) {
    part.direct = true;
    game.breakPart(part);
    const expected = manifest.pieces.filter(piece => piece.partId === part.id);
    const actual = game.structuralFragments.sample(part.id, 5633);
    assert.ok(expected.length > 10, `sector ${part.id} must have many smaller original fragments`);
    assert.deepEqual(Array.from(actual, piece => piece.id).sort((a, b) => a - b), expected.map(piece => piece.id).sort((a, b) => a - b));
    assert.ok(expected.every(piece => piece.sourceParent != null && piece.sourceMesh != null && piece.vertexCount > 0));
  }
  assert.equal(game.structuralFragments.stats().active, 5633);
  game.reset();
  assert.equal(game.structuralFragments.stats().active, 0);
  assert.ok(game.parts.every(part => game.structuralFragments.sample(part.id, 1).length === 0));
});

test('after twelve seconds actual small fragments remain as settled rubble', async () => {
  const game = await engine(); game.aim.height = 1; game.fire('meteor');
  advance(game, 12); game.render();
  const stats = game.structuralFragments.stats();
  assert.ok(stats.active > 300, 'the final state must retain many actual PC pieces');
  assert.equal(stats.moving, 0, 'the collapse must finish with stable debris');
  assert.equal(stats.settled, stats.active);
  assert.ok(game.events.some(e => e.name === 'floorImpact'), 'real fragment landing must drive the impact feedback');
  assert.ok(!game.fallingDebris || game.fallingDebris.length === 0, 'no synthetic delayed landing queue may replace actual falling pieces');
  const snapshot = () => game.parts.flatMap(p => Array.from(game.structuralFragments.sample(p.id, 3), f =>
    [f.id, ...f.position.toArray(), ...f.quaternion.toArray(), f.settled]));
  const before = snapshot();
  assert.ok(before.length > 0);
  advance(game, 2); game.render();
  assert.deepEqual(snapshot(), before, 'settled source geometry must persist after the visual effects expire');
  assert.equal(game.structuralFragments.stats().active, stats.active);
});
