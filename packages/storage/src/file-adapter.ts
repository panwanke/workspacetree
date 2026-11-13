/**
 * Node 文件 Storage Adapter 最小实现（临时文件 + rename 原子替换语义）。
 * 浏览器 WASM SQLite / OPFS / IndexedDB 与桌面原生 SQLite 的双实现尖刺、
 * 六类场景实测与等价写入协议均为 Phase 0 剩余项；此处是它们的替换点。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { migrateToCurrent, StorageError, type StorageAdapter } from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class FileStorageAdapter implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  private pathFor(projectId: string): string {
    return resolve(this.baseDir, `${projectId}.branch.json`);
  }

  async load(projectId: string): Promise<BranchFile | null> {
    const target = this.pathFor(projectId);
    try {
      const raw = await readFile(target, 'utf8');
      return BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new StorageError(`failed to load branch file: ${target}`, error);
    }
  }

  async save(file: BranchFile): Promise<void> {
    const target = this.pathFor(file.projectId);
    const temp = `${target}.tmp`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      await rename(temp, target);
    } catch (error) {
      throw new StorageError(`failed to save branch file: ${target}`, error);
    }
  }
}
