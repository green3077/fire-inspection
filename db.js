// 소방점검 관리 데이터 저장용 IndexedDB 래퍼
const FireDB = (() => {
  const DB_NAME = "fire-inspection-db";
  const DB_VERSION = 4;
  const STORES = {
    sites: "sites",
    inspections: "inspections",
    photos: "photos",
    deficiencies: "deficiencies",
    attachments: "attachments",
    schedules: "schedules"
  };
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked = () => {
        if (window.toast) window.toast("다른 탭/창에서 이 앱이 열려 있어 데이터베이스 업데이트가 대기 중입니다. 다른 탭을 닫아주세요.", "error");
      };
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
        if (!db.objectStoreNames.contains(STORES.attachments)) {
          const store = db.createObjectStore(STORES.attachments, { keyPath: "id" });
          store.createIndex("siteId", "siteId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.schedules)) {
          db.createObjectStore(STORES.schedules, { keyPath: "id" });
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
      const atts = await getAllByIndex(STORES.attachments, "siteId", id);
      for (const att of atts) {
        await remove(STORES.attachments, att.id);
      }
      // 현장점검 사진 갤러리 사진은 inspectionId 없이 siteId로만 귀속되므로 별도로 정리해야 한다
      // (지적사항 사진은 deleteDeficiency가 이미 개별 id로 지웠으므로 여기선 중복 삭제라도 무해함).
      const sitePhotos = await getAllByIndex(STORES.photos, "siteId", id);
      for (const p of sitePhotos) {
        await remove(STORES.photos, p.id);
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
    getDeficienciesBySite: (siteId) => getAllByIndex(STORES.deficiencies, "siteId", siteId),

    // Attachments (현장에 첨부하는 일반 파일 - 사진 외 문서 등)
    async addAttachment(att) {
      const id = att.id || genId();
      return put(STORES.attachments, { ...att, id });
    },
    async deleteAttachment(id) {
      return remove(STORES.attachments, id);
    },
    getAttachmentsBySite: (siteId) => getAllByIndex(STORES.attachments, "siteId", siteId),

    // Schedules (스케줄 관리 - 날짜별 방문 예정 업체. id = "YYYY-MM-DD", 점검 기록과 무관한 가벼운 일정)
    getScheduleByDate: (date) => get(STORES.schedules, date),
    getAllSchedules: () => getAll(STORES.schedules),
    async addSiteToSchedule(date, siteId) {
      const existing = await get(STORES.schedules, date);
      const siteIds = existing ? [...existing.siteIds] : [];
      if (!siteIds.includes(siteId)) siteIds.push(siteId);
      return put(STORES.schedules, { id: date, siteIds, confirmed: existing ? existing.confirmed : false });
    },
    async removeSiteFromSchedule(date, siteId) {
      const existing = await get(STORES.schedules, date);
      if (!existing) return null;
      return put(STORES.schedules, { ...existing, siteIds: existing.siteIds.filter((id) => id !== siteId) });
    },
    async setScheduleSiteIds(date, siteIds) {
      const existing = await get(STORES.schedules, date);
      return put(STORES.schedules, { id: date, siteIds: [...siteIds], confirmed: existing ? existing.confirmed : false });
    },
    async setScheduleConfirmed(date, confirmed) {
      const existing = await get(STORES.schedules, date);
      if (!existing) return null;
      return put(STORES.schedules, { ...existing, confirmed });
    }
  };
})();
