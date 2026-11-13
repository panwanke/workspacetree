/**
 * 可靠写入协议（05 §七 / §十、U06 / C19 / ADR-027）。
 *
 * Node / 桌面侧：单写入意图日志 + 同目录临时文件 + fsync + rename 原子替换。
 * 步骤：① 写 pending intent（含三类 base/new hash 与可恢复 afterState）
 *      ② 写 .tmp 并 fsync  ③ rename 原子替换并 fsync 目录  ④ 删除 intent。
 * 启动恢复按落盘 fileHash 判定：old → 前滚；new → 补完（删 intent）；
 * 两者皆非 → 外部变更冲突，原样保留文件，绝不静默覆盖。
 *
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  computeFileHash,
  migrateToCurrent,
  StorageError,
  type StorageAdapter,
} from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import type { CrashPlan, RecoveryReport, SpikeAdapter, WriteStep } from './spike-contract.js';
import { sharedWriteQueue } from './write-queue.js';

export type { CrashPlan, RecoveryOutcome, RecoveryReport, WriteStep } from './spike-contract.js';

export const WRITE_STEPS: readonly WriteStep[] = ['intent', 'temp', 'replace', 'commit'];

interface WriteIntent {
  writeId: string;
  projectId: string;
  baseFileHash: string;
  newFileHash: string;
  baseSemanticHash: string;
  newSemanticHash: string;
  basePresentationHash: string;
  newPresentationHash: string;
  afterState: BranchFile;
  createdAt: string;
}

export class SimulatedCrashError extends Error {
  readonly step: WriteStep;
  constructor(step: WriteStep, kind: 'crash' | 'denied' = 'crash') {
    super(`simulated ${kind} after write step "${step}"`);
    this.name = kind === 'crash' ? 'SimulatedCrashError' : 'SimulatedPermissionError';
    this.step = step;
  }
}

export class WriteRecoveryConflictError extends StorageError {
  readonly report: RecoveryReport;
  constructor(report: RecoveryReport) {
    super('write recovery conflict: on-disk state matches neither base nor new hash', report);
    this.name = 'WriteRecoveryConflictError';
    this.report = report;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function fsyncedWrite(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch {
    // Windows 不允许以只读方式打开目录；不静默降低要求，结果在实测报告中明示。
    return false;
  }
}

export class AtomicWriteAdapter implements SpikeAdapter, StorageAdapter {
  readonly backend = 'node-file-atomic';
  private crash: CrashPlan;
  private denied = false;
  private writeCounter = 0;

  constructor(
    private readonly baseDir: string,
    options: { crash?: CrashPlan } = {},
  ) {
    this.crash = options.crash ?? {};
  }

  private target(projectId: string): string {
    return resolve(this.baseDir, `${projectId}.branch.json`);
  }

  private pendingDir(): string {
    return resolve(this.baseDir, '.pending');
  }

  private intentPath(projectId: string): string {
    return resolve(this.pendingDir(), `${projectId}.json`);
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

  private async readIntent(projectId: string): Promise<WriteIntent | null> {
    try {
      return JSON.parse(await readFile(this.intentPath(projectId), 'utf8')) as WriteIntent;
    } catch (error) {
      if (isMissing(error)) return null;
      throw new StorageError('failed to read pending write intent', error);
    }
  }

  private async rawFile(projectId: string): Promise<BranchFile | null> {
    try {
      const raw = await readFile(this.target(projectId), 'utf8');
      return BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw)));
    } catch {
      // 不存在或已损坏：由 recover 按哈希判定，绝不静默覆盖损坏文件。
      return null;
    }
  }

  async hasPendingWrites(projectId: string): Promise<boolean> {
    return (await this.readIntent(projectId)) !== null;
  }

  async recover(projectId: string): Promise<RecoveryReport> {
    const intent = await this.readIntent(projectId);
    if (!intent) {
      return { outcome: 'none', projectId, currentHash: '', directoryFsync: null };
    }
    const target = this.target(projectId);
    let currentHash = '';
    let fileExists = false;
    try {
      const raw = await readFile(target, 'utf8');
      fileExists = true;
      currentHash = computeFileHash(BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw))));
    } catch {
      currentHash = fileExists ? 'CORRUPT' : '';
    }
    const directoryFsync = await fsyncDirectory(dirname(target));

    if (currentHash === intent.newFileHash) {
      await rm(this.intentPath(projectId), { force: true });
      return {
        outcome: 'completed',
        projectId,
        currentHash,
        baseHash: intent.baseFileHash,
        newHash: intent.newFileHash,
        directoryFsync,
      };
    }
    if (currentHash === intent.baseFileHash) {
      await mkdir(dirname(target), { recursive: true });
      await fsyncedWrite(`${target}.tmp`, `${JSON.stringify(intent.afterState, null, 2)}\n`);
      await rename(`${target}.tmp`, target);
      await rm(this.intentPath(projectId), { force: true });
      return {
        outcome: 'rolled-forward',
        projectId,
        currentHash,
        baseHash: intent.baseFileHash,
        newHash: intent.newFileHash,
        directoryFsync,
      };
    }
    throw new WriteRecoveryConflictError({
      outcome: 'conflict',
      projectId,
      currentHash,
      baseHash: intent.baseFileHash,
      newHash: intent.newFileHash,
      reason: 'on-disk file matches neither base nor new hash; file preserved as-is',
      directoryFsync,
    });
  }

  async load(projectId: string): Promise<BranchFile | null> {
    await this.recover(projectId);
    try {
      const raw = await readFile(this.target(projectId), 'utf8');
      return BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw)));
    } catch (error) {
      if (isMissing(error)) return null;
      throw new StorageError(`failed to load branch file: ${this.target(projectId)}`, error);
    }
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
    return sharedWriteQueue(`${this.backend}:${this.baseDir}`)(() => this.saveLocked(file));
  }

  private async saveLocked(file: BranchFile): Promise<void> {
    if (await this.hasPendingWrites(file.projectId)) {
      throw new StorageError(
        'concurrent write detected: pending intent exists; run recovery first',
        {
          projectId: file.projectId,
        },
      );
    }
    const target = this.target(file.projectId);
    const existing = await this.rawFile(file.projectId);
    if (existing && file.revisions.fileWriteVersion <= existing.revisions.fileWriteVersion) {
      throw new StorageError('concurrent write detected: stale fileWriteVersion', {
        incoming: file.revisions.fileWriteVersion,
        stored: existing.revisions.fileWriteVersion,
      });
    }
    const baseFileHash = existing ? computeFileHash(existing) : '';
    const newFileHash = computeFileHash(file);
    this.writeCounter += 1;
    const intent: WriteIntent = {
      writeId: `w_${String(this.writeCounter).padStart(6, '0')}_${file.revisions.fileWriteVersion}`,
      projectId: file.projectId,
      baseFileHash,
      newFileHash,
      baseSemanticHash: existing?.revisions.semanticHash ?? '',
      newSemanticHash: file.revisions.semanticHash,
      basePresentationHash: existing?.revisions.presentationHash ?? '',
      newPresentationHash: file.revisions.presentationHash,
      afterState: file,
      createdAt: new Date().toISOString(),
    };

    try {
      await mkdir(dirname(target), { recursive: true });
      await mkdir(this.pendingDir(), { recursive: true });
      await fsyncedWrite(this.intentPath(file.projectId), JSON.stringify(intent, null, 2));
      await this.gate('intent');

      await fsyncedWrite(`${target}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
      await this.gate('temp');

      await rename(`${target}.tmp`, target);
      await fsyncDirectory(dirname(target));
      await this.gate('replace');

      await this.gate('commit');
      await rm(this.intentPath(file.projectId), { force: true });
      await rm(`${target}.tmp`, { force: true });
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error;
      throw new StorageError(`failed to save branch file: ${target}`, error);
    }
  }

  async reopen(): Promise<SpikeAdapter> {
    return new AtomicWriteAdapter(this.baseDir);
  }

  async close(): Promise<void> {}

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
    await rm(this.target(projectId), { force: true });
    await rm(`${this.target(projectId)}.tmp`, { force: true });
    await rm(this.intentPath(projectId), { force: true });
  }

  async exportPack(projectId: string): Promise<string | null> {
    const file = await this.load(projectId);
    return file ? JSON.stringify({ format: 'branchpack/1', file }) : null;
  }

  async importPack(raw: string): Promise<void> {
    const parsed = JSON.parse(raw) as { format?: string; file?: unknown };
    if (parsed.format !== 'branchpack/1') {
      throw new StorageError('unsupported pack format');
    }
    const file = BranchFileSchema.parse(migrateToCurrent(parsed.file));
    await this.save(file);
  }
}
