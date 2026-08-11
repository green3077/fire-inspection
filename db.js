// 소방점검 관리 데이터 저장용 IndexedDB 래퍼
const FireDB = (() => {
  const DB_NAME = "fire-inspection-db";
  const DB_VERSION = 2;
  const STORES = {
    sites: "sites",
    inspections: "inspections",
    photos: "photos",
    deficiencies: "deficiencies"
  };
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction;
        if (!db.objectStoreNames.contains(STORES.sites)) {
          db.createObjectStore(STORES.sites, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORES.inspections)) {
          const store = db.createObjectStore(STORES.inspections, { keyPath: "id" });
          store.createIndex("siteId", "siteId", { unique: false });
          store.createIndex("scheduledDate", "scheduledDate", { unique: false });
          store.createIndex("status", "status", { unique: false });
        }
        let photoStore;
        if (!db.objectStoreNames.contains(STORES.photos)) {
          photoStore = db.createObjectStore(STORES.photos, { keyPath: "id" });
          photoStore.createIndex("inspectionId", "inspectionId", { unique: false });
        } else {
          photoStore = tx.objectStore(STORES.photos);
        }
        if (!photoStore.indexNames.contains("siteId")) {
          photoStore.createIndex("siteId", "siteId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.deficiencies)) {
          const store = db.createObjectStore(STORES.deficiencies, { keyPath: "id" });
          store.createIndex("siteId", "siteId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function put(storeName, record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllByIndex(storeName, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    genId,

    // Sites
    async addSite(site) {
      const id = site.id || genId();
      return put(STORES.sites, { ...site, id });
    },
    async updateSite(id, changes) {
      const existing = await get(STORES.sites, id);
      if (!existing) throw new Error("Site not found: " + id);
      return put(STORES.sites, { ...existing, ...changes, id });
    },
    async deleteSite(id) {
      const inspections = await getAllByIndex(STORES.inspections, "siteId", id);
      for (const insp of inspections) {
        await this.deleteInspection(insp.id);
      }
      const defs = await getAllByIndex(STORES.deficiencies, "siteId", id);
      for (const def of defs) {
        await this.deleteDeficiency(def.id);
      }
      return remove(STORES.sites, id);
    },
    getSite: (id) => get(STORES.sites, id),
    getAllSites: () => getAll(STORES.sites),

    // Inspections
    async addInspection(inspection) {
      const id = inspection.id || genId();
      return put(STORES.inspections, { ...inspection, id });
    },
    async updateInspection(id, changes) {
      const existing = await get(STORES.inspections, id);
      if (!existing) throw new Error("Inspection not found: " + id);
      return put(STORES.inspections, { ...existing, ...changes, id });
    },
    async deleteInspection(id) {
      const photos = await getAllByIndex(STORES.photos, "inspectionId", id);
      for (const p of photos) {
        await remove(STORES.photos, p.id);
      }
      return remove(STORES.inspections, id);
    },
    getInspection: (id) => get(STORES.inspections, id),
    getAllInspections: () => getAll(STORES.inspections),
    getInspectionsBySite: (siteId) => getAllByIndex(STORES.inspections, "siteId", siteId),

    // Photos
    async addPhoto(photo) {
      const id = photo.id || genId();
      return put(STORES.photos, { ...photo, id });
    },
    async deletePhoto(id) {
      return remove(STORES.photos, id);
    },
    async updatePhoto(id, changes) {
      const existing = await get(STORES.photos, id);
      if (!existing) throw new Error("Photo not found: " + id);
      return put(STORES.photos, { ...existing, ...changes, id });
    },
    getPhoto: (id) => get(STORES.photos, id),
    getPhotosByInspection: (inspectionId) => getAllByIndex(STORES.photos, "inspectionId", inspectionId),
    getPhotosBySite: (siteId) => getAllByIndex(STORES.photos, "siteId", siteId),

    // Deficiencies (현장에 직접 귀속, 점검 기록과 무관)
    async addDeficiency(def) {
      const id = def.id || genId();
      return put(STORES.deficiencies, { ...def, id });
    },
    async updateDeficiency(id, changes) {
      const existing = await get(STORES.deficiencies, id);
      if (!existing) throw new Error("Deficiency not found: " + id);
      return put(STORES.deficiencies, { ...existing, ...changes, id });
    },
    async deleteDeficiency(id) {
      const def = await get(STORES.deficiencies, id);
      if (def) {
        for (const pid of [...(def.beforePhotoIds || []), ...(def.afterPhotoIds || [])]) {
          await remove(STORES.photos, pid);
        }
      }
      return remove(STORES.deficiencies, id);
    },
    getDeficiency: (id) => get(STORES.deficiencies, id),
    getAllDeficiencies: () => getAll(STORES.deficiencies),
    getDeficienciesBySite: (siteId) => getAllByIndex(STORES.deficiencies, "siteId", siteId)
  };
})();
