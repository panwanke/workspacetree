/**
 * 06 §二 Phase 0 验收 8（核心不变量 A）：纯呈现修改不改变 semanticHash、
 * 不产生语义 Commit、不写入语义 operations。C2 / C8 / ADR-013 / 05 §8.3。
 */
import { describe, expect, it } from 'vitest';
import { CommandService, computeSemanticHash } from '@workspacetree/core';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';

describe('T-08 三层状态隔离', () => {
  it('100 次纯呈现修改不污染语义状态，且呈现修订号独立推进', async () => {
    const storage = new MemoryStorageAdapter();
    const file = createMinimalBranchFile();
    await storage.save(file);
    const service = new CommandService(storage);
    const originalSemanticHash = file.revisions.semanticHash;

    for (let i = 0; i < 100; i += 1) {
      const isScale = i % 2 === 0;
      const outcome = await service.execute({
        operationId: `op_presentation_${i}`,
        projectId: file.projectId,
        stateClass: 'presentation',
        expectedRevision: i,
        actor: { kind: 'human', id: 'tester' },
        command: isScale
          ? { type: 'presentation.setScale', payload: { nodeId: 'n_child', scale: 0.45 } }
          : { type: 'presentation.moveNode', payload: { nodeId: 'n_child', x: i, y: i } },
      });
      expect(outcome.commit).toBeNull();
      expect(outcome.operations.every((op) => op.stateClass === 'presentation')).toBe(true);
    }

    const after = await storage.load(file.projectId);
    expect(after).not.toBeNull();
    expect(after!.revisions.semanticHash).toBe(originalSemanticHash);
    expect(after!.revisions.semanticRevision).toBe(0);
    expect(after!.revisions.presentationRevision).toBe(100);
    expect(after!.revisions.fileWriteVersion).toBe(100);
    expect(computeSemanticHash(after!.domain)).toBe(originalSemanticHash);
    expect(after!.presentation.branchScales['n_child']).toBe(0.45);
  });

  it('呈现修订推进到 100 后，语义命令仍可用 semanticRevision = 0 提交（冲突域互不阻塞）', async () => {
    const storage = new MemoryStorageAdapter();
    const file = createMinimalBranchFile();
    await storage.save(file);
    const service = new CommandService(storage);

    await service.execute({
      operationId: 'op_p_0',
      projectId: file.projectId,
      stateClass: 'presentation',
      expectedRevision: 0,
      actor: { kind: 'human', id: 'tester' },
      command: { type: 'presentation.setScale', payload: { nodeId: 'n_child', scale: 0.45 } },
    });

    const outcome = await service.execute({
      operationId: 'op_d_0',
      projectId: file.projectId,
      stateClass: 'domain',
      expectedRevision: 0,
      actor: { kind: 'agent', id: 'tester-agent' },
      command: { type: 'task.complete', payload: { id: 'tsk_1', done: true } },
    });
    expect(outcome.commit).not.toBeNull();
    const after = await storage.load(file.projectId);
    expect(after!.revisions.semanticRevision).toBe(1);
    expect(after!.revisions.presentationRevision).toBe(1);
    expect(after!.revisions.semanticHash).not.toBe(file.revisions.semanticHash);
  });
});
