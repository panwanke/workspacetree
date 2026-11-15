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

  it('edge.add 支持可选角色，重复延续子节点被拒', () => {
    const file = createMinimalBranchFile();
    const addCont1 = envelope({
      command: {
        type: 'edge.add',
        payload: {
          id: 'e_c1',
          type: 'hierarchy',
          fromNodeId: 'n_root',
          toNodeId: 'n_child',
          role: 'continuation',
        },
      },
    });
    // Minimal file already has e_root_child without role, but let's test adding e_c1
    const res1 = applyCommand(file.domain, file.presentation, addCont1);
    expect(res1.domain.edges.find((e) => e.id === 'e_c1')?.role).toBe('continuation');

    // Trying to add another continuation under n_root is rejected
    const addCont2 = envelope({
      command: {
        type: 'edge.add',
        payload: {
          id: 'e_c2',
          type: 'hierarchy',
          fromNodeId: 'n_root',
          toNodeId: 'n_other',
          role: 'continuation',
        },
      },
    });
    expect(() => applyCommand(res1.domain, res1.presentation, addCont2)).toThrow(ValidationError);

    // Non-hierarchy edge with role is rejected
    const badDep = envelope({
      command: {
        type: 'edge.add',
        payload: {
          id: 'e_dep',
          type: 'dependency',
          fromNodeId: 'n_root',
          toNodeId: 'n_child',
          role: 'branch',
        },
      },
    });
    expect(() => applyCommand(file.domain, file.presentation, badDep)).toThrow(ValidationError);
  });

  it('project.rename 正确更新项目名称，空名称被拒', () => {
    const file = createMinimalBranchFile();
    const result = applyCommand(
      file.domain,
      file.presentation,
      envelope({
        command: { type: 'project.rename', payload: { title: '新项目分支' } },
      }),
    );
    expect(result.domain.project.title).toBe('新项目分支');
    expect(file.domain.project.title).not.toBe('新项目分支');

    expect(() =>
      applyCommand(
        file.domain,
        file.presentation,
        envelope({
          command: { type: 'project.rename', payload: { title: '   ' } },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('stateClass 与命令类型不匹配时拒绝', () => {
    const file = createMinimalBranchFile();
    expect(() =>
      applyCommand(file.domain, file.presentation, envelope({ stateClass: 'presentation' })),
    ).toThrow(ValidationError);
  });

  it('spine.add、spine.rename 与 spine.remove 正确工作', () => {
    const file = createMinimalBranchFile();
    const initialCount = file.domain.spines.length;
    const addResult = applyCommand(
      file.domain,
      file.presentation,
      envelope({
        command: {
          type: 'spine.add',
          payload: { id: 'spn_test', title: '主干 1', nodeIds: ['n_root', 'n_child'] },
        },
      }),
    );
    expect(addResult.domain.spines).toHaveLength(initialCount + 1);
    const added = addResult.domain.spines.find((s) => s.id === 'spn_test');
    expect(added?.title).toBe('主干 1');

    const renameResult = applyCommand(
      addResult.domain,
      addResult.presentation,
      envelope({
        command: {
          type: 'spine.rename',
          payload: { id: 'spn_test', title: '核心发表主线' },
        },
      }),
    );
    const renamed = renameResult.domain.spines.find((s) => s.id === 'spn_test');
    expect(renamed?.title).toBe('核心发表主线');

    // 空名称被拒
    expect(() =>
      applyCommand(
        renameResult.domain,
        renameResult.presentation,
        envelope({
          command: {
            type: 'spine.rename',
            payload: { id: 'spn_test', title: '   ' },
          },
        }),
      ),
    ).toThrow(ValidationError);

    const removeResult = applyCommand(
      renameResult.domain,
      renameResult.presentation,
      envelope({
        command: {
          type: 'spine.remove',
          payload: { id: 'spn_test' },
        },
      }),
    );
    expect(removeResult.domain.spines).toHaveLength(initialCount);
    expect(removeResult.domain.spines.some((s) => s.id === 'spn_test')).toBe(false);
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
