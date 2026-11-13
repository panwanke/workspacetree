/**
 * 内存 Storage Adapter 最小实现，用于契约测试与无 UI 环境验证。
 * 实现 core/ports.ts 的端口，不反向依赖 core 以外的上层模块。
 */
import type { StorageAdapter } from '@workspacetree/core';
import type { BranchFile } from '@workspacetree/schema';

function clone(file: BranchFile): BranchFile {
  return JSON.parse(JSON.stringify(file)) as BranchFile;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly files = new Map<string, BranchFile>();

  async load(projectId: string): Promise<BranchFile | null> {
    const found = this.files.get(projectId);
    return found ? clone(found) : null;
  }

  async save(file: BranchFile): Promise<void> {
    this.files.set(file.projectId, clone(file));
  }
}
