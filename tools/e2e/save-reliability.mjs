// Real storage failure regression, in isolated browser contexts; never uses a player's profile.
// CHROME=<headless shell> [URL=<dev server>] node tools/e2e/save-reliability.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  for (const backend of ['indexeddb', 'localstorage']) {
    const context = await browser.newContext();
    if (backend === 'localstorage') await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
    const page = await context.newPage();
    await page.goto(process.env.URL ?? 'http://127.0.0.1:47173/');
    await page.waitForFunction(() => window.G && window.ui?.screen === 'menu');
    const result = await page.evaluate(async (backend) => {
      const G = window.G, vfs = G.$.vfs;
      const prefix = 'user://reliability-test/', path = prefix + 'probe.save';
      const io = new G.GodotFileIo().$ctor_GodotFileIo(prefix.slice(0, -1));
      const disk = async () => {
        if (backend === 'localstorage') return [localStorage.getItem('sts2fs:' + path), localStorage.getItem('sts2fs:' + path + '.backup')];
        const db = await new Promise((ok, fail) => { const r = indexedDB.open('sts2fs', 1); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
        const st = db.transaction('files').objectStore('files');
        const read = (p) => new Promise((ok, fail) => { const r = st.get(p); r.onsuccess = () => ok(r.result ?? null); r.onerror = () => fail(r.error); });
        const values = await Promise.all([read(path), read(path + '.backup')]);
        db.close();
        return values;
      };
      io.WriteFile$String_String('probe.save', '{"version":1}');
      await disk();
      io.WriteFile$String_String('probe.save', '{"version":2}');
      const before = await disk();
      const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem;
      let reported = 0, rejected = false;
      G.$.setStorageErrorHandler(() => reported++);
      if (backend === 'indexeddb') IDBObjectStore.prototype.put = function (value, key) {
        const r = put.call(this, value, key);
        if (String(key).startsWith(prefix)) queueMicrotask(() => this.transaction.abort());
        return r;
      };
      else Storage.prototype.setItem = function (key, value) {
        if (key === 'sts2fs:' + path || key === 'sts2fs:' + path + '.tmp') throw new DOMException('Injected full storage', 'QuotaExceededError');
        return set.call(this, key, value);
      };
      try { await io.WriteFileAsync$String_String('probe.save', '{"version":3}'); } catch { rejected = true; }
      const after = await disk();
      IDBObjectStore.prototype.put = put;
      Storage.prototype.setItem = set;
      const memory = vfs.read(path);
      await io.WriteFileAsync$String_String('probe.save', '{"version":4}');
      await vfs.flush();
      const retried = await disk();
      let queued;
      if (backend === 'indexeddb') {
        let aborted = false;
        IDBObjectStore.prototype.put = function (value, key) {
          const r = put.call(this, value, key);
          if (!aborted && String(key).startsWith(prefix)) { aborted = true; queueMicrotask(() => this.transaction.abort()); }
          return r;
        };
        const a = vfs.writeSave(path, '{"version":5}');
        const b = vfs.writeSave(path, '{"version":6}');
        await Promise.allSettled([a, b]);
        IDBObjectStore.prototype.put = put;
        await vfs.flush();
        queued = await disk();
      }
      return { backend: vfs.backend, before, after, rejected, reported, memory, retried, queued };
    }, backend);
    assert.equal(result.backend, backend);
    assert.deepEqual(result.before, ['{"version":2}', '{"version":1}']);
    assert.equal(result.after[0], '{"version":2}', `${backend}: failed save destroyed the previous primary: ${JSON.stringify(result)}`);
    if (backend === 'indexeddb') assert.equal(result.after[1], '{"version":1}');
    assert.equal(result.memory, '{"version":2}');
    assert.equal(result.rejected, true, `${backend}: async write reported success before commit`);
    assert.ok(result.reported > 0);
    assert.deepEqual(result.retried, ['{"version":4}', '{"version":2}']);
    if (backend === 'indexeddb') {
      assert.deepEqual(result.queued, ['{"version":6}', '{"version":4}']);
    }
    console.log('OK', backend, result);
    await context.close();
  }
} finally { await browser.close(); }
