/* Bounded same-origin downloads. Gzip is lossless; old browsers keep raw assets. */
(function () {
  'use strict';
  function withTimeout(promise, milliseconds, label) {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超时，请重新加载')), milliseconds); });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  }
  function createLoader(options = {}) {
    const pending = new Set();
    const idleMs = options.idleMs ?? 25000, timeoutMs = options.timeoutMs ?? 180000;
    const report = options.onProgress || (() => {});
    let cancelled = false;
    function discard(stream) {
      // Cancellation must not wait for an unresponsive network/decoder source.
      try { stream?.cancel().catch(() => {}); } catch {}
    }
    async function download(url, label, expected) {
      if (cancelled) throw new Error('加载已取消');
      const controller = new AbortController();
      let idleTimer, deadlineTimer, reader, ended = false, loaded = 0, total = expected || 0;
      let fail;
      const stop = message => {
        if (ended) return;
        ended = true; fail(new Error(message)); controller.abort(); discard(reader);
      };
      const failure = new Promise((_, reject) => { fail = reject; });
      const cancel = () => stop('加载已取消'); pending.add(cancel);
      const activity = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => stop(label + '下载超时，请检查网络后重试'), idleMs); };
      activity(); deadlineTimer = setTimeout(() => stop(label + '下载超时，请检查网络后重试'), timeoutMs);
      const work = (async () => {
        report({ url, label, loaded, total });
        const response = await fetch(url, { signal: controller.signal });
        if (ended || cancelled) { discard(response.body); throw new Error('加载已取消'); }
        if (!response.ok) { const error = new Error(label + '下载失败（HTTP ' + response.status + '）'); error.status = response.status; throw error; }
        activity(); total = Number(response.headers?.get('Content-Length')) || total;
        let bytes;
        if (response.body?.getReader) {
          reader = response.body.getReader(); const chunks = [];
          for (;;) {
            const chunk = await reader.read();
            if (ended) throw new Error('加载已取消');
            if (chunk.done) break;
            chunks.push(chunk.value); loaded += chunk.value.byteLength; activity();
            report({ url, label, loaded, total: Math.max(total, loaded) });
          }
          bytes = new Uint8Array(loaded); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        } else {
          bytes = new Uint8Array(await response.arrayBuffer()); loaded = bytes.byteLength;
        }
        if (ended) throw new Error('加载已取消');
        report({ url, label, loaded, total: loaded });
        return bytes.buffer;
      })();
      try { return await Promise.race([work, failure]); }
      catch (error) { controller.abort(); discard(reader); throw error; }
      finally {
        ended = true; clearTimeout(idleTimer); clearTimeout(deadlineTimer); pending.delete(cancel);
        try { reader?.releaseLock(); } catch {}
      }
    }
    async function decompress(bytes, label) {
      if (cancelled) throw new Error('加载已取消');
      let reader, ended = false, fail;
      const chunks = [];
      const failure = new Promise((_, reject) => { fail = reject; });
      const stop = message => {
        if (ended) return;
        ended = true; chunks.length = 0; fail(new Error(message)); discard(reader);
      };
      const cancel = () => stop('加载已取消'); pending.add(cancel);
      const timer = setTimeout(() => stop(label + '解压超时，请重新加载'), 30000);
      const work = (async () => {
        reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
        let length = 0;
        for (;;) {
          const chunk = await reader.read();
          if (ended) throw new Error('加载已取消');
          if (chunk.done) break;
          chunks.push(chunk.value); length += chunk.value.byteLength;
        }
        const output = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        return output.buffer;
      })();
      try { return await Promise.race([work, failure]); }
      catch (error) { discard(reader); throw error; }
      finally {
        ended = true; chunks.length = 0; clearTimeout(timer); pending.delete(cancel);
        try { reader?.releaseLock(); } catch {}
      }
    }
    async function asset(url, settings = {}) {
      const label = settings.label || '资源';
      let compressed = settings.compressed !== false && typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Blob.prototype.stream === 'function';
      if (compressed) { try { new DecompressionStream('gzip'); } catch { compressed = false; } }
      let bytes;
      if (compressed) {
        try {
          bytes = await download(url + '.gz', label, settings.gzipBytes);
        } catch (error) {
          // An older deployment may not have generated compressed siblings yet.
          // A stalled network is not retried with a much bigger raw download.
          if (error.status !== 404) throw error;
          compressed = false;
        }
      }
      if (!compressed) bytes = await download(url, label, settings.rawBytes);
      if (compressed) {
        const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
        if (header[0] === 31 && header[1] === 139) {
          try {
            bytes = await decompress(bytes, label);
          } catch (error) { throw new Error(label + '解压失败，请重新加载（' + error.message + '）'); }
        }
      }
      if (cancelled) throw new Error('加载已取消');
      if (settings.rawBytes && bytes.byteLength !== settings.rawBytes) throw new Error(label + '数据不完整，请重新加载');
      return bytes;
    }
    return { asset, cancel() { cancelled = true; for (const stop of pending) stop(); } };
  }
  window.SkyfallLoading = Object.freeze({ createLoader, withTimeout });
})();
