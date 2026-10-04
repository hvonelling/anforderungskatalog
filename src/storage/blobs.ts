// Inhalte der Anhänge auf diesem Gerät (IndexedDB). Die Beschreibung (Name, Typ, Größe) steht im Projekt.

export interface BlobStore {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  del(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

const DB = "anforderungskatalog";
const STORE = "anhaenge";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error ?? new Error("Anhang-Speicher nicht verfügbar."));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(rq.result);
        };
        t.onerror = t.onabort = () => {
          db.close();
          reject(t.error ?? new Error("Anhang konnte nicht gespeichert werden."));
        };
      }),
  );
}

export const idbBlobs: BlobStore = {
  async get(id) {
    const v = await tx<ArrayBuffer | undefined>("readonly", (s) => s.get(id));
    return v ? new Uint8Array(v) : null;
  },
  async put(id, bytes) {
    // Eigene Kopie ablegen, damit kein Ausschnitt eines größeren Puffers gespeichert wird.
    await tx("readwrite", (s) => s.put(bytes.slice().buffer, id));
  },
  async del(id) {
    await tx("readwrite", (s) => s.delete(id));
  },
  async has(id) {
    return (await tx<number>("readonly", (s) => s.count(id))) > 0;
  },
};

/** Speicher im Arbeitsspeicher (Tests und Geräte ohne IndexedDB). */
export function memoryBlobs(): BlobStore {
  const m = new Map<string, Uint8Array>();
  return {
    async get(id) {
      return m.get(id) ?? null;
    },
    async put(id, bytes) {
      m.set(id, bytes.slice());
    },
    async del(id) {
      m.delete(id);
    },
    async has(id) {
      return m.has(id);
    },
  };
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; type: string } {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("Ungültiger Anhang.");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] };
}
