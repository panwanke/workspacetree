/**
 * 桌面原生 SQLite Storage Adapter（05 §八 / §十、U06 双实现尖刺的桌面侧）。
 * 使用 Node 22 内置 node:sqlite（实验性 API），与浏览器 WASM 实现共用同一契约测试。
 * 写入协议：pending_writes 意图日志（独立事务）→ projects 事务 → 清理意图日志；
 * 启动恢复按 fileHash 前滚 / 补完 / 报冲突，绝不静默覆盖。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  computeFileHash,
  migrateToCurrent,
  StorageError,
  type StorageAdapter,
} from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import { SimulatedCrashError, WriteRecoveryConflictError } from './write-protocol.js';
import { sharedWriteQueue } from './write-queue.js';
import type { CrashPlan, RecoveryReport, SpikeAdapter, WriteStep } from './spike-contract.js';

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  active_branch TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  semantic_hash TEXT NOT NULL,
  presentation_hash TEXT NOT NULL,
  write_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_writes (
  write_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  base_file_hash TEXT NOT NULL,
  new_file_hash TEXT NOT NULL,
  after_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

interface IntentRow {
  write_id: string;
  base_file_hash: string;
  new_file_hash: string;
  after_state: string;
}

export class SqliteStorageAdapter implements SpikeAdapter, StorageAdapter {
  readonly backend = 'node-sqlite';
  private readonly db: DatabaseSync;
  private crash: CrashPlan;
  private denied = false;
  private counter = 0;
  private closed = false;

  constructor(
    private readonly dbPath: string,
    options: { crash?: CrashPlan } = {},
  ) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(DDL);
    this.crash = options.crash ?? {};
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('sqlite adapter is closed');
  }

  private async gate(step: WriteStep): Promise<void> {
    if (this.denied && step === 'intent') {
      const error = new Error('EACCES: permission revoked, write denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    if (this.crash.denyAt === step) {
      const error = new Error(
        `EACCES: permission denied at step "${step}"`,
      ) as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    if (this.crash.failAt === step) throw new SimulatedCrashError(step);
  }

  private readProject(projectId: string): BranchFile | null {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT payload FROM projects WHERE project_id = ?')
      .get(projectId) as { payload: string } | undefined;
    if (!row) return null;
    return BranchFileSchema.parse(migrateToCurrent(JSON.parse(row.payload)));
  }

  private readIntent(projectId: string): IntentRow | null {
    this.assertOpen();
    const row = this.db
      .prepare(
        'SELECT write_id, base_file_hash, new_file_hash, after_state FROM pending_writes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(projectId) as IntentRow | undefined;
    return row ?? null;
  }

  private writeProject(file: BranchFile): void {
    this.db
      .prepare(
        `INSERT INTO projects (project_id, payload, active_branch, file_hash, semantic_hash, presentation_hash, write_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           payload = excluded.payload, active_branch = excluded.active_branch,
           file_hash = excluded.file_hash, semantic_hash = excluded.semantic_hash,
           presentation_hash = excluded.presentation_hash, write_version = excluded.write_version`,
      )
      .run(
        file.projectId,
        JSON.stringify(file),
        file.activeBranch,
        file.revisions.fileHash,
        file.revisions.semanticHash,
        file.revisions.presentationHash,
        file.revisions.fileWriteVersion,
      );
  }

  private dropIntent(projectId: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM pending_writes WHERE project_id = ?').run(projectId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async hasPendingWrites(projectId: string): Promise<boolean> {
    return this.readIntent(projectId) !== null;
  }

  async recover(projectId: string): Promise<RecoveryReport> {
    this.assertOpen();
    const intent = this.readIntent(projectId);
    if (!intent) {
      return { outcome: 'none', projectId, currentHash: '', directoryFsync: null };
    }
    const current = this.readProject(projectId);
    const currentHash = current ? computeFileHash(current) : '';

    if (currentHash === intent.new_file_hash) {
      this.dropIntent(projectId);
      return {
        outcome: 'completed',
        projectId,
        currentHash,
        baseHash: intent.base_file_hash,
        newHash: intent.new_file_hash,
        directoryFsync: null,
      };
    }
    if (currentHash === intent.base_file_hash) {
      const after = BranchFileSchema.parse(migrateToCurrent(JSON.parse(intent.after_state)));
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.writeProject(after);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      this.dropIntent(projectId);
      return {
        outcome: 'rolled-forward',
        projectId,
        currentHash,
        baseHash: intent.base_file_hash,
        newHash: intent.new_file_hash,
        directoryFsync: null,
      };
    }
    throw new WriteRecoveryConflictError({
      outcome: 'conflict',
      projectId,
      currentHash,
      baseHash: intent.base_file_hash,
      newHash: intent.new_file_hash,
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
    return sharedWriteQueue(`${this.backend}:${this.dbPath}`)(() => this.saveLocked(file));
  }

  private async saveLocked(file: BranchFile): Promise<void> {
    this.assertOpen();
    if (this.readIntent(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    const existing = this.readProject(file.projectId);
    if (existing && file.revisions.fileWriteVersion <= existing.revisions.fileWriteVersion) {
      throw new StorageError('concurrent write detected: stale fileWriteVersion', {
        incoming: file.revisions.fileWriteVersion,
        stored: existing.revisions.fileWriteVersion,
      });
    }
    const baseFileHash = existing ? computeFileHash(existing) : '';
    const newFileHash = computeFileHash(file);
    this.counter += 1;
    const writeId = `w_${String(this.counter).padStart(6, '0')}_${file.revisions.fileWriteVersion}`;

    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO pending_writes (write_id, project_id, base_file_hash, new_file_hash, after_state, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            writeId,
            file.projectId,
            baseFileHash,
            newFileHash,
            JSON.stringify(file),
            new Date().toISOString(),
          );
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      await this.gate('intent');

      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.writeProject(file);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      await this.gate('temp');
      await this.gate('replace');
      await this.gate('commit');
      this.dropIntent(file.projectId);
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error;
      throw new StorageError(`failed to save branch file to sqlite: ${file.projectId}`, error);
    }
  }

  async reopen(): Promise<SpikeAdapter> {
    return new SqliteStorageAdapter(this.dbPath);
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
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
    this.db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM pending_writes WHERE project_id = ?').run(projectId);
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
