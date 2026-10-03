/**
 * Spendly IndexedDB Client for Offline Storage & Synchronisation Queue
 */
const DB_NAME = 'spendly_offline_db';
const DB_VERSION = 1;

let dbPromise = null;

function getDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offline_queue')) {
        db.createObjectStore('offline_queue', { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains('local_cache')) {
        db.createObjectStore('local_cache', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Queue an offline action (e.g. personal or group expense)
 */
async function queueOfflineAction(action) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    const req = store.put({
      idempotencyKey: action.idempotencyKey || crypto.randomUUID(),
      endpoint: action.endpoint,
      method: action.method || 'POST',
      body: action.body,
      timestamp: Date.now()
    });
    req.onsuccess = () => resolve(action);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all queued offline actions
 */
async function getOfflineQueue() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offline_queue', 'readonly');
    const store = tx.objectStore('offline_queue');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove an action from the offline queue after successful server sync
 */
async function removeOfflineAction(idempotencyKey) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    const req = store.delete(idempotencyKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Cache data locally
 */
async function setCache(key, data) {
  try {
    const db = await getDb();
    const tx = db.transaction('local_cache', 'readwrite');
    tx.objectStore('local_cache').put({ key, data, cachedAt: Date.now() });
  } catch (err) {
    console.warn('[Spendly IDB] Cache error:', err);
  }
}

/**
 * Retrieve cached data
 */
async function getCache(key) {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction('local_cache', 'readonly');
      const req = tx.objectStore('local_cache').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

window.SpendlyIDB = {
  queueOfflineAction,
  getOfflineQueue,
  removeOfflineAction,
  setCache,
  getCache
};
