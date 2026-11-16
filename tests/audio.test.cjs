const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Web Audio is unavailable in node. This boundary double records scheduled sources,
// graph connections and time; all voice limits and lifecycle decisions run in audio.js.
function boot(options = {}) {
  const contexts = [];
  class Param {
    constructor(value = 0) { this.value = value; this.events = []; }
    setValueAtTime(value, at) { this.value = value; this.events.push({ value, at }); }
    linearRampToValueAtTime(value, at) { this.setValueAtTime(value, at); }
    exponentialRampToValueAtTime(value, at) { assert.ok(value > 0); this.setValueAtTime(value, at); }
    cancelScheduledValues() {}
  }
  class Node {
    constructor(context, kind) {
      this.context = context; this.kind = kind; this.connections = [];
      for (const name of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate']) this[name] = new Param();
    }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections = []; }
    start(at = 0) { this.started = at; }
    stop(at = 0) { this.stopAt = at; }
  }
  class AudioContext {
    constructor() {
      if (options.failContext) throw Error('Audio unavailable');
      contexts.push(this); this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended';
      this.nodes = []; this.sources = []; this.destination = new Node(this, 'destination');
      this.blockedResumes = [];
    }
    node(kind, source = false) { const node = new Node(this, kind); this.nodes.push(node); if (source) this.sources.push(node); return node; }
    createGain() { return this.node('gain'); }
    createBiquadFilter() { return this.node('filter'); }
    createDynamicsCompressor() { return this.node('compressor'); }
    createBufferSource() { return this.node('noise', true); }
    createOscillator() { return this.node('tone', true); }
    createBuffer(channels, size, sampleRate) { return { duration: size / sampleRate, getChannelData() { return new Float32Array(size); } }; }
    async resume() {
      // Without user activation the platform may leave resume pending, not reject it.
      // A later allowed native resume also settles earlier pending resume requests.
      if (options.requireActivation && !options.activated) await new Promise(resolve => { this.blockedResumes.push(resolve); });
      if (options.deferResume) await new Promise(resolve => { this.finishResume = resolve; });
      this.state = 'running';
      for (const resolve of this.blockedResumes.splice(0)) resolve();
    }
    async suspend() { this.state = 'suspended'; }
    advance(time) {
      this.currentTime += time;
      for (const source of this.sources) if (!source.ended && source.stopAt <= this.currentTime) {
        source.ended = true; source.onended?.();
      }
    }
  }
  const window = options.unavailable ? {} : { AudioContext };
  const file = path.join(__dirname, '../dist/audio.js');
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, console, Float32Array, Math }, { filename: 'audio.js' });
  assert.equal(typeof window.SkyfallAudio, 'function', 'audio.js exposes SkyfallAudio');
  const audio = new window.SkyfallAudio();
  return { audio, window, contexts, activate() { options.activated = true; },
    live: () => contexts.flatMap(c => c.sources.filter(s => s.connections.length && s.stopAt > c.currentTime)) };
}

test('audio is silent before a gesture and unlock reuses one AudioContext', async () => {
  const h = boot();
  h.audio.play('impact', { weapon: 'rocket' });
  assert.equal(h.contexts.length, 0);
  await h.audio.unlock(); await h.audio.unlock();
  assert.equal(h.contexts.length, 1);
  h.audio.play('impact', { weapon: 'rocket' });
  assert.ok(h.live().length >= 2);
});

test('mute, pause and hidden-page transitions stop every existing source and prevent new sounds', async () => {
  for (const [method, blocked, unblocked] of [['setEnabled', false, true], ['setPaused', true, false], ['setHidden', true, false]]) {
    const h = boot(); await h.audio.unlock();
    h.audio.play('floorImpact', { floor: 1, weapon: 'meteor', energy: 1 });
    assert.ok(h.live().length > 0);
    h.audio[method](blocked);
    assert.equal(h.live().length, 0, method + ' cancels tails');
    const count = h.contexts[0].sources.length;
    h.audio.play('impact', { weapon: 'rocket' }); await h.audio.unlock();
    assert.equal(h.contexts[0].sources.length, count, method + ' blocks scheduling');
    h.audio[method](unblocked); await h.audio.unlock();
    h.audio.play('impact', { weapon: 'ball' });
    assert.ok(h.live().length > 0, method + ' permits future audio');
  }
});

test('reset kills rubble tails and releases per-floor throttles for the next building', async () => {
  const h = boot(); await h.audio.unlock();
  h.audio.play('floorImpact', { floor: 3, energy: 1 });
  assert.ok(h.live().some(s => s.stopAt >= .95), 'debris lasts about a second');
  h.audio.reset();
  assert.equal(h.live().length, 0);
  h.audio.play('floorImpact', { floor: 3, energy: 1 });
  assert.ok(h.live().length > 0);
});

test('repeated events from one floor are throttled without silencing different floors', async () => {
  const h = boot(); await h.audio.unlock();
  h.audio.play('floorImpact', { floor: 4, energy: 1 });
  const first = h.contexts[0].sources.length;
  for (let i = 0; i < 100; i++) h.audio.play('floorImpact', { floor: 4, energy: 1 });
  assert.equal(h.contexts[0].sources.length, first);
  h.audio.play('floorImpact', { floor: 5, energy: 1 });
  assert.ok(h.contexts[0].sources.length > first);
  h.contexts[0].advance(.5);
  const count = h.contexts[0].sources.length;
  h.audio.play('floorImpact', { floor: 4, energy: 1 });
  assert.ok(h.contexts[0].sources.length > count);
});

test('a simultaneous collapse never leaves more than 28 active sources', async () => {
  const h = boot(); await h.audio.unlock();
  for (let floor = 0; floor < 150; floor++) {
    h.audio.play('fracture', { floor, energy: 1 });
    h.audio.play('floorImpact', { floor, energy: 1 });
    assert.ok(h.live().length <= 28, 'bounded graph during a collapse');
  }
  const c = h.contexts[0];
  assert.ok(c.nodes.some(n => n.kind === 'compressor' && n.ratio.value >= 6), 'all effects use a limiter');
  assert.ok(c.sources.every(s => s.connections.every(n => n !== c.destination)), 'no voice bypasses the master chain');
  c.advance(3);
  assert.equal(h.live().length, 0);
  assert.ok(c.sources.every(s => !s.connections.length), 'expired sources disconnect');
});

test('rocket, meteor and iron-ball impacts have distinct pitch and duration envelopes', async () => {
  const signatures = [];
  for (const weapon of ['rocket', 'meteor', 'ball']) {
    const h = boot(); await h.audio.unlock(); h.audio.play('impact', { weapon });
    const sources = h.contexts[0].sources;
    signatures.push(JSON.stringify(sources.map(s => [s.kind, s.type, s.stopAt, s.frequency.events])));
    assert.ok(sources.some(s => s.kind === 'tone'), 'impact has body');
    assert.ok(sources.some(s => s.kind === 'noise'), 'impact has a crack/transient');
  }
  assert.equal(new Set(signatures).size, 3);
});

test('all supported events end cleanly and unknown events allocate no nodes', async () => {
  const h = boot(); await h.audio.unlock();
  for (const type of ['launch', 'impact', 'penetration', 'fracture', 'floorImpact']) {
    h.audio.play(type, { weapon: 'rocket', floor: 1, energy: 1 });
    assert.ok(h.live().length > 0, type + ' produces audio');
    h.contexts[0].advance(3); assert.equal(h.live().length, 0);
  }
  const count = h.contexts[0].nodes.length;
  h.audio.play('score', {}); assert.equal(h.contexts[0].nodes.length, count);
});

test('missing or unavailable Web Audio never throws or blocks gameplay', async () => {
  for (const options of [{ unavailable: true }, { failContext: true }]) {
    const h = boot(options); await h.audio.unlock();
    assert.doesNotThrow(() => {
      h.audio.play('impact', { weapon: 'rocket' }); h.audio.setEnabled(false);
      h.audio.setPaused(true); h.audio.setHidden(true); h.audio.reset();
    });
    assert.equal(h.contexts.length, 0);
  }
});

test('the initial launch waits for browser resume, and reset or mute cancels a queued launch', async () => {
  for (const cancel of [null, 'reset', 'mute']) {
    const h = boot({ deferResume: true }), unlocking = h.audio.unlock();
    h.audio.play('launch', { weapon: 'rocket' });
    assert.equal(h.live().length, 0);
    if (cancel === 'reset') h.audio.reset();
    if (cancel === 'mute') h.audio.setEnabled(false);
    h.contexts[0].finishResume(); await unlocking;
    if (cancel) assert.equal(h.live().length, 0, cancel + ' invalidates pending playback');
    else assert.ok(h.live().length > 0, 'a delayed browser resume must not swallow the first launch');
  }
});

test('an activated unlock retries native resume after an earlier blocked request stays pending', async () => {
  const h = boot({ requireActivation: true });
  h.audio.unlock(); h.audio.play('launch', { weapon: 'rocket' });
  assert.equal(h.live().length, 0);
  h.activate(); h.audio.unlock();
  await new Promise(setImmediate);
  assert.ok(h.live().length > 0, 'the queued launch plays after a fresh activated resume');
});

async function bootApp(options = {}) {
  const h = boot(options), elements = new Map(); let engine;
  const target = () => ({ listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); } });
  const document = { ...target(), hidden: Boolean(options.initialHidden), activeElement: { tagName: 'BODY' }, querySelectorAll() { return []; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { ...target(), id, style: {}, hidden: ['help', 'result'].includes(id),
        setAttribute() {}, focus() {}, querySelectorAll() { return []; } });
      return elements.get(id);
    } };
  Object.assign(h.window, target());
  class SkyfallEngine {
    constructor(canvas, onEvent) {
      engine = this; this.onEvent = onEvent; this.score = this.damage = 0; this.state = 'ready';
      this.aim = { height: 7, angle: 0 }; this.profile = { targetFps: 60 };
    }
    async load() { await options.duringLoad?.({ document, ...h }); this.loaded = true; }
    setQuality() {}
    direction() {}
    reset() { this.onEvent('reset'); }
  }
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), {
    window: h.window, document, SkyfallEngine, console, localStorage: { getItem() { return null; }, setItem() {} },
    location: { protocol: 'http:' }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  }, { filename: 'app.js' });
  return { ...h, document, engine, get: id => document.getElementById(id) };
}

test('the first page interaction unlocks real audio and engine floor events reach the audio graph', async () => {
  const h = await bootApp();
  assert.equal(h.contexts.length, 0);
  h.document.dispatch('pointerdown'); await Promise.resolve();
  assert.equal(h.contexts.length, 1);
  h.engine.onEvent('floorImpact', { weapon: 'meteor', floor: 1, energy: 1 });
  assert.ok(h.live().length > 0);
});

for (const event of ['pointerup', 'touchend', 'click']) {
  test(event + ' unlocks touch audio even when pointerdown was not an activating gesture', async () => {
    const h = await bootApp({ requireActivation: true });
    h.document.dispatch('pointerdown', { pointerType: 'touch' });
    assert.equal(h.live().length, 0);
    h.activate(); h.document.dispatch(event, { pointerType: 'touch' });
    await new Promise(setImmediate);
    h.engine.onEvent('launch', { weapon: 'rocket' });
    assert.ok(h.live().length > 0, event + ' reaches an allowed native resume');
  });
}

test('a page loaded in the background can play audio after becoming visible during scene loading', async () => {
  const h = await bootApp({ initialHidden: true, duringLoad({ document }) {
    document.hidden = false; document.dispatch('visibilitychange');
  } });
  h.document.dispatch('pointerdown'); await new Promise(setImmediate);
  h.engine.onEvent('launch', { weapon: 'rocket' });
  assert.ok(h.live().length > 0, 'the loading-period visibility transition reaches audio');
});

test('hiding the page during scene loading clears audio before load finishes', async () => {
  let before, after, sourceCount;
  await bootApp({ async duringLoad({ document, contexts, live }) {
    document.dispatch('pointerdown'); await new Promise(setImmediate);
    before = contexts[0].state;
    document.hidden = true; document.dispatch('visibilitychange');
    after = contexts[0].state; sourceCount = live().length;
  } });
  assert.equal(before, 'running');
  assert.equal(after, 'suspended', 'audio visibility listener is present during load');
  assert.equal(sourceCount, 0);
});

test('app reset, mute, pause, help and page visibility terminate active audio', async () => {
  for (const action of ['reset', 'sound', 'pauseBtn', 'helpBtn', 'visibilitychange']) {
    const h = await bootApp(); h.document.dispatch('pointerdown'); await Promise.resolve();
    h.engine.onEvent('floorImpact', { weapon: 'rocket', floor: 1, energy: 1 });
    assert.ok(h.live().length > 0, action + ' begins with active sound');
    if (action === 'visibilitychange') { h.document.hidden = true; h.document.dispatch(action); }
    else h.get(action).onclick();
    assert.equal(h.live().length, 0, action + ' clears residual sounds');
  }
});
