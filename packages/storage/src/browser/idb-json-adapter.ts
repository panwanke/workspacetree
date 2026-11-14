/**
 * Phase 1 轻量 IndexedDB JSON Storage Adapter（用户 2026-11-11 选定）。
 *
 * 实现 core 的 StorageAdapter 端口，因此所有写入仍经 CommandService，不绕过唯一写入口（C6）。
 * 主应用使用可恢复写入协议：
 *   ① 写 pending 意图日志 → ② 写临时态 → ③ 原子 put 主记录 → ④ 清理临时态与意图；
 * 启动校验点按 fileHash 前滚 / 补完 / 报冲突，四个步骤均可注入崩溃。
 *
 * 为避免把 DOM 类型带进 Node 侧工具链，IndexedDB 只以最小结构化接口描述，并在调用时
 * 从 globalThis 注入；createMemoryKeyValueStore 让同一份适配器契约桩可在 Node 下测试。
 *
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import {
  computeFileHash,
  migrateToCurrent,
  StorageError,
  type StorageAdapter,
} from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import { sharedWriteQueue } from '../write-queue.js';
import type { CrashPlan, RecoveryReport, SpikeAdapter, WriteStep } from '../spike-contract.js';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  compareAndWrite(
    expected: Readonly<Record<string, string | null>>,
    changes: Readonly<Record<string, string | null>>,
  ): Promise<boolean>;
  createIfAbsent(
    key: string,
    value: string,
    blockedBy: string,
  ): Promise<{
    value: string;
    created: boolean;
  }>;
  listKeys?(prefix?: string): Promise<string[]>;
}

export function createMemoryKeyValueStore(): KeyValueStore {
  const entries = new Map<string, string>();
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
    async compareAndWrite(expected, changes) {
      if (!Object.entries(expected).every(([key, value]) => (entries.get(key) ?? null) === value)) {
        return false;
      }
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) entries.delete(key);
        else entries.set(key, value);
      }
      return true;
    },
    async createIfAbsent(key, value, blockedBy) {
      const existing = entries.get(key);
      if (existing !== undefined) return { value: existing, created: false };
      if (entries.has(blockedBy)) throw new StorageError('concurrent project creation or write');
      entries.set(key, value);
      return { value, created: true };
    },
    async listKeys(prefix = '') {
      return Array.from(entries.keys()).filter((k) => k.startsWith(prefix));
    },
  };
}

interface IdbRequestLike<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

interface IdbObjectStoreLike {
  get(key: string): IdbRequestLike<unknown>;
  put(value: unknown, key?: string): void;
  delete(key: string): void;
  getAllKeys?(query?: unknown): IdbRequestLike<unknown[]>;
  openCursor?(): IdbRequestLike<{ result?: { key: unknown; continue(): void } }>;
}

interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: unknown;
}

interface IdbDatabaseLike {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: unknown): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): IdbTransactionLike;
}

export interface IdbFactoryLike {
  open(name: string, version: number): IdbRequestLike<IdbDatabaseLike>;
}

export const DEFAULT_DB_NAME = 'workspacetree-phase1';
export const PROJECT_STORE = 'branches';

/** 同一命名空间下的三条键：主记录 / 意图日志 / 临时态，互不覆盖。 */
const PROJECT_PREFIX = 'p:';
const INTENT_PREFIX = 'i:';
const TEMP_PREFIX = 't:';

/** 仅供测试 / 诊断定位主记录键；业务写入必须经 adapter.save。 */
export function projectStorageKey(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`;
}

function resolveFactory(explicit?: IdbFactoryLike): IdbFactoryLike {
  const fromGlobal = (globalThis as unknown as { indexedDB?: IdbFactoryLike }).indexedDB;
  const factory = explicit ?? fromGlobal;
  if (!factory) throw new Error('IndexedDB is unavailable in this runtime');
  return factory;
}

function openDatabase(factory: IdbFactoryLike, dbName: string): Promise<IdbDatabaseLike> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

/**
 * 单个 IDB 事务内的 put / delete 具备原子提交语义；oncomplete 才算落盘。
 * 每条键各自一个事务，与「意图日志独立事务 + 主记录单事务原子提交」的等价写入协议一致。
 */
export async function createIndexedDbKeyValueStore(
  dbName: string = DEFAULT_DB_NAME,
  explicitFactory?: IdbFactoryLike,
): Promise<KeyValueStore> {
  const factory = resolveFactory(explicitFactory);
  const db = await openDatabase(factory, dbName);
  return {
    get(key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readonly');
        const request = tx.objectStore(PROJECT_STORE).get(key);
        request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
      });
    },
    set(key, value) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readwrite');
        tx.objectStore(PROJECT_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
    delete(key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readwrite');
        tx.objectStore(PROJECT_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
    compareAndWrite(expected, changes) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readwrite');
        const store = tx.objectStore(PROJECT_STORE);
        const conditions = Object.entries(expected);
        let remaining = conditions.length;
        let matched = true;
        const write = () => {
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) store.delete(key);
            else store.put(value, key);
          }
        };
        if (remaining === 0) write();
        for (const [key, value] of conditions) {
          const request = store.get(key);
          request.onsuccess = () => {
            matched = matched && (request.result ?? null) === value;
            remaining -= 1;
            if (matched && remaining === 0) write();
          };
        }
        tx.oncomplete = () => resolve(matched);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB conditional write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
    createIfAbsent(key, value, blockedBy) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readwrite');
        const store = tx.objectStore(PROJECT_STORE);
        let existing: string | undefined;
        let blocked = false;
        const request = store.get(key);
        request.onsuccess = () => {
          existing = request.result as string | undefined;
          if (existing !== undefined) return;
          const blocker = store.get(blockedBy);
          blocker.onsuccess = () => {
            blocked = blocker.result !== undefined;
            if (!blocked) store.put(value, key);
          };
        };
        tx.oncomplete = () => {
          if (blocked) reject(new StorageError('concurrent project creation or write'));
          else resolve({ value: existing ?? value, created: existing === undefined });
        };
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB creation failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
    listKeys(prefix = '') {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, 'readonly');
        const store = tx.objectStore(PROJECT_STORE) as any;
        if (typeof store.getAllKeys === 'function') {
          const request = store.getAllKeys();
          request.onsuccess = () => {
            const raw = (request.result as unknown[]) || [];
            const filtered = raw.map(String).filter((k: string) => k.startsWith(prefix));
            resolve(filtered);
          };
          request.onerror = () => reject(request.error ?? new Error('IndexedDB listKeys failed'));
        } else if (
          typeof store.openCursor === 'function' ||
          typeof store.openKeyCursor === 'function'
        ) {
          const keys: string[] = [];
          const request = store.openKeyCursor ? store.openKeyCursor() : store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              const k = String(cursor.key);
              if (k.startsWith(prefix)) keys.push(k);
              cursor.continue();
            } else {
              resolve(keys);
            }
          };
          request.onerror = () => reject(request.error ?? new Error('IndexedDB listKeys failed'));
        } else {
          resolve([]);
        }
      });
    },
  };
}

interface PendingIntent {
  projectId: string;
  baseFileHash: string;
  newFileHash: string;
  afterState: string;
  createdAt: string;
}

export class IdbJsonSimulatedCrashError extends Error {
  readonly step: WriteStep;
  constructor(step: WriteStep, kind: 'crash' | 'denied' = 'crash') {
    super(`simulated ${kind} after write step "${step}"`);
    this.name = kind === 'crash' ? 'IdbJsonSimulatedCrashError' : 'IdbJsonWriteDeniedError';
    this.step = step;
  }
}

export class IdbJsonRecoveryConflictError extends Error {
  readonly report: RecoveryReport;
  constructor(report: RecoveryReport) {
    super('idb-json recovery conflict: stored state matches neither base nor new hash');
    this.name = 'IdbJsonRecoveryConflictError';
    this.report = report;
  }
}

export interface IdbJsonAdapterOptions {
  /** reopen() 用它重建连接，模拟进程重启；缺省时复用同一介质（内存 KV 场景）。 */
  storeFactory?: () => Promise<KeyValueStore> | KeyValueStore;
  /** 单写入队列的键；同一介质的所有实例必须共用同一个键。 */
  queueKey?: string;
  crash?: CrashPlan;
}

/** 唯一写入口仍是 CommandService；本类只负责 BranchFile 的 load / save 两端。 */
export class IdbJsonStorageAdapter implements SpikeAdapter, StorageAdapter {
  readonly backend = 'browser-idb-json';
  private crash: CrashPlan;
  private denied = false;
  private closed = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly options: IdbJsonAdapterOptions = {},
  ) {
    this.crash = options.crash ?? {};
  }

  private get queueKey(): string {
    return this.options.queueKey ?? `${this.backend}:default`;
  }

  private projectKey(projectId: string): string {
    return projectStorageKey(projectId);
  }

  private intentKey(projectId: string): string {
    return `${INTENT_PREFIX}${projectId}`;
  }

  private tempKey(projectId: string): string {
    return `${TEMP_PREFIX}${projectId}`;
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('idb-json adapter is closed');
  }

  private async readProject(projectId: string): Promise<BranchFile | null> {
    const raw = await this.store.get(this.projectKey(projectId));
    if (raw === null) return null;
    return BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw) as unknown));
  }

  private async readIntent(projectId: string): Promise<PendingIntent | null> {
    const raw = await this.store.get(this.intentKey(projectId));
    return raw === null ? null : (JSON.parse(raw) as PendingIntent);
  }

  /** 在指定步骤完成后抛出；调用方按「进程崩溃」处理，现场留给下次启动恢复。 */
  private gate(step: WriteStep): void {
    if (this.denied || this.crash.denyAt === step) {
      throw new IdbJsonSimulatedCrashError(step, 'denied');
    }
    if (this.crash.failAt === step) throw new IdbJsonSimulatedCrashError(step);
  }

  async hasPendingWrites(projectId: string): Promise<boolean> {
    this.assertOpen();
    return (await this.readIntent(projectId)) !== null;
  }

  async recover(projectId: string): Promise<RecoveryReport> {
    this.assertOpen();
    const intentKey = this.intentKey(projectId);
    const projectKey = this.projectKey(projectId);
    const tempKey = this.tempKey(projectId);
    const rawIntent = await this.store.get(intentKey);
    if (rawIntent === null) {
      return { outcome: 'none', projectId, currentHash: '', directoryFsync: null };
    }
    const intent = JSON.parse(rawIntent) as PendingIntent;
    const rawCurrent = await this.store.get(projectKey);
    const current =
      rawCurrent === null ? null : BranchFileSchema.parse(migrateToCurrent(JSON.parse(rawCurrent)));
    const currentHash = current ? computeFileHash(current) : '';
    const completed = currentHash === intent.newFileHash;
    if (completed || currentHash === intent.baseFileHash) {
      const changes: Record<string, string | null> = { [intentKey]: null, [tempKey]: null };
      if (!completed) {
        BranchFileSchema.parse(migrateToCurrent(JSON.parse(intent.afterState)));
        changes[projectKey] = intent.afterState;
      }
      if (
        !(await this.store.compareAndWrite(
          { [intentKey]: rawIntent, [projectKey]: rawCurrent },
          changes,
        ))
      ) {
        return this.recover(projectId);
      }
      return {
        outcome: completed ? 'completed' : 'rolled-forward',
        projectId,
        currentHash,
        baseHash: intent.baseFileHash,
        newHash: intent.newFileHash,
        directoryFsync: null,
      };
    }
    if ((await this.store.get(intentKey)) !== rawIntent) return this.recover(projectId);
    throw new IdbJsonRecoveryConflictError({
      outcome: 'conflict',
      projectId,
      currentHash,
      baseHash: intent.baseFileHash,
      newHash: intent.newFileHash,
      reason: 'stored state matches neither base nor new hash; state preserved as-is',
      directoryFsync: null,
    });
  }

  private async cleanup(projectId: string): Promise<void> {
    await this.store.delete(this.tempKey(projectId));
    await this.store.delete(this.intentKey(projectId));
  }

  /** 启动校验点：读之前先补完未完成的写入，读到的永远是完整状态。 */
  async load(projectId: string): Promise<BranchFile | null> {
    await this.recover(projectId);
    return this.readProject(projectId);
  }

  /** Insert a project or return its authoritative record without replacing it. */
  async createIfAbsent(file: BranchFile): Promise<BranchFile> {
    this.assertOpen();
    if (this.denied || this.crash.denyAt === 'intent') {
      throw new IdbJsonSimulatedCrashError('intent', 'denied');
    }
    return sharedWriteQueue(this.queueKey)(async () => {
      const result = await this.store.createIfAbsent(
        this.projectKey(file.projectId),
        JSON.stringify(file),
        this.intentKey(file.projectId),
      );
      return result.created
        ? file
        : BranchFileSchema.parse(migrateToCurrent(JSON.parse(result.value)));
    });
  }

  async save(file: BranchFile): Promise<void> {
    this.assertOpen();
    // 权限撤销在写任何字节之前拒绝，避免留下半写状态。
    if (this.denied || this.crash.denyAt === 'intent') {
      throw new IdbJsonSimulatedCrashError('intent', 'denied');
    }
    if (await this.hasPendingWrites(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    return sharedWriteQueue(this.queueKey)(() => this.saveLocked(file));
  }

  /** Both project records are replaced in one IndexedDB transaction. */
  async savePair(updates: Parameters<NonNullable<StorageAdapter['savePair']>>[0]): Promise<void> {
    this.assertOpen();
    if (this.denied || this.crash.denyAt === 'intent') {
      throw new StorageError('无法保存跨项目移动');
    }
    if (updates[0].before.projectId === updates[1].before.projectId) {
      throw new StorageError('跨项目移动需要两个不同的项目');
    }
    await sharedWriteQueue(this.queueKey)(async () => {
      const expected: Record<string, string | null> = {};
      const changes: Record<string, string> = {};
      for (const { before, after } of updates) {
        if (before.projectId !== after.projectId) throw new StorageError('项目标识不一致');
        const key = this.projectKey(before.projectId);
        const raw = await this.store.get(key);
        const current = raw && BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw)));
        if (
          !current ||
          computeFileHash(current) !== before.revisions.fileHash ||
          current.revisions.fileWriteVersion !== before.revisions.fileWriteVersion
        ) {
          throw new StorageError('项目已被更新，请重新打开后再移动分支');
        }
        expected[key] = raw;
        expected[this.intentKey(before.projectId)] = null;
        changes[key] = JSON.stringify(after);
      }
      if (!(await this.store.compareAndWrite(expected, changes))) {
        throw new StorageError('项目正在保存，请稍后重试');
      }
    });
  }

  private async saveLocked(file: BranchFile): Promise<void> {
    if (await this.readIntent(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    const projectKey = this.projectKey(file.projectId);
    const intentKey = this.intentKey(file.projectId);
    const tempKey = this.tempKey(file.projectId);
    const rawExisting = await this.store.get(projectKey);
    const existing =
      rawExisting === null
        ? null
        : BranchFileSchema.parse(migrateToCurrent(JSON.parse(rawExisting)));
    if (existing && file.revisions.fileWriteVersion <= existing.revisions.fileWriteVersion) {
      throw new StorageError('concurrent write detected: stale fileWriteVersion', {
        incoming: file.revisions.fileWriteVersion,
        stored: existing.revisions.fileWriteVersion,
      });
    }
    const afterState = JSON.stringify(file);
    const intent: PendingIntent = {
      projectId: file.projectId,
      baseFileHash: existing ? computeFileHash(existing) : '',
      newFileHash: computeFileHash(file),
      afterState,
      createdAt: new Date().toISOString(),
    };

    const rawIntent = JSON.stringify(intent);
    const withIntent = async (
      changes: Readonly<Record<string, string | null>>,
    ): Promise<boolean> => {
      if (await this.store.compareAndWrite({ [intentKey]: rawIntent }, changes)) return true;
      if ((await this.store.get(projectKey)) === afterState) return false;
      throw new StorageError('concurrent project write changed the pending intent');
    };
    try {
      const reserved = await this.store.compareAndWrite(
        { [projectKey]: rawExisting, [intentKey]: null },
        { [intentKey]: rawIntent },
      );
      if (!reserved) throw new StorageError('concurrent project creation or write');
      this.gate('intent');

      if (!(await withIntent({ [tempKey]: afterState }))) return;
      this.gate('temp');

      if (!(await withIntent({ [projectKey]: afterState }))) return;
      this.gate('replace');

      if (!(await withIntent({ [tempKey]: null }))) return;
      this.gate('commit');

      await withIntent({ [intentKey]: null });
    } catch (error) {
      if (error instanceof IdbJsonSimulatedCrashError) throw error;
      throw new StorageError(`failed to save branch file in idb-json: ${file.projectId}`, error);
    }
  }

  async reopen(): Promise<SpikeAdapter> {
    const store = this.options.storeFactory ? await this.options.storeFactory() : this.store;
    return new IdbJsonStorageAdapter(store, { ...this.options, crash: {} });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  setCrash(plan: CrashPlan): void {
    this.crash = plan;
  }

  clearCrash(): void {
    this.crash = {};
  }

  async setDenied(denied: boolean): Promise<void> {
    this.denied = denied;
  }

  async clear(projectId: string): Promise<void> {
    this.assertOpen();
    await this.store.delete(this.projectKey(projectId));
    await this.cleanup(projectId);
  }

  async exportPack(projectId: string): Promise<string | null> {
    const file = await this.load(projectId);
    return file ? JSON.stringify({ format: 'branchpack/1', file }) : null;
  }

  async importPack(raw: string): Promise<void> {
    const parsed = JSON.parse(raw) as { format?: string; file?: unknown };
    if (parsed.format !== 'branchpack/1') throw new StorageError('unsupported pack format');
    const file = BranchFileSchema.parse(migrateToCurrent(parsed.file));
    await this.save(file);
  }

  async listProjects(): Promise<StoredProjectSummary[]> {
    this.assertOpen();
    if (!this.store.listKeys) return [];
    const keys = await this.store.listKeys(PROJECT_PREFIX);
    const summaries: StoredProjectSummary[] = [];
    for (const key of keys) {
      const raw = await this.store.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          projectId?: string;
          activeBranch?: string;
          createdAt?: string;
          domain?: { project?: { title?: string }; nodes?: unknown[] };
          revisions?: { updatedAt?: string; fileHash?: string };
        };
        const projectId = parsed.projectId ?? key.slice(PROJECT_PREFIX.length);
        summaries.push({
          projectId,
          title: parsed.domain?.project?.title || projectId,
          activeBranch: parsed.activeBranch || 'main',
          nodeCount: Array.isArray(parsed.domain?.nodes) ? parsed.domain.nodes.length : 0,
          updatedAt: parsed.revisions?.updatedAt ?? parsed.createdAt ?? '',
        });
      } catch {
        // Skip corrupted or unparseable entries
      }
    }
    return summaries;
  }
}

export interface StoredProjectSummary {
  projectId: string;
  title: string;
  activeBranch: string;
  nodeCount: number;
  updatedAt?: string;
}

export async function createBrowserStorageAdapter(
  dbName: string = DEFAULT_DB_NAME,
  factory?: IdbFactoryLike,
  options: IdbJsonAdapterOptions = {},
): Promise<IdbJsonStorageAdapter> {
  const store = await createIndexedDbKeyValueStore(dbName, factory);
  return new IdbJsonStorageAdapter(store, {
    queueKey: `${'browser-idb-json'}:${dbName}`,
    storeFactory: () => createIndexedDbKeyValueStore(dbName, factory),
    ...options,
  });
}
