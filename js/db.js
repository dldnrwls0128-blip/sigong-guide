/* IndexedDB 래퍼: kv(상태 JSON) + photos(사진 dataURL) */
window.DB = (function () {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('sigong-guide', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const req = fn(s);
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    get: k => tx('kv', 'readonly', s => s.get(k)),
    set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
    putPhoto: p => tx('photos', 'readwrite', s => s.put(p)),
    getPhoto: id => tx('photos', 'readonly', s => s.get(id)),
    delPhoto: id => tx('photos', 'readwrite', s => s.delete(id)),
    allPhotos: () => tx('photos', 'readonly', s => s.getAll()),
    clearPhotos: () => tx('photos', 'readwrite', s => s.clear())
  };
})();
