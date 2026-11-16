const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise app.js itself: synthetic browser events, no duplicate gesture implementation.
const source = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');

async function boot() {
  const raf = new Map(), timers = new Map(), elements = new Map();
  let nextRaf = 0, nextTimer = 0, engine;
  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatch(type, data = {}) {
      const event = { type, target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
      for (const callback of this.listeners.get(type) || []) callback(event);
      this['on' + type]?.(event);
      return event;
    }
  }
  const document = new EventTarget();
  class Element extends EventTarget {
    constructor(id) {
      super(); this.id = id; this.tagName = 'BUTTON'; this.hidden = false; this.disabled = false;
      this.style = {}; this.dataset = {}; this.attributes = {}; this.textContent = ''; this.innerHTML = '';
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    setPointerCapture(id) { this.captured = id; }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.dispatch('click'); }
    querySelectorAll() { return this.id === 'help' ? [get('closeHelp')] : [get('inspect'), get('again')]; }
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }
  document.getElementById = get;
  const weapons = ['rocket', 'meteor', 'ball'].map(name => { const element = get(name); element.dataset.weapon = name; return element; });
  document.querySelectorAll = selector => selector === '[data-weapon]' ? weapons : [];
  document.activeElement = { tagName: 'BODY', focus() {} };
  document.hidden = false; document.documentElement = {};
  for (const id of ['help', 'result', 'aimPanel', 'toast', 'retry']) get(id).hidden = true;
  get('world').tagName = 'CANVAS'; get('height').tagName = get('angle').tagName = 'INPUT';
  class SkyfallEngine {
    constructor(canvas, onEvent) {
      engine = this; this.canvas = canvas; this.onEvent = onEvent; this.loaded = false;
      this.state = 'ready'; this.score = 0; this.damage = 0;
      this.orbit = { yaw: .7, pitch: .4, distance: 65, height: 10 };
      this.aim = { height: 7, angle: 0 }; this.profile = { targetFps: 60 };
      this.picks = []; this.fires = []; this.steps = []; this.renders = 0; this.resizes = 0;
    }
    async load() { this.loaded = true; }
    direction() {}
    setQuality(value) { this.quality = value; }
    pick(x, y) { this.picks.push([x, y]); return true; }
    fire(value) { this.fires.push(value); }
    reset() { this.state = 'ready'; }
    resetCamera() {}
    resize() { this.resizes++; }
    step(dt) { this.steps.push(dt); }
    render() { this.renders++; }
  }
  const window = new EventTarget(); window.visualViewport = new EventTarget();
  const sandbox = { document, window, SkyfallEngine, console,
    location: { protocol: 'http:', reload() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    requestAnimationFrame(callback) { const id = ++nextRaf; raf.set(id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  await vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  return { document, window, engine, get, raf,
    pointer(type, id, x, y) { return get('world').dispatch(type, { pointerId: id, clientX: x, clientY: y }); },
    frame(time) { const queued = [...raf.values()]; raf.clear(); for (const callback of queued) callback(time); },
  };
}

test('single-finger drag rotates horizontally and vertically without selecting a target', async () => {
  const h = await boot(), before = { ...h.engine.orbit };
  h.pointer('pointerdown', 1, 100, 100);
  h.pointer('pointermove', 1, 140, 120);
  h.pointer('pointerup', 1, 140, 120);
  assert.ok(h.engine.orbit.yaw < before.yaw);
  assert.ok(h.engine.orbit.pitch > before.pitch);
  assert.equal(h.engine.orbit.distance, before.distance);
  assert.equal(h.engine.picks.length, 0);
});

test('small tap selects the building instead of rotating', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100);
  h.pointer('pointermove', 1, 102, 102);
  h.pointer('pointerup', 1, 102, 102);
  assert.equal(h.engine.orbit.yaw, yaw);
  assert.deepEqual(h.engine.picks, [[102, 102]]);
});

test('pinch-out moves the camera closer and pinch-in moves it away', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 300, 100);
  assert.equal(h.engine.orbit.distance, 32.5);
  h.pointer('pointermove', 2, 200, 100);
  assert.equal(h.engine.orbit.distance, 65);
});

test('two-finger vertical drag changes target height without orbiting', async () => {
  const h = await boot(), before = { ...h.engine.orbit };
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 1, 100, 140); h.pointer('pointermove', 2, 200, 140);
  assert.ok(Math.abs(h.engine.orbit.height - 12.2) < 1e-10);
  assert.ok(Math.abs(h.engine.orbit.distance - before.distance) < 1e-10);
  assert.equal(h.engine.orbit.yaw, before.yaw); assert.equal(h.engine.orbit.pitch, before.pitch);
});

test('lifting the second finger never turns the remaining finger into a tap', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointerup', 2, 200, 100); h.pointer('pointerup', 1, 100, 100);
  assert.equal(h.engine.picks.length, 0);
  h.pointer('pointerdown', 3, 110, 110); h.pointer('pointerup', 3, 110, 110);
  assert.deepEqual(h.engine.picks, [[110, 110]]);
});

test('remaining finger can continue rotating after pinch without a sudden jump', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 230, 100); h.pointer('pointerup', 2, 230, 100);
  const before = h.engine.orbit.yaw;
  h.pointer('pointermove', 1, 110, 100);
  assert.ok(Math.abs(h.engine.orbit.yaw - (before - .07)) < 1e-10);
  h.pointer('pointerup', 1, 110, 100); assert.equal(h.engine.picks.length, 0);
});

test('pointercancel clears stale movement and never selects a target', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointercancel', 1, 100, 100);
  h.pointer('pointermove', 1, 300, 250); h.pointer('pointerup', 1, 300, 250);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerup', 1, 100, 100);
  assert.equal(h.engine.picks.length, 1);
});

test('lostpointercapture clears stale pointer state', async () => {
  const h = await boot(), yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('lostpointercapture', 1, 100, 100);
  h.pointer('pointermove', 1, 200, 200); h.pointer('pointerup', 1, 200, 200);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
});

test('pinch camera distance and two-finger height remain within safe limits', async () => {
  const h = await boot();
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointerdown', 2, 200, 100);
  h.pointer('pointermove', 2, 10000, 100);
  assert.equal(h.engine.orbit.distance, 19);
  h.pointer('pointermove', 2, 106, 100);
  assert.equal(h.engine.orbit.distance, 115);
  h.pointer('pointermove', 1, 100, 10000); h.pointer('pointermove', 2, 106, 10000);
  assert.equal(h.engine.orbit.height, 33);
});

test('hiding the page cancels RAF and clears gestures; returning schedules one RAF without a time jump', async () => {
  const h = await boot(); h.frame(1); h.frame(34);
  assert.equal(h.engine.steps.length, 1); assert.equal(h.raf.size, 1);
  h.pointer('pointerdown', 1, 100, 100);
  h.document.hidden = true; h.document.dispatch('visibilitychange');
  assert.equal(h.raf.size, 0);
  h.frame(100000); assert.equal(h.engine.steps.length, 1);
  h.document.hidden = false; h.document.dispatch('visibilitychange');
  assert.equal(h.raf.size, 1);
  h.frame(200000); assert.equal(h.engine.steps.length, 1);
  h.frame(200034); assert.equal(h.engine.steps.length, 2);
  assert.ok(h.engine.steps[1] < .05);
  h.pointer('pointerup', 1, 100, 100); assert.equal(h.engine.picks.length, 0);
});

test('open help blocks firing, orbit and tap, and pauses simulation', async () => {
  const h = await boot(); h.get('helpBtn').click();
  assert.equal(h.get('help').hidden, false);
  h.get('fire').click(); h.document.dispatch('keydown', { code: 'Space' });
  assert.equal(h.engine.fires.length, 0);
  const yaw = h.engine.orbit.yaw;
  h.pointer('pointerdown', 1, 100, 100); h.pointer('pointermove', 1, 200, 100); h.pointer('pointerup', 1, 200, 100);
  assert.equal(h.engine.orbit.yaw, yaw); assert.equal(h.engine.picks.length, 0);
  h.frame(1); h.frame(34); assert.equal(h.engine.steps.length, 0);
  h.get('closeHelp').click(); h.get('fire').click(); assert.equal(h.engine.fires.length, 1);
});

test('result modal also blocks fire until inspection closes it', async () => {
  const h = await boot(); h.engine.onEvent('finished', { score: 1500, damage: 75 });
  assert.equal(h.get('result').hidden, false);
  h.get('fire').click(); assert.equal(h.engine.fires.length, 0);
  h.get('inspect').click(); h.get('fire').click(); assert.equal(h.engine.fires.length, 1);
});

test('both window and visual viewport resizing update the engine viewport', async () => {
  const h = await boot(); h.window.dispatch('resize'); h.window.visualViewport.dispatch('resize');
  assert.equal(h.engine.resizes, 2);
});
