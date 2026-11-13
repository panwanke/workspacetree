/**
 * 06 §二 Phase 0 验收 11 / 15 / 16（T-17 ~ T-22）：
 * dryRun、批量 ChangeSet、audit、activeBranch 切换与未提交更改、import.* 受控导入。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BranchSwitchService,
  CommandService,
  ControlledImportService,
  computeFileHash,
  computeSemanticHash,
  ExternalChangeError,
  MemoryIdempotencyCache,
  parseEnvelope,
  UncommittedChangesError,
  ValidationError,
  type BranchSnapshot,
  type BranchSource,
} from '@workspacetree/core';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { COMMAND_DOMAINS, COMMAND_TYPE_PATTERN, type BranchFile } from '@workspacetree/schema';

const PROJECT_ID = 'prj_fixture_0001';

function env(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'op_ext_1',
    projectId: PROJECT_ID,
    stateClass: 'domain',
    expectedRevision: 0,
    actor: { kind: 'human', id: 'tester' },
    command: { type: 'node.add', payload: { id: 'n_added', title: 'Added' } },
    ...overrides,
  };
}

async function setup() {
  const storage = new MemoryStorageAdapter();
  const file = createMinimalBranchFile();
  await storage.save(file);
  return { storage, file, service: new CommandService(storage) };
}

function withExtraNode(file: BranchFile, id: string): BranchFile {
  const candidate = structuredClone(file);
  candidate.domain.nodes.push({
    id,
    title: `External ${id}`,
    parentId: 'n_root',
    blockIds: [],
    archived: false,
  });
  candidate.revisions.semanticHash = computeSemanticHash(candidate.domain);
  candidate.revisions.semanticRevision = file.revisions.semanticRevision + 1;
  candidate.revisions.fileHash = computeFileHash(candidate);
  return candidate;
}

describe('T-17 dryRun 不产生副作用', () => {
  it('dryRun 不落盘、不产生 Operation / Commit、不登记幂等', async () => {
    const { storage, file, service } = await setup();
    const save = vi.spyOn(storage, 'save');
    const outcome = await service.execute(env({ dryRun: true }));

    expect(outcome.dryRun).toBe(true);
    expect(outcome.persisted).toBe(false);
    expect(outcome.operations).toEqual([]);
    expect(outcome.commit).toBeNull();
    expect(outcome.newRevision).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect((await storage.load(PROJECT_ID))?.revisions.semanticRevision).toBe(0);
    expect(computeFileHash((await storage.load(PROJECT_ID)) as BranchFile)).toBe(
      file.revisions.fileHash,
    );
  });

  it('dryRun 后同一 operationId 的真实写入仍可执行（幂等缓存未被污染）', async () => {
    const { storage, service } = await setup();
    await service.execute(env({ dryRun: true }));
    const real = await service.execute(env());
    expect(real.persisted).toBe(true);
    expect((await storage.load(PROJECT_ID))?.domain.nodes.some((n) => n.id === 'n_added')).toBe(
      true,
    );
  });

  it('批量 dryRun 同样不落盘', async () => {
    const { storage, service } = await setup();
    const save = vi.spyOn(storage, 'save');
    const outcome = await service.executeBatch({
      ...env({ commands: [{ type: 'node.add', payload: { id: 'n_b1', title: 'B1' } }] }),
      command: undefined,
      dryRun: true,
    });
    expect(outcome.dryRun).toBe(true);
    expect(outcome.operations).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('T-18 批量 ChangeSet 一次校验、一次应用、失败整批回滚', () => {
  it('三条命令一次落盘，产生 3 个 Operation 与 1 个 Commit', async () => {
    const { storage, service } = await setup();
    const save = vi.spyOn(storage, 'save');
    const outcome = await service.executeBatch({
      ...env(),
      command: undefined,
      commands: [
        { type: 'node.add', payload: { id: 'n_b1', title: 'B1' } },
        { type: 'node.add', payload: { id: 'n_b2', title: 'B2' } },
        { type: 'task.add', payload: { id: 'tsk_b1', nodeId: 'n_b1', title: 'Task B1' } },
      ],
    });
    expect(outcome.persisted).toBe(true);
    expect(outcome.operations).toHaveLength(3);
    expect(outcome.commit?.operationIds).toHaveLength(3);
    expect(save).toHaveBeenCalledTimes(1);
    const stored = await storage.load(PROJECT_ID);
    expect(stored?.domain.nodes).toHaveLength(4);
    expect(stored?.revisions.semanticRevision).toBe(1);
  });

  it('任一命令失败则整批不落盘，状态与修订号不变', async () => {
    const { storage, file, service } = await setup();
    const save = vi.spyOn(storage, 'save');
    await expect(
      service.executeBatch({
        ...env(),
        command: undefined,
        commands: [
          { type: 'node.add', payload: { id: 'n_ok', title: 'OK' } },
          { type: 'task.complete', payload: { id: 'tsk_missing', done: true } },
        ],
      }),
    ).rejects.toThrow(ValidationError);
    expect(save).not.toHaveBeenCalled();
    expect(computeFileHash((await storage.load(PROJECT_ID)) as BranchFile)).toBe(
      file.revisions.fileHash,
    );
  });

  it('presentation 批次不产生 Commit、不写 domain operations', async () => {
    const { service, file } = await setup();
    const outcome = await service.executeBatch({
      ...env({ stateClass: 'presentation', expectedRevision: file.revisions.presentationRevision }),
      command: undefined,
      commands: [
        { type: 'presentation.moveNode', payload: { nodeId: 'n_root', x: 1, y: 2 } },
        { type: 'presentation.setScale', payload: { nodeId: 'n_child', scale: 0.5 } },
      ],
    });
    expect(outcome.commit).toBeNull();
    expect(outcome.operations.every((op) => op.stateClass === 'presentation')).toBe(true);
    expect(outcome.stateHash).not.toBe(file.revisions.semanticHash);
  });

  it('批量重放命中幂等缓存，不重复落盘', async () => {
    const { storage } = await setup();
    const cache = new MemoryIdempotencyCache();
    const scoped = new CommandService(storage, cache);
    const request = {
      ...env(),
      command: undefined,
      commands: [{ type: 'node.add', payload: { id: 'n_b1', title: 'B1' } }],
    };
    const first = await scoped.executeBatch(request);
    const save = vi.spyOn(storage, 'save');
    const second = await scoped.executeBatch(request);
    expect(second.persisted).toBe(false);
    expect(second.newRevision).toBe(first.newRevision);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('T-19 actor.kind 三值与 audit 持久化', () => {
  it('三类来源均可执行，未提供 audit 时自动补齐时间与来源', async () => {
    for (const kind of ['human', 'agent', 'external-import'] as const) {
      const { service } = await setup();
      const outcome = await service.execute(
        env({ operationId: `op_${kind}`, actor: { kind, id: 'u1' } }),
      );
      expect(outcome.operations[0].actor.kind).toBe(kind);
      expect(outcome.operations[0].audit?.at).toBeTruthy();
      expect(outcome.operations[0].audit?.source).toBe(kind);
    }
  });

  it('显式 audit（含 baseFileHash / reason）随 Operation 持久化', async () => {
    const { service } = await setup();
    const audit = {
      at: '2026-11-11T00:00:00.000Z',
      source: 'cli',
      baseFileHash: 'abc',
      reason: 'manual',
    };
    const outcome = await service.execute(env({ audit }));
    expect(outcome.operations[0].audit).toEqual(audit);
  });

  it('import.* 命令域已冻结，未知域在 Envelope 校验阶段被拒', () => {
    expect(COMMAND_DOMAINS).toContain('import');
    expect(COMMAND_TYPE_PATTERN.test('import.externalChange')).toBe(true);
    expect(COMMAND_TYPE_PATTERN.test('unknown.thing')).toBe(false);
    expect(() => parseEnvelope(env({ command: { type: 'unknown.thing', payload: {} } }))).toThrow(
      ValidationError,
    );
  });
});

describe('T-20 activeBranch 切换与未提交更改处理', () => {
  function branchSetup(uncommitted = false) {
    const storage = new MemoryStorageAdapter();
    const file = createMinimalBranchFile();
    const backups: { branch: string; file: BranchFile }[] = [];
    const snapshot: BranchSnapshot = {
      domain: withExtraNode(file, 'n_branch_b').domain,
      presentation: structuredClone(file.presentation),
    };
    const source: BranchSource = {
      load: async (_projectId, name) => (name === 'feature-b' ? structuredClone(snapshot) : null),
    };
    const service = new BranchSwitchService(storage, source, {
      uncommitted: { hasUncommitted: () => uncommitted },
      backup: {
        write: async (_projectId, branch, snapshotFile) => {
          backups.push({ branch, file: snapshotFile });
        },
      },
    });
    return { storage, file, service, backups };
  }

  const request = (extra: Record<string, unknown> = {}) => ({
    operationId: 'op_switch_1',
    projectId: PROJECT_ID,
    targetBranch: 'feature-b',
    expectedRevision: 0,
    actor: { kind: 'human' as const, id: 'tester' },
    ...extra,
  });

  it('切换重建文件、更新 activeBranch 与三类哈希', async () => {
    const { storage, file, service } = branchSetup();
    await storage.save(file);
    const outcome = await service.switchActiveBranch(request());
    const stored = await storage.load(PROJECT_ID);
    expect(outcome.changed).toBe(true);
    expect(stored?.activeBranch).toBe('feature-b');
    expect(stored?.domain.nodes.some((n) => n.id === 'n_branch_b')).toBe(true);
    expect(stored?.revisions.semanticHash).toBe(computeSemanticHash(stored!.domain));
    expect(stored?.revisions.fileHash).toBe(computeFileHash(stored!));
    expect(stored?.revisions.fileWriteVersion).toBe(1);
  });

  it('存在未提交更改时默认拒绝，文件保持不变且错误结构化', async () => {
    const { storage, file, service } = branchSetup(true);
    await storage.save(file);
    await expect(service.switchActiveBranch(request())).rejects.toMatchObject({
      name: 'UncommittedChangesError',
      code: 'UNCOMMITTED_CHANGES',
    });
    await expect(service.switchActiveBranch(request())).rejects.toThrow(UncommittedChangesError);
    expect(computeFileHash((await storage.load(PROJECT_ID)) as BranchFile)).toBe(
      file.revisions.fileHash,
    );
  });

  it('policy=backup 先写入备份再切换，绝不静默覆盖', async () => {
    const { storage, file, service, backups } = branchSetup(true);
    await storage.save(file);
    const outcome = await service.switchActiveBranch(request({ policy: 'backup' }));
    expect(outcome.backupWritten).toBe(true);
    expect(backups).toHaveLength(1);
    expect(backups[0].branch).toBe('main');
    expect(computeFileHash(backups[0].file)).toBe(file.revisions.fileHash);
  });

  it('缺少备份出口时 policy=backup 被拒，不落盘', async () => {
    const { storage, file } = branchSetup(true);
    await storage.save(file);
    const source: BranchSource = { load: async () => null };
    const service = new BranchSwitchService(storage, source, {
      uncommitted: { hasUncommitted: () => true },
    });
    await expect(service.switchActiveBranch(request({ policy: 'backup' }))).rejects.toThrow(
      ValidationError,
    );
    expect(computeFileHash((await storage.load(PROJECT_ID)) as BranchFile)).toBe(
      file.revisions.fileHash,
    );
  });
});

describe('T-21 / T-22 import.* 受控导入流程', () => {
  async function importSetup() {
    const storage = new MemoryStorageAdapter();
    const file = createMinimalBranchFile();
    await storage.save(file);
    const candidate = withExtraNode(file, 'n_external');
    const service = new ControlledImportService(storage);
    return { storage, file, candidate, service };
  }

  it('正常导入：语义 Diff + external-import Operation + Commit + 一次落盘', async () => {
    const { storage, file, candidate, service } = await importSetup();
    const save = vi.spyOn(storage, 'save');
    const outcome = await service.execute({
      operationId: 'op_import_1',
      projectId: PROJECT_ID,
      baseFileHash: file.revisions.fileHash,
      candidate,
      expectedRevision: 0,
    });
    expect(outcome.diff).toContain('+ node n_external');
    expect(outcome.operation.type).toBe('import.externalChange');
    expect(outcome.operation.actor.kind).toBe('external-import');
    expect(outcome.operation.audit?.baseFileHash).toBe(file.revisions.fileHash);
    expect(outcome.commit.semanticHash).toBe(computeSemanticHash(candidate.domain));
    expect(save).toHaveBeenCalledTimes(1);
    const stored = await storage.load(PROJECT_ID);
    expect(stored?.revisions.fileHash).toBe(computeFileHash(stored!));
  });

  it('baseFileHash 不匹配 → 外部修改冲突，不落盘', async () => {
    const { storage, candidate, service } = await importSetup();
    await expect(
      service.execute({
        operationId: 'op_import_2',
        projectId: PROJECT_ID,
        baseFileHash: 'stale-hash',
        candidate,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(ExternalChangeError);
    expect((await storage.load(PROJECT_ID))?.domain.nodes).toHaveLength(2);
  });

  it('存在内存未保存内容 → 拒绝导入并保留两侧', async () => {
    const { storage, file, candidate, service } = await importSetup();
    let captured: unknown;
    try {
      await service.execute({
        operationId: 'op_import_3',
        projectId: PROJECT_ID,
        baseFileHash: file.revisions.fileHash,
        candidate,
        expectedRevision: 0,
        hasInMemoryEdits: true,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ExternalChangeError);
    expect((captured as ExternalChangeError).details).toMatchObject({ bothSidesPreserved: true });
    expect((await storage.load(PROJECT_ID))?.domain.nodes).toHaveLength(2);
  });

  it('非法候选文件被 Schema 拒绝，校验失败不登记历史', async () => {
    const { storage, file, service } = await importSetup();
    await expect(
      service.execute({
        operationId: 'op_import_4',
        projectId: PROJECT_ID,
        baseFileHash: file.revisions.fileHash,
        candidate: { schemaVersion: 1 },
        expectedRevision: 0,
      }),
    ).rejects.toThrow(ValidationError);
    expect(computeFileHash((await storage.load(PROJECT_ID)) as BranchFile)).toBe(
      file.revisions.fileHash,
    );
  });
});
