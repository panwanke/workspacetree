/**
 * IndexedDB 最小封装：等价写入协议的原子提交原语（05 §十 / U06 / ADR-027）。
 * 浏览器没有文件系统 rename；单个 IDB 事务内对多个 object store 的写入具备原子提交语义，
 * 用它替代「临时文件 + rename」，配合独立的 pending 意图日志获得等价恢复能力。
 */
/// <reference lib="dom" />

export const STORE_PROJECTS = 'projects';
export const STORE_PENDING = 'pending';
export const STORE_SQLITE = 'sqlite';

export interface ProjectRecord {
  projectId: string;
  payload: string;
  fileHash: string;
  semanticHash: string;
  presentationHash: string;
  writeVersion: number;
  activeBranch: string;
}

export interface PendingRecord {
  projectId: string;
  writeId: string;
  baseFileHash: string;
  newFileHash: string;
  afterState: string;
  createdAt: string;
}

export interface StoreOp {
  store: string;
  mode: 'put' | 'delete' | 'clear';
  value?: unknown;
  key?: IDBValidKey;
}

export function openSpikeDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_SQLITE)) {
        db.createObjectStore(STORE_SQLITE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
    request.onblocked = () => reject(new Error('indexedDB.open blocked by another connection'));
  });
}

export function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('idbGet failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idbGet transaction aborted'));
  });
}

/** 同一 readwrite 事务内提交多个 store 操作；oncomplete 才算落盘。 */
export function idbWrite(db: IDBDatabase, operations: StoreOp[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stores = [...new Set(operations.map((op) => op.store))];
    const tx = db.transaction(stores, 'readwrite');
    for (const op of operations) {
      const store = tx.objectStore(op.store);
      if (op.mode === 'put') {
        if (op.key !== undefined) store.put(op.value, op.key);
        else store.put(op.value);
      } else if (op.mode === 'delete') {
        store.delete(op.key as IDBValidKey);
      } else {
        store.clear();
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idbWrite failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}
