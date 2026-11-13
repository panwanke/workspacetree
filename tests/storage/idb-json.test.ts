/**
 * T-31 Phase 1 轻量 IndexedDB JSON 适配器。
 * 同一类适配器在「内存 KV」与「结构化 IndexedDB 假实现」两种注入下跑通；
 * 使用内存键值存储验证 IndexedDB 适配器的恢复协议。
 */
import { describe, expect, it } from 'vitest';
import {
  createIndexedDbKeyValueStore,
  createMemoryKeyValueStore,
  IdbJsonStorageAdapter,
  projectStorageKey,
  type IdbFactoryLike,
} from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';

/** 只实现适配器用到的最小 IDB 语义：单事务 put、get 回调、oncomplete 提交。 */
function fakeFactory(): IdbFactoryLike {
  const data = new Map<string, unknown>();
  const makeRequest = <T>(result: T) => {
    const request = {
      result,
      error: null as unknown,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
    return request;
  };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: (_store: string, _mode: 'readonly' | 'readwrite') => {
      const tx = {
        error: null as unknown,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          get(key: string) {
            const request = makeRequest(data.get(key));
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put(value: unknown, key?: string) {
            data.set(key ?? '', value);
          },
          delete(key: string) {
            data.delete(key);
          },
        }),
      };
      // put 所在事务在请求排队后提交
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };

  return {
    open(_name: string, _version: number) {
      const request = makeRequest(db);
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request as unknown as ReturnType<IdbFactoryLike['open']>;
    },
  };
}

describe('T-31 IndexedDB JSON 适配器', () => {
  it('allows only one existing-project write across separate runtime queues', async () => {
    const store = createMemoryKeyValueStore();
    const first = new IdbJsonStorageAdapter(store, { queueKey: 'window-1' });
    const second = new IdbJsonStorageAdapter(store, { queueKey: 'window-2' });
    const file = createMinimalBranchFile();
    await first.save(file);
    const changed = (title: string) => ({
      ...file,
      domain: { ...file.domain, project: { ...file.domain.project, title } },
      revisions: { ...file.revisions, fileWriteVersion: file.revisions.fileWriteVersion + 1 },
    });
    const results = await Promise.allSettled([first.save(changed('A')), second.save(changed('B'))]);
    const winners = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [index === 0 ? 'A' : 'B'] : [],
    );
    expect(winners).toHaveLength(1);
    expect((await first.load(file.projectId))?.domain.project.title).toBe(winners[0]);
    expect(await first.hasPendingWrites(file.projectId)).toBe(false);
  });

  it('内存 KV 适配器：save / load 回环与覆盖写入', async () => {
    const adapter = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    expect(await adapter.load('prj_absent')).toBeNull();
    const file = createMinimalBranchFile();
    await adapter.save(file);
    const loaded = await adapter.load(file.projectId);
    expect(loaded?.domain.nodes).toHaveLength(file.domain.nodes.length);
    expect(loaded?.revisions.semanticHash).toBe(file.revisions.semanticHash);
    await adapter.save({ ...file, revisions: { ...file.revisions, fileWriteVersion: 9 } });
    expect((await adapter.load(file.projectId))?.revisions.fileWriteVersion).toBe(9);
  });

  it('结构化 IndexedDB 假实现：原子 put 后可读回同一 BranchFile', async () => {
    const store = await createIndexedDbKeyValueStore('test-db', fakeFactory());
    const file = createMinimalBranchFile();
    await store.set(projectStorageKey(file.projectId), JSON.stringify(file));
    expect(await store.get(projectStorageKey(file.projectId))).toBe(JSON.stringify(file));
    expect(await store.get('missing')).toBeNull();
    const adapter = new IdbJsonStorageAdapter(store);
    expect((await adapter.load(file.projectId))?.projectId).toBe(file.projectId);
  });

  it('运行时缺少 IndexedDB 时明确报错，不静默降级', async () => {
    await expect(createIndexedDbKeyValueStore('test-db', undefined)).rejects.toThrow(
      /IndexedDB is unavailable|open failed|open blocked/,
    );
  });

  it('损坏的 JSON 被拒绝，不返回半解析状态', async () => {
    const store = createMemoryKeyValueStore();
    await store.set(projectStorageKey('prj_broken'), '{not-json');
    await expect(new IdbJsonStorageAdapter(store).load('prj_broken')).rejects.toThrow();
  });

  it('正常写入后意图日志与临时态均已清理，不残留半写现场', async () => {
    const store = createMemoryKeyValueStore();
    const adapter = new IdbJsonStorageAdapter(store, { storeFactory: () => store });
    const file = createMinimalBranchFile();
    await adapter.save(file);
    expect(await adapter.hasPendingWrites(file.projectId)).toBe(false);
    expect(await store.get(`t:${file.projectId}`)).toBeNull();
    expect((await adapter.load(file.projectId))?.revisions.semanticHash).toBe(
      file.revisions.semanticHash,
    );
  });

  it('stale fileWriteVersion 的重复写入被结构化拒绝，不静默覆盖', async () => {
    const store = createMemoryKeyValueStore();
    const adapter = new IdbJsonStorageAdapter(store, { storeFactory: () => store });
    const file = createMinimalBranchFile();
    await adapter.save(file);
    await expect(adapter.save({ ...file })).rejects.toThrow(/stale fileWriteVersion/);
  });
});
