/** 06 §二 Phase 0 验收 5：纯函数 reducer 在无 React / 无浏览器 / 无桌面壳环境独立运行。 */
import { describe, expect, it } from 'vitest';
import { applyCommand, canonicalize, ValidationError } from '@workspacetree/core';
import type { CommandEnvelope } from '@workspacetree/schema';
import { createMinimalBranchFile } from '@workspacetree/cli';

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    operationId: 'op_reducer_1',
    projectId: 'prj_fixture_0001',
    stateClass: 'domain',
    expectedRevision: 0,
    actor: { kind: 'human', id: 'tester' },
    command: { type: 'node.add', payload: { id: 'n_new', title: 'New node' } },
    ...overrides,
  };
}

describe('T-07 纯函数 reducer', () => {
  it('domain 命令产生语义 operation 与 Commit，且不修改输入对象', () => {
    const file = createMinimalBranchFile();
    const before = canonicalize(file.domain);
    const result = applyCommand(file.domain, file.presentation, envelope());
    expect(canonicalize(file.domain)).toBe(before);
    expect(result.domain.nodes).toHaveLength(3);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.stateClass).toBe('domain');
    expect(result.commit).not.toBeNull();
  });

  it('presentation 命令不产生语义 Commit，不改 DomainState', () => {
    const file = createMinimalBranchFile();
    const result = applyCommand(
      file.domain,
      file.presentation,
      envelope({
        operationId: 'op_reducer_2',
        stateClass: 'presentation',
        command: { type: 'presentation.setScale', payload: { nodeId: 'n_child', scale: 0.45 } },
      }),
    );
    expect(result.commit).toBeNull();
    expect(result.operations[0]?.stateClass).toBe('presentation');
    expect(canonicalize(result.domain)).toBe(canonicalize(file.domain));
    expect(result.presentation.branchScales['n_child']).toBe(0.45);
  });

  it('stateClass 与命令类型不匹配时拒绝', () => {
    const file = createMinimalBranchFile();
    expect(() =>
      applyCommand(file.domain, file.presentation, envelope({ stateClass: 'presentation' })),
    ).toThrow(ValidationError);
  });

  it('未知命令被拒', () => {
    const file = createMinimalBranchFile();
    expect(() =>
      applyCommand(
        file.domain,
        file.presentation,
        envelope({ command: { type: 'project.deleteAll', payload: {} } }),
      ),
    ).toThrow(ValidationError);
  });
});
