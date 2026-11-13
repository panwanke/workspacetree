/**
 * 06 §二 Phase 0 验收 6 / 7 / 10：唯一写入口、双冲突域、幂等与结构化 REVISION_CONFLICT。
 */
import { describe, expect, it } from 'vitest';
import {
  CommandService,
  parseEnvelope,
  RevisionConflictError,
  ValidationError,
} from '@workspacetree/core';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createMinimalBranchFile } from '@workspacetree/cli';

function env(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'op_service_1',
    projectId: 'prj_fixture_0001',
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

describe('T-10 Command Envelope 与唯一写入口', () => {
  it('缺少 operationId / expectedRevision 的写入被拒', async () => {
    expect(() => parseEnvelope({ command: { type: 'node.add' } })).toThrow(ValidationError);
    const { service } = await setup();
    await expect(service.execute({ operationId: 'op_bad' })).rejects.toThrow(ValidationError);
  });

  it('未知命令域被拒', async () => {
    const { service } = await setup();
    await expect(
      service.execute(env({ command: { type: 'import.replaceAll', payload: {} } })),
    ).rejects.toThrow(ValidationError);
  });
});

describe('T-11 乐观并发与冲突域', () => {
  it('过期 expectedRevision 返回结构化 REVISION_CONFLICT 并附可读 Diff', async () => {
    const { service } = await setup();
    try {
      await service.execute(env({ expectedRevision: 99 }));
      throw new Error('expected a revision conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(RevisionConflictError);
      const conflict = error as RevisionConflictError;
      expect(conflict.domain).toBe('semanticRevision');
      expect(conflict.expected).toBe(99);
      expect(conflict.current).toBe(0);
      expect(conflict.diff).toContain('current');
      expect(conflict.diff).toContain('hint');
    }
  });

  it('语义写入推进后，呈现命令仍按自己的修订号校验', async () => {
    const { service } = await setup();
    await service.execute(env());
    const presentation = await service.execute({
      operationId: 'op_p_after_domain',
      projectId: 'prj_fixture_0001',
      stateClass: 'presentation',
      expectedRevision: 0,
      actor: { kind: 'human', id: 'tester' },
      command: { type: 'presentation.setScale', payload: { nodeId: 'n_child', scale: 0.45 } },
    });
    expect(presentation.newRevision).toBe(1);
    expect(presentation.stateClass).toBe('presentation');
  });
});

describe('T-12 operationId 幂等', () => {
  it('同一 operationId 重放不重复写盘、不重复建节点', async () => {
    const { storage, service, file } = await setup();
    const first = await service.execute(env());
    const second = await service.execute(env());
    expect(second.newRevision).toBe(first.newRevision);
    expect(second.operations).toHaveLength(0);
    const after = await storage.load(file.projectId);
    expect(after!.domain.nodes).toHaveLength(3);
    expect(after!.revisions.fileWriteVersion).toBe(1);
  });
});
