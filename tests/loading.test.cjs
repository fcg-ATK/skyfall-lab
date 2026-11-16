'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { setImmediate: nextTurn } = require('node:timers/promises');
function loadAPI(fetch, extras = {}) {
  const context = vm.createContext({ fetch, AbortController, Response, Blob, Uint8Array,
    TextDecoder, DecompressionStream, setTimeout, clearTimeout, console, ...extras });
  context.window = context;
  const file = path.join(__dirname, '../dist/loading.js');
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  assert.equal(typeof context.SkyfallLoading?.createLoader, 'function', 'bounded asset loader is available');
  return context.SkyfallLoading;
}
test('a request that never returns headers rejects and aborts instead of spinning forever', async () => {
  let signal;
  const api = loadAPI((url, options) => { signal = options.signal; return new Promise(() => {}); });
  const loader = api.createLoader({ idleMs: 15, timeoutMs: 100 });
  await assert.rejects(loader.asset('model.glb', { label: '建筑', rawBytes: 4, compressed: false }), /建筑.*超时/);
  assert.equal(signal.aborted, true);
});
test('a response whose body stalls is also bounded, even after HTTP headers succeed', async () => {
  let signal;
  const api = loadAPI(async (url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); } }));
  });
  const updates = [];
  const loader = api.createLoader({ idleMs: 15, timeoutMs: 100, onProgress: p => updates.push(p.loaded) });
  await assert.rejects(loader.asset('fragments.bin', { label: '碎块', rawBytes: 4, compressed: false }), /碎块.*超时/);
  assert.equal(signal.aborted, true);
  assert.ok(updates.includes(2), 'actual partial bytes reach the UI before failure');
});
test('gzip transport restores exact original bytes and reports downloaded compressed bytes', async () => {
  const original = Buffer.from('a self-contained building '.repeat(200));
  const zipped = zlib.gzipSync(original); const urls = [], progress = [];
  const api = loadAPI(async url => { urls.push(url); return new Response(zipped, { headers: { 'Content-Length': String(zipped.length) } }); });
  const bytes = await api.createLoader({ onProgress: p => progress.push(p) }).asset('building.glb', { label: '建筑', rawBytes: original.length, gzipBytes: zipped.length });
  assert.deepEqual(Buffer.from(bytes), original);
  assert.deepEqual(urls, ['building.glb.gz']);
  assert.equal(progress.at(-1).loaded, zipped.length);
  assert.equal(progress.at(-1).total, zipped.length);
});
test('old browsers without decompression support load the unchanged raw asset', async () => {
  const urls = [];
  const api = loadAPI(async url => { urls.push(url); return new Response(new Uint8Array([1, 2, 3])); }, { DecompressionStream: undefined });
  const bytes = await api.createLoader().asset('raw.bin', { label: '模型', rawBytes: 3 });
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  assert.deepEqual(urls, ['raw.bin']);
});
test('missing compressed artifact falls back to raw but a timeout does not restart a larger download', async () => {
  const urls = [];
  const api = loadAPI(async url => { urls.push(url); return url.endsWith('.gz') ? new Response('missing', { status: 404 }) : new Response(new Uint8Array([8, 9])); });
  const bytes = await api.createLoader().asset('raw.bin', { label: '模型', rawBytes: 2 });
  assert.deepEqual([...new Uint8Array(bytes)], [8, 9]);
  assert.deepEqual(urls, ['raw.bin.gz', 'raw.bin']);
});
test('cancel rejects all outstanding downloads promptly', async () => {
  const api = loadAPI(() => new Promise(() => {}));
  const loader = api.createLoader();
  const job = loader.asset('model.glb', { label: '建筑', rawBytes: 4 });
  loader.cancel();
  await assert.rejects(job, /取消/);
});
test('a stalled decoder rejects at its own deadline', async () => {
  const api = loadAPI(async () => new Response());
  await assert.rejects(api.withTimeout(new Promise(() => {}), 10, '建筑解码'), /建筑解码.*超时/);
});

function fakeClock() {
  const timers = new Map(); let nextId = 0;
  return { timers,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fire(delay) {
      const matches = [...timers].filter(([, timer]) => timer.delay === delay);
      assert.ok(matches.length, 'the expected operation deadline is armed');
      for (const [id, timer] of matches) { timers.delete(id); timer.callback(); }
    },
  };
}

// A cancelled fetch may still deliver a response. Removing the post-header
// cancellation guard must fail these tests by consuming/retaining its body.
for (const reason of ['cancel', 'timeout']) test('late headers after ' + reason + ' discard the body without restarting timers', async () => {
  const clock = fakeClock(); let deliverHeaders, bodyCancelled = 0;
  const api = loadAPI(() => new Promise(resolve => { deliverHeaders = resolve; }), clock);
  const loader = api.createLoader({ idleMs: 10, timeoutMs: 100 });
  const job = loader.asset('fragments.bin', { label: '碎块', rawBytes: 4, compressed: false });
  if (reason === 'cancel') loader.cancel(); else clock.fire(10);
  await assert.rejects(job, reason === 'cancel' ? /取消/ : /超时/);
  const response = new Response(new ReadableStream({ cancel() { bodyCancelled++; } }));
  deliverHeaders(response); await nextTurn();
  assert.equal(bodyCancelled, 1, 'late response body is explicitly discarded');
  assert.equal(response.body.locked, false, 'cancelled work never acquires a reader');
  assert.equal(clock.timers.size, 0, 'late headers cannot restart an abandoned idle timer');
});

// Only the platform decoder boundary is replaced. Real Blob/ReadableStream
// cancellation is exercised, including an underlying cancel that never resolves.
function stalledDecoder() {
  let reading = false, cancellations = 0;
  return { reading: () => reading, cancellations: () => cancellations,
    DecompressionStream: class {
      constructor() {
        this.readable = new ReadableStream({
          pull() { reading = true; },
          cancel() { cancellations++; return new Promise(() => {}); },
        }, { highWaterMark: 0 });
        this.writable = new WritableStream();
      }
    },
  };
}

for (const reason of ['cancel', 'timeout']) test('decoder ' + reason + ' rejects promptly and cancels the underlying stream', async () => {
  const clock = fakeClock(), decoder = stalledDecoder();
  const api = loadAPI(async () => new Response(new Uint8Array([31, 139, 0, 0])),
    { ...clock, DecompressionStream: decoder.DecompressionStream });
  const loader = api.createLoader();
  let outcome = 'pending', error;
  const job = loader.asset('fragments.bin', { label: '碎块', rawBytes: 4 });
  job.then(() => { outcome = 'fulfilled'; }, reason => { outcome = 'rejected'; error = reason; });
  for (let tries = 0; tries < 10 && !decoder.reading(); tries++) await nextTurn();
  assert.equal(decoder.reading(), true, 'download finished and decompression is waiting for output');
  if (reason === 'cancel') loader.cancel(); else clock.fire(30000);
  await nextTurn();
  assert.equal(outcome, 'rejected', 'asset rejects without waiting for the decoder to finish cancelling');
  assert.match(error.message, reason === 'cancel' ? /取消/ : /超时/);
  assert.equal(decoder.cancellations(), 1, 'decoder work is cancelled rather than only its result ignored');
  assert.equal(clock.timers.size, 0, 'decoder wall timer is cleared');
});
