/**
 * 06 §二 Phase 0 验收 12 / 13（T-24）：Node 侧三种实现跑同一份六类场景契约。
 * idb-json-memory 用内存 KV 测试主应用写入协议。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AtomicWriteAdapter,
  createMemoryKeyValueStore,
  IdbJsonStorageAdapter,
  SqliteStorageAdapter,
  type SpikeAdapter,
} from '@workspacetree/storage';
import { runSixScenarios, type SpikeHarness } from './scenarios';

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

function makeHarness(backend: 'node-file-atomic' | 'node-sqlite', dir: string): SpikeHarness {
  const projectId = `prj_spike_${backend.replace(/-/g, '_')}`;
  return {
    projectId,
    runtime: {
      backend,
      runtime: `Node ${process.version}`,
      versions: { node: process.version, platform: process.platform, arch: process.arch },
    },
    createAdapter: async (): Promise<SpikeAdapter> =>
      backend === 'node-file-atomic'
        ? new AtomicWriteAdapter(join(dir, 'files'))
        : new SqliteStorageAdapter(join(dir, 'workspace.db')),
  };
}

/** 复用同一内存 KV 作为「持久化介质」，reopen() 丢弃实例内存态但保留介质。 */
function makeIdbJsonHarness(): SpikeHarness {
  const store = createMemoryKeyValueStore();
  return {
    projectId: 'prj_spike_idb_json',
    runtime: {
      backend: 'idb-json-memory',
      runtime: `Node ${process.version}`,
      versions: { node: process.version, kv: 'createMemoryKeyValueStore' },
    },
    createAdapter: async (): Promise<SpikeAdapter> =>
      new IdbJsonStorageAdapter(store, {
        queueKey: 'idb-json-spike-node-test',
        storeFactory: () => store,
      }),
  };
}

describe('T-24 Node 侧六类存储实测（同一契约）', () => {
  for (const backend of ['node-file-atomic', 'node-sqlite'] as const) {
    it(`${backend} 六类场景全部通过`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wst-spike-'));
      roots.push(dir);
      const report = await runSixScenarios(makeHarness(backend, dir));
      for (const result of report.results) {
        expect(
          result.passed,
          `${result.title}: ${result.detail}${result.steps ? ` / ${result.steps.join(', ')}` : ''}`,
        ).toBe(true);
      }
      expect(report.passed).toBe(true);
    }, 120000);
  }

  it('idb-json-memory（Phase 1 主应用写入协议）六类场景全部通过', async () => {
    const report = await runSixScenarios(makeIdbJsonHarness());
    for (const result of report.results) {
      expect(
        result.passed,
        `${result.title}: ${result.detail}${result.steps ? ` / ${result.steps.join(', ')}` : ''}`,
      ).toBe(true);
    }
    expect(report.passed).toBe(true);
  }, 120000);
});
