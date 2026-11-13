/**
 * Command Service 与 Storage Adapter 的边界（契约 8）。
 * core 只依赖端口接口，不 import 任何 storage 实现，也不依赖 React / Node / Electron API。
 * 后续 WASM SQLite / 桌面原生实现只需满足此接口并通过同一组契约测试（Phase 0 剩余项）。
 */
import type { BranchFile } from '@workspacetree/schema';

export interface StorageAdapter {
  load(projectId: string): Promise<BranchFile | null>;
  save(file: BranchFile): Promise<void>;
  savePair?(
    updates: readonly [
      { before: BranchFile; after: BranchFile },
      { before: BranchFile; after: BranchFile },
    ],
  ): Promise<void>;
}

export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
