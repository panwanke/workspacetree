/**
 * 浏览器 WASM SQLite + IndexedDB Storage Adapter（05 §十 / U06 / ADR-027 的浏览器侧）。
 *
 * 使用 sql.js（SQLite 编译为 WASM）+ IndexedDB 持久化 DB 二进制。
 * 等价写入协议：无文件系统 rename，改为
 *   ① 独立事务写 pending 意图日志 → ② 单事务原子提交 SQLite 二进制＋项目元数据
 *   → ③ 独立事务清理意图日志；启动校验点按 fileHash 前滚 / 补完 / 报冲突。
 * 恢复不变量与桌面侧 05 §七 完全一致，不因平台差异降低数据安全要求。
 *
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
/// <reference lib="dom" />
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import {
  computeFileHash,
  migrateToCurrent,
  StorageError,
  type StorageAdapter,
} from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import { sharedWriteQueue } from '../write-queue.js';
import type { CrashPlan, RecoveryReport, SpikeAdapter, WriteStep } from '../spike-contract.js';
import {
  idbGet,
  idbWrite,
  openSpikeDatabase,
  STORE_PENDING,
  STORE_PROJECTS,
  STORE_SQLITE,
  type PendingRecord,
  type ProjectRecord,
} from './idb.js';

let runtimePromise: Promise<SqlJsStatic> | null = null;

function sqlRuntime(wasmUrl: string): Promise<SqlJsStatic> {
  if (!runtimePromise) {
    runtimePromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return runtimePromise;
}

export class BrowserSimulatedCrashError extends Error {
  readonly step: WriteStep;
  constructor(step: WriteStep, kind: 'crash' | 'denied' = 'crash') {
    super(`simulated ${kind} after write step "${step}"`);
    this.name = kind === 'crash' ? 'BrowserSimulatedCrashError' : 'BrowserSimulatedPermissionError';
    this.step = step;
  }
}

export class BrowserWriteConflictError extends Error {
  readonly report: RecoveryReport;
  constructor(report: RecoveryReport) {
    super('browser write recovery conflict: stored state matches neither base nor new hash');
    this.name = 'BrowserWriteConflictError';
    this.report = report;
  }
}

export interface WasmSqliteOptions {
  databaseName?: string;
  wasmUrl?: string;
  crash?: CrashPlan;
}

const PROJECT_DDL = `CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  write_version INTEGER NOT NULL
);`;

export class WasmSqliteAdapter implements SpikeAdapter, StorageAdapter {
  readonly backend = 'browser-wasm-sqlite-idb';
  private idb: IDBDatabase | null = null;
  private sql: SqlJsStatic | null = null;
  private crash: CrashPlan;
  private denied = false;
  private counter = 0;
  private closed = false;

  constructor(private readonly options: WasmSqliteOptions = {}) {
    this.crash = options.crash ?? {};
  }

  private get databaseName(): string {
    return this.options.databaseName ?? 'wst-storage-spike';
  }

  private get wasmUrl(): string {
    return this.options.wasmUrl ?? '/sql-wasm.wasm';
  }

  private async ready(): Promise<{ idb: IDBDatabase; sql: SqlJsStatic }> {
    if (this.closed) throw new StorageError('browser adapter is closed');
    if (!this.idb) this.idb = await openSpikeDatabase(this.databaseName);
    if (!this.sql) this.sql = await sqlRuntime(this.wasmUrl);
    return { idb: this.idb, sql: this.sql };
  }

  private async openSqlite(): Promise<Database> {
    const { idb, sql } = await this.ready();
    const binary = await idbGet<Uint8Array>(idb, STORE_SQLITE, 'main');
    return binary ? new sql.Database(binary) : new sql.Database();
  }

  private async readProject(projectId: string): Promise<BranchFile | null> {
    const { idb } = await this.ready();
    const record = await idbGet<ProjectRecord>(idb, STORE_PROJECTS, projectId);
    if (!record) return null;
    return BranchFileSchema.parse(migrateToCurrent(JSON.parse(record.payload)));
  }

  private async readIntent(projectId: string): Promise<PendingRecord | null> {
    const { idb } = await this.ready();
    return (await idbGet<PendingRecord>(idb, STORE_PENDING, projectId)) ?? null;
  }

  private async gate(step: WriteStep): Promise<void> {
    if (this.denied && step === 'intent') {
      throw new BrowserSimulatedCrashError(step, 'denied');
    }
    if (this.crash.denyAt === step) {
      throw new BrowserSimulatedCrashError(step, 'denied');
    }
    if (this.crash.failAt === step) throw new BrowserSimulatedCrashError(step);
  }

  /** 单次原子提交：SQLite 二进制 + 项目元数据写进同一个 IDB 事务。 */
  private async commitState(file: BranchFile): Promise<void> {
    const { idb } = await this.ready();
    const db = await this.openSqlite();
    let binary: Uint8Array;
    try {
      db.run(PROJECT_DDL);
      db.run(
        'INSERT OR REPLACE INTO projects (project_id, payload, file_hash, write_version) VALUES (?, ?, ?, ?)',
        [
          file.projectId,
          JSON.stringify(file),
          file.revisions.fileHash,
          file.revisions.fileWriteVersion,
        ],
      );
      binary = db.export();
    } finally {
      db.close();
    }
    const record: ProjectRecord = {
      projectId: file.projectId,
      payload: JSON.stringify(file),
      fileHash: file.revisions.fileHash,
      semanticHash: file.revisions.semanticHash,
      presentationHash: file.revisions.presentationHash,
      writeVersion: file.revisions.fileWriteVersion,
      activeBranch: file.activeBranch,
    };
    await idbWrite(idb, [
      { store: STORE_SQLITE, mode: 'put', value: binary, key: 'main' },
      { store: STORE_PROJECTS, mode: 'put', value: record },
    ]);
  }

  private async dropIntent(projectId: string): Promise<void> {
    const { idb } = await this.ready();
    await idbWrite(idb, [{ store: STORE_PENDING, mode: 'delete', key: projectId }]);
  }

  async hasPendingWrites(projectId: string): Promise<boolean> {
    return (await this.readIntent(projectId)) !== null;
  }

  async recover(projectId: string): Promise<RecoveryReport> {
    const intent = await this.readIntent(projectId);
    if (!intent) {
      return { outcome: 'none', projectId, currentHash: '', directoryFsync: null };
    }
    const current = await this.readProject(projectId);
    const currentHash = current ? computeFileHash(current) : '';

    if (currentHash === intent.newFileHash) {
      await this.dropIntent(projectId);
      return {
        outcome: 'completed',
        projectId,
        currentHash,
        baseHash: intent.baseFileHash,
        newHash: intent.newFileHash,
        directoryFsync: null,
      };
    }
    if (currentHash === intent.baseFileHash) {
      const after = BranchFileSchema.parse(migrateToCurrent(JSON.parse(intent.afterState)));
      await this.commitState(after);
      await this.dropIntent(projectId);
      return {
        outcome: 'rolled-forward',
        projectId,
        currentHash,
        baseHash: intent.baseFileHash,
        newHash: intent.newFileHash,
        directoryFsync: null,
      };
    }
    throw new BrowserWriteConflictError({
      outcome: 'conflict',
      projectId,
      currentHash,
      baseHash: intent.baseFileHash,
      newHash: intent.newFileHash,
      reason: 'stored state matches neither base nor new hash; state preserved as-is',
      directoryFsync: null,
    });
  }

  async load(projectId: string): Promise<BranchFile | null> {
    await this.recover(projectId);
    return this.readProject(projectId);
  }

  async save(file: BranchFile): Promise<void> {
    if (await this.hasPendingWrites(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    return sharedWriteQueue(`${this.backend}:${this.databaseName}`)(() => this.saveLocked(file));
  }

  private async saveLocked(file: BranchFile): Promise<void> {
    const { idb } = await this.ready();
    if (await this.readIntent(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    const existing = await this.readProject(file.projectId);
    if (existing && file.revisions.fileWriteVersion <= existing.revisions.fileWriteVersion) {
      throw new StorageError('concurrent write detected: stale fileWriteVersion', {
        incoming: file.revisions.fileWriteVersion,
        stored: existing.revisions.fileWriteVersion,
      });
    }
    const baseFileHash = existing ? computeFileHash(existing) : '';
    const newFileHash = computeFileHash(file);
    this.counter += 1;
    const intent: PendingRecord = {
      projectId: file.projectId,
      writeId: `w_${String(this.counter).padStart(6, '0')}_${file.revisions.fileWriteVersion}`,
      baseFileHash,
      newFileHash,
      afterState: JSON.stringify(file),
      createdAt: new Date().toISOString(),
    };

    try {
      await idbWrite(idb, [{ store: STORE_PENDING, mode: 'put', value: intent }]);
      await this.gate('intent');

      await this.commitState(file);
      await this.gate('temp');
      await this.gate('replace');
      await this.gate('commit');
      await this.dropIntent(file.projectId);
    } catch (error) {
      if (error instanceof BrowserSimulatedCrashError) throw error;
      throw new StorageError(`failed to save branch file in browser: ${file.projectId}`, error);
    }
  }

  async reopen(): Promise<SpikeAdapter> {
    return new WasmSqliteAdapter({
      databaseName: this.databaseName,
      wasmUrl: this.wasmUrl,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.idb?.close();
    this.idb = null;
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
    const { idb } = await this.ready();
    await idbWrite(idb, [
      { store: STORE_PROJECTS, mode: 'delete', key: projectId },
      { store: STORE_PENDING, mode: 'delete', key: projectId },
      { store: STORE_SQLITE, mode: 'delete', key: 'main' },
    ]);
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
}
