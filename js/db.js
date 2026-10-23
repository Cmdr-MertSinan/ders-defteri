const DB = (() => {
  const NAME = "ders-defteri";
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("courses")) {
          db.createObjectStore("courses", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("weeks")) {
          const weeks = db.createObjectStore("weeks", { keyPath: "id" });
          weeks.createIndex("byCourse", "courseId");
        }
        if (!db.objectStoreNames.contains("files")) {
          const files = db.createObjectStore("files", { keyPath: "id" });
          files.createIndex("byWeek", "weekId");
        }
        if (!db.objectStoreNames.contains("summaries")) {
          db.createObjectStore("summaries", { keyPath: "weekId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const result = fn(s);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }

  function all(store, index, query) {
    return new Promise(async (resolve, reject) => {
      const db = await open();
      const t = db.transaction(store, "readonly");
      const s = index ? t.objectStore(store).index(index) : t.objectStore(store);
      const req = query !== undefined ? s.getAll(query) : s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function get(store, id) {
    return new Promise(async (resolve, reject) => {
      const db = await open();
      const t = db.transaction(store, "readonly");
      const req = t.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function put(store, value) {
    return tx(store, "readwrite", (s) => s.put(value));
  }

  function del(store, id) {
    return tx(store, "readwrite", (s) => s.delete(id));
  }

  function uid() {
    return crypto.randomUUID();
  }

  return { open, all, get, put, del, uid };
})();
