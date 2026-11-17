'use strict';
// CPU/geometry integration checks. Renderer and canvas are stubs; this does not
// verify GPU rendering, shader compilation, browser touch input, or phone FPS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../dist');
const physics = require('../../dist/physics.js');

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
for (const file of ['collapse-solver.js','fragment-contact.js','structural-fragments.js', 'structure-detail.js', 'target-highlight.js', 'powder.js', 'impact-fx.js']) if (fs.existsSync(path.join(root, file)))
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'loading.js'), 'utf8'), context);
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
module.exports={engine,advance,T,context,makeCanvas,root,imageSize};
