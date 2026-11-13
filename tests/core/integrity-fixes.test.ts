/**
 * 代码审核修复的回归测试（新增文件，不改动 Phase 0 既有用例）。
 * 覆盖：R5 受控导入三类哈希对账 / 高风险人工确认；
 *       R6 parentId 环、Spine 连续层级边路径、语义 Diff 覆盖范围。
 */
import { describe, expect, it } from 'vitest';
import {
  computeFileHash,
  computeSemanticHash,
  ControlledImportService,
  describeDomainChange,
  InvalidGraphError,
  validateDomain,
  ValidationError,
} from '@workspacetree/core';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';
import type { BranchFile } from '@workspacetree/schema';

const PROJECT_ID = 'prj_fixture_0001';

function fresh(): BranchFile {
  return createMinimalBranchFile();
}

/** 按当前内容重算 semanticHash 与 fileHash，构造自洽文件（presentation 不变）。 */
function selfConsistent(file: BranchFile): BranchFile {
  const copy = structuredClone(file);
  copy.revisions.semanticHash = computeSemanticHash(copy.domain);
  copy.revisions.fileHash = computeFileHash(copy);
  return copy;
}

describe('审核修复 R6：图双源与主干路径', () => {
  it('最小合法图与合法 Spine 通过校验', () => {
    expect(() => validateDomain(fresh().domain)).not.toThrow();
  });

  it('node.parentId 成环被拒（原实现只查 hierarchy 边）', () => {
    const domain = fresh().domain;
    domain.nodes[0]!.parentId = 'n_child';
    domain.nodes[1]!.parentId = 'n_root';
    expect(() => validateDomain(domain)).toThrow(InvalidGraphError);
    expect(() => validateDomain(domain)).toThrow(/parentId cycle/);
  });

  it('Spine 由兄弟节点拼成的非连续路径被拒', () => {
    const domain = fresh().domain;
    domain.nodes.push({
      id: 'n_sibling',
      title: 'Sibling',
      parentId: 'n_root',
      blockIds: [],
      archived: false,
    });
    domain.edges.push({
      id: 'e_h_sibling',
      type: 'hierarchy',
      fromNodeId: 'n_root',
      toNodeId: 'n_sibling',
    });
    domain.spines[0]!.nodeIds = ['n_root', 'n_child', 'n_sibling'];
    expect(() => validateDomain(domain)).toThrow(InvalidGraphError);
    expect(() => validateDomain(domain)).toThrow(/continuous hierarchy path/);
  });

  it('语义 Diff 覆盖边变化、任务状态、归档决策与节点删除', () => {
    const before = fresh().domain;
    const after = structuredClone(before);
    after.edges.push({
      id: 'e_dep_new',
      type: 'dependency',
      fromNodeId: 'n_child',
      toNodeId: 'n_root',
    });
    after.tasks[0]!.done = true;
    after.archived = true;
    after.archiveMeta = {
      reason: 'superseded',
      at: '2026-11-11T00:00:00.000Z',
      replacementBranchId: null,
    };
    after.nodes = after.nodes.filter((node) => node.id !== 'n_child');
    const diff = describeDomainChange(before, after);
    expect(diff).toContain('+ edge e_dep_new dependency');
    expect(diff).toContain('~ task tsk_1 done=true');
    expect(diff).toContain('~ project archived=true reason="superseded"');
    expect(diff).toContain('- node n_child');
  });
});

describe('审核修复 R5：受控导入哈希对账与人工确认', () => {
  it('候选 semanticHash 未重算即被拒，文件保持不变', async () => {
    const storage = new MemoryStorageAdapter();
    const file = fresh();
    await storage.save(file);
    const candidate = selfConsistent(file);
    candidate.domain.nodes.push({
      id: 'n_fake',
      title: 'Forged',
      parentId: null,
      blockIds: [],
      archived: false,
    });
    candidate.revisions.semanticRevision = 999;
    candidate.revisions.semanticHash = 'not-recomputed';
    candidate.revisions.fileHash = computeFileHash(candidate);
    await expect(
      new ControlledImportService(storage).execute({
        operationId: 'op_forged_candidate',
        projectId: PROJECT_ID,
        baseFileHash: file.revisions.fileHash,
        candidate,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(ValidationError);
    expect((await storage.load(PROJECT_ID))?.domain.nodes).toHaveLength(2);
  });

  it('当前落盘文件被外部改写且哈希不匹配时，拒绝作为合并基准', async () => {
    const storage = new MemoryStorageAdapter();
    const tampered = fresh();
    tampered.domain.nodes.push({
      id: 'n_outside',
      title: 'Outside',
      parentId: null,
      blockIds: [],
      archived: false,
    });
    tampered.revisions.semanticHash = 'forged';
    tampered.revisions.fileHash = 'forged';
    await storage.save(tampered);
    const candidate = selfConsistent(tampered);
    await expect(
      new ControlledImportService(storage).execute({
        operationId: 'op_tampered_base',
        projectId: PROJECT_ID,
        baseFileHash: tampered.revisions.fileHash,
        candidate,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('删除类导入必须人工确认；确认后 reviewedBy 写入 Operation.audit', async () => {
    const storage = new MemoryStorageAdapter();
    const base = fresh();
    base.domain.nodes.push({
      id: 'n_spare',
      title: 'Spare',
      parentId: null,
      blockIds: [],
      archived: false,
    });
    const stored = selfConsistent(base);
    await storage.save(stored);

    const candidate = structuredClone(stored);
    candidate.domain.nodes = candidate.domain.nodes.filter((node) => node.id !== 'n_spare');
    candidate.revisions.semanticRevision = stored.revisions.semanticRevision + 1;
    candidate.revisions.semanticHash = computeSemanticHash(candidate.domain);
    candidate.revisions.fileHash = computeFileHash(candidate);

    const service = new ControlledImportService(storage);
    await expect(
      service.execute({
        operationId: 'op_delete_unconfirmed',
        projectId: PROJECT_ID,
        baseFileHash: stored.revisions.fileHash,
        candidate,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/reviewedBy/);
    expect((await storage.load(PROJECT_ID))?.domain.nodes).toHaveLength(3);

    const confirmed = await service.execute({
      operationId: 'op_delete_confirmed',
      projectId: PROJECT_ID,
      baseFileHash: stored.revisions.fileHash,
      candidate,
      expectedRevision: 0,
      reviewedBy: 'reviewer-1',
    });
    expect(confirmed.operation.audit?.reason).toContain('reviewedBy=reviewer-1');
    expect((await storage.load(PROJECT_ID))?.domain.nodes).toHaveLength(2);
  });
});
