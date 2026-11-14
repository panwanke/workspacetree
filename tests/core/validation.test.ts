/** 06 §二 Phase 0 验收 2：成环 / 重复 ID / 无效 node ID / 非法 scale 被拒且错误类型明确。 */
import { describe, expect, it } from 'vitest';
import { InvalidGraphError, validateDomain, validatePresentation } from '@workspacetree/core';
import { createMinimalBranchFile } from '@workspacetree/cli';

function freshDomain() {
  return createMinimalBranchFile().domain;
}

describe('T-06 图合法性与引用完整性', () => {
  it('最小合法图通过校验', () => {
    expect(() => validateDomain(freshDomain())).not.toThrow();
  });

  it('hierarchy 成环被拒', () => {
    const domain = freshDomain();
    domain.edges.push({
      id: 'e_cycle',
      type: 'hierarchy',
      fromNodeId: 'n_child',
      toNodeId: 'n_root',
    });
    expect(() => validateDomain(domain)).toThrow(InvalidGraphError);
  });

  it('hierarchy 单父规则被违反时拒绝', () => {
    const domain = freshDomain();
    domain.edges.push({
      id: 'e_second_parent',
      type: 'hierarchy',
      fromNodeId: 'n_root',
      toNodeId: 'n_child',
    });
    expect(() => validateDomain(domain)).toThrow(/single-parent/);
  });

  it('重复 ID 被拒', () => {
    const domain = freshDomain();
    domain.nodes.push({ ...domain.nodes[0]! });
    expect(() => validateDomain(domain)).toThrow(/duplicate node id/);
  });

  it('无效 node ID / 悬空引用被拒', () => {
    const domain = freshDomain();
    domain.tasks.push({
      id: 'tsk_missing',
      nodeId: 'n_does_not_exist',
      title: 'dangling',
      done: false,
    });
    expect(() => validateDomain(domain)).toThrow(/missing node/);
  });

  it('非法 scale（0 / 超过 2 / 负数）被拒并带明确错误', () => {
    for (const scale of [0, 2.5, -0.2, Number.NaN]) {
      const presentation = createMinimalBranchFile().presentation;
      presentation.branchScales['n_child'] = scale;
      expect(() => validatePresentation(presentation)).toThrow(InvalidGraphError);
    }
  });

  it('同一父节点存在多个显式延续子节点时被拒', () => {
    const domain = freshDomain();
    domain.nodes.push({
      id: 'n_child_2',
      title: 'Second child',
      parentId: 'n_root',
      blockIds: [],
      archived: false,
      startAt: null,
    });
    domain.edges.find((e) => e.toNodeId === 'n_child')!.role = 'continuation';
    domain.edges.push({
      id: 'e_cont_2',
      type: 'hierarchy',
      fromNodeId: 'n_root',
      toNodeId: 'n_child_2',
      role: 'continuation',
    });
    expect(() => validateDomain(domain)).toThrow(/multiple continuation/);
  });

  it('非 hierarchy 边携带层级角色时被拒', () => {
    const domain = freshDomain();
    domain.edges.push({
      id: 'e_dep_bad',
      type: 'dependency',
      fromNodeId: 'n_child',
      toNodeId: 'n_root',
      role: 'branch',
    });
    expect(() => validateDomain(domain)).toThrow(/non-hierarchy edge cannot have a hierarchy role/);
  });

  it('合法 scale = 0.45 通过', () => {
    const presentation = createMinimalBranchFile().presentation;
    presentation.branchScales['n_child'] = 0.45;
    expect(() => validatePresentation(presentation)).not.toThrow();
  });
});
