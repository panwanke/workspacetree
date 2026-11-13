/**
 * U06 六类存储实测场景（05 §十 / 06 §二 Phase 0 验收 12）。
 * 本文件是浏览器与桌面实现共用的**同一份**契约测试：
 * 任何满足 SpikeAdapter 的后端都必须通过这六类场景，不得各自写一套。
 * 只依赖纯 TS 的 core / schema，不 import 任何 Node 或浏览器专有 API。
 */
import { computeFileHash, computePresentationHash, computeSemanticHash } from '@workspacetree/core';
import { BranchFileSchema, SCHEMA_VERSION, type BranchFile } from '@workspacetree/schema';
import type {
  RuntimeInfo,
  ScenarioKey,
  ScenarioResult,
  SpikeAdapter,
  WriteStep,
} from '@workspacetree/storage';

export const SCENARIO_TITLES: Record<ScenarioKey, string> = {
  persistence: '① 数据持久化',
  concurrency: '② 并发写入',
  interruption: '③ 异常中断（各写入步骤注入）',
  reopen: '④ 重新打开',
  permission: '⑤ 权限变化（授权撤销 / 只读）',
  'import-export': '⑥ 项目文件导入导出',
};

export const INTERRUPTION_STEPS: readonly WriteStep[] = ['intent', 'temp', 'replace', 'commit'];

export interface SpikeHarness {
  createAdapter(): Promise<SpikeAdapter>;
  projectId: string;
  runtime: RuntimeInfo;
}

export interface SpikeReport {
  runtime: RuntimeInfo;
  results: ScenarioResult[];
  passed: boolean;
  finishedAt: string;
}

export function createScenarioFile(projectId: string): BranchFile {
  const domain: BranchFile['domain'] = {
    project: { id: projectId, title: 'Storage spike fixture', rootNodeId: 'n_root' },
    nodes: [
      { id: 'n_root', title: 'Root', parentId: null, blockIds: [], archived: false },
      { id: 'n_child', title: 'Child', parentId: 'n_root', blockIds: [], archived: false },
    ],
    edges: [{ id: 'e_h_1', type: 'hierarchy', fromNodeId: 'n_root', toNodeId: 'n_child' }],
    tasks: [{ id: 'tsk_1', nodeId: 'n_child', title: 'Spike task', done: false }],
    spines: [{ id: 'spn_main', title: 'Main', nodeIds: ['n_root', 'n_child'] }],
    blocks: [],
    projectRefs: [],
    archived: false,
    archiveMeta: null,
  };
  const presentation: BranchFile['presentation'] = {
    nodePositions: {},
    branchScales: {},
    collapsedByDefault: [],
    savedSpineDisplay: null,
  };
  const file: BranchFile = {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeBranch: 'main',
    domain,
    presentation,
    revisions: {
      semanticRevision: 0,
      semanticHash: '',
      presentationRevision: 0,
      presentationHash: '',
      fileHash: '',
      fileWriteVersion: 0,
    },
  };
  file.revisions.semanticHash = computeSemanticHash(domain);
  file.revisions.presentationHash = computePresentationHash(presentation);
  file.revisions.fileHash = computeFileHash(file);
  return BranchFileSchema.parse(file);
}

/** 生成一次合法的语义写入（新节点 + 修订号 + 三类哈希重算）。 */
export function withExtraNode(file: BranchFile, id: string): BranchFile {
  const next = structuredClone(file);
  next.domain.nodes.push({
    id,
    title: `Node ${id}`,
    parentId: 'n_root',
    blockIds: [],
    archived: false,
  });
  next.revisions.semanticRevision += 1;
  next.revisions.semanticHash = computeSemanticHash(next.domain);
  next.revisions.presentationHash = computePresentationHash(next.presentation);
  next.revisions.fileWriteVersion += 1;
  next.revisions.fileHash = '';
  next.revisions.fileHash = computeFileHash(next);
  return BranchFileSchema.parse(next);
}

async function timed(
  key: ScenarioKey,
  body: () => Promise<Omit<ScenarioResult, 'id' | 'key' | 'title' | 'durationMs'>>,
): Promise<ScenarioResult> {
  const started = Date.now();
  try {
    const result = await body();
    return { id: 0, key, title: SCENARIO_TITLES[key], durationMs: Date.now() - started, ...result };
  } catch (error) {
    return {
      id: 0,
      key,
      title: SCENARIO_TITLES[key],
      passed: false,
      detail: `场景抛出异常：${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - started,
    };
  }
}

async function persistence(h: SpikeHarness) {
  return timed('persistence', async () => {
    const adapter = await h.createAdapter();
    try {
      await adapter.clear(h.projectId);
      const base = createScenarioFile(h.projectId);
      await adapter.save(base);
      const reopened = await adapter.reopen();
      const loaded = await reopened.load(h.projectId);
      await reopened.close();
      const ok =
        loaded !== null &&
        computeFileHash(loaded) === base.revisions.fileHash &&
        loaded.revisions.semanticHash === base.revisions.semanticHash;
      return {
        passed: ok,
        detail: ok
          ? `新实例读回 fileHash=${base.revisions.fileHash.slice(0, 16)}…、semanticHash 一致`
          : '读回状态与写入状态不一致',
      };
    } finally {
      await adapter.close();
    }
  });
}

async function concurrency(h: SpikeHarness) {
  return timed('concurrency', async () => {
    const a = await h.createAdapter();
    const b = await h.createAdapter();
    try {
      await a.clear(h.projectId);
      const base = createScenarioFile(h.projectId);
      await a.save(base);
      const nextA = withExtraNode(base, 'n_conc_a');
      const nextB = withExtraNode(base, 'n_conc_b');
      const settled = await Promise.allSettled([a.save(nextA), b.save(nextB)]);
      const successes = settled.filter((item) => item.status === 'fulfilled').length;
      const reason = settled
        .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
        .map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason)))
        .join(' | ');
      const reopened = await a.reopen();
      const final = await reopened.load(h.projectId);
      await reopened.close();
      const finalHash = final?.revisions.semanticHash;
      const ok =
        successes === 1 &&
        (finalHash === nextA.revisions.semanticHash || finalHash === nextB.revisions.semanticHash);
      return {
        passed: ok,
        detail: ok
          ? `两个写入者并发提交，成功 ${successes}/2，落盘状态为其中一个写入且可解释；拒绝原因：${reason.slice(0, 160)}`
          : `成功 ${successes}/2，最终状态不可由单次写入解释（存在静默覆盖风险）`,
      };
    } finally {
      await a.close();
      await b.close();
    }
  });
}

async function interruption(h: SpikeHarness) {
  return timed('interruption', async () => {
    const steps: string[] = [];
    let allOk = true;
    for (const step of INTERRUPTION_STEPS) {
      const adapter = await h.createAdapter();
      try {
        await adapter.clear(h.projectId);
        const base = createScenarioFile(h.projectId);
        await adapter.save(base);
        const next = withExtraNode(base, `n_crash_${step}`);
        adapter.setCrash({ failAt: step });
        let crashed = false;
        try {
          await adapter.save(next);
        } catch {
          crashed = true;
        }
        const reopened = await adapter.reopen();
        let outcome = 'error';
        try {
          outcome = (await reopened.recover(h.projectId)).outcome;
        } catch {
          outcome = 'conflict';
        }
        const loaded = await reopened.load(h.projectId).catch(() => null);
        await reopened.close();
        const ok =
          crashed &&
          (outcome === 'rolled-forward' || outcome === 'completed') &&
          loaded?.revisions.semanticHash === next.revisions.semanticHash;
        steps.push(`${step}: ${ok ? '恢复一致' : `失败(${outcome})`}`);
        if (!ok) allOk = false;
      } finally {
        await adapter.close();
      }
    }
    return {
      passed: allOk,
      detail: allOk
        ? '四个写入步骤逐一注入崩溃后，重启均恢复到一致状态'
        : '至少一个注入点未恢复到一致状态',
      steps,
    };
  });
}

async function reopen(h: SpikeHarness) {
  return timed('reopen', async () => {
    const adapter = await h.createAdapter();
    try {
      await adapter.clear(h.projectId);
      const base = createScenarioFile(h.projectId);
      await adapter.save(base);
      const first = await adapter.reopen();
      const second = await first.reopen();
      const loaded = await second.load(h.projectId);
      await first.close();
      await second.close();
      const ok = loaded !== null && computeFileHash(loaded) === base.revisions.fileHash;
      return {
        passed: ok,
        detail: ok ? '连续两次重新打开实例，fileHash 与三类修订号保持一致' : '重新打开后状态不一致',
      };
    } finally {
      await adapter.close();
    }
  });
}

async function permission(h: SpikeHarness) {
  return timed('permission', async () => {
    const adapter = await h.createAdapter();
    try {
      await adapter.clear(h.projectId);
      const base = createScenarioFile(h.projectId);
      await adapter.save(base);
      await adapter.setDenied(true);
      const next = withExtraNode(base, 'n_denied');
      let denied = false;
      try {
        await adapter.save(next);
      } catch {
        denied = true;
      }
      await adapter.setDenied(false);
      const reopened = await adapter.reopen();
      let outcome = 'error';
      try {
        outcome = (await reopened.recover(h.projectId)).outcome;
      } catch {
        outcome = 'conflict';
      }
      const loaded = await reopened.load(h.projectId).catch(() => null);
      await reopened.close();
      const recoveredHash = loaded ? computeFileHash(loaded) : '';
      const acceptable = [base.revisions.fileHash, next.revisions.fileHash];
      const ok = denied && acceptable.includes(recoveredHash) && outcome !== 'conflict';
      return {
        passed: ok,
        detail: ok
          ? `权限撤销时写入被结构化拒绝；恢复结果=${outcome}，落盘状态为写入前或写入后的完整状态，无半写/无静默覆盖`
          : `权限变化处理不符合预期（denied=${denied}, outcome=${outcome}）`,
      };
    } finally {
      await adapter.close();
    }
  });
}

async function importExport(h: SpikeHarness) {
  return timed('import-export', async () => {
    const adapter = await h.createAdapter();
    try {
      await adapter.clear(h.projectId);
      const base = withExtraNode(createScenarioFile(h.projectId), 'n_export');
      await adapter.save(base);
      const pack = await adapter.exportPack(h.projectId);
      await adapter.clear(h.projectId);
      const emptyAdapter = await adapter.reopen();
      const empty = await emptyAdapter.load(h.projectId);
      await emptyAdapter.close();
      await adapter.importPack(pack ?? '');
      const finalAdapter = await adapter.reopen();
      const loaded = await finalAdapter.load(h.projectId);
      await finalAdapter.close();
      const ok =
        pack !== null &&
        empty === null &&
        loaded?.revisions.semanticHash === base.revisions.semanticHash &&
        computeFileHash(loaded) === base.revisions.fileHash;
      return {
        passed: ok,
        detail: ok
          ? '导出 pack → 清库 → 导入，语义哈希与 fileHash 完整还原'
          : '导入导出后状态不完整',
      };
    } finally {
      await adapter.close();
    }
  });
}

export async function runSixScenarios(h: SpikeHarness): Promise<SpikeReport> {
  const results = [
    await persistence(h),
    await concurrency(h),
    await interruption(h),
    await reopen(h),
    await permission(h),
    await importExport(h),
  ].map((result, index) => ({ ...result, id: index + 1 }));
  return {
    runtime: h.runtime,
    results,
    passed: results.every((result) => result.passed),
    finishedAt: new Date().toISOString(),
  };
}
