/**
 * 06 §二 Phase 0 验收 11（可替换性部分）：memory / file 两实现通过同一组契约断言。
 * 浏览器 WASM SQLite 与桌面原生 SQLite 双实现实测为 Phase 0 剩余项，G0 未闭合。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalize, type StorageAdapter } from '@workspacetree/core';
import {
  createMemoryKeyValueStore,
  FileStorageAdapter,
  IdbJsonStorageAdapter,
  MemoryStorageAdapter,
} from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';

const tempDir = await mkdtemp(join(tmpdir(), 'wst-adapter-'));
afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const adapters: Array<[string, () => StorageAdapter]> = [
  ['memory', () => new MemoryStorageAdapter()],
  ['file', () => new FileStorageAdapter(tempDir)],
  // Phase 1 轻量 IndexedDB JSON 适配器：用内存 KV 跑同一组契约断言（浏览器侧由 smoke 实测）。
  ['idb-json', () => new IdbJsonStorageAdapter(createMemoryKeyValueStore())],
];

for (const [label, make] of adapters) {
  describe(`T-13 Storage Adapter 契约桩 (${label})`, () => {
    it('未写入时 load 返回 null', async () => {
      const adapter = make();
      expect(await adapter.load('prj_never_written')).toBeNull();
    });

    it('save / load 回环保持同一 DomainState 语义状态', async () => {
      const adapter = make();
      const file = createMinimalBranchFile();
      await adapter.save(file);
      const loaded = await adapter.load(file.projectId);
      expect(loaded).not.toBeNull();
      expect(canonicalize(loaded!.domain)).toBe(canonicalize(file.domain));
      expect(loaded!.revisions.fileHash).toBe(file.revisions.fileHash);
      expect(loaded!.revisions.semanticHash).toBe(file.revisions.semanticHash);
    });

    it('覆盖写入后读回的是最新状态', async () => {
      const adapter = make();
      const file = createMinimalBranchFile();
      await adapter.save(file);
      const changed = {
        ...file,
        revisions: { ...file.revisions, fileWriteVersion: 7 },
      };
      await adapter.save(changed);
      const loaded = await adapter.load(file.projectId);
      expect(loaded!.revisions.fileWriteVersion).toBe(7);
    });
  });
}
