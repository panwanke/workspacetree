import { describe, expect, it } from 'vitest';
import { createDemoBranchFile } from '../../apps/web/src/demo';
import { extractProjectStructure } from '../../apps/web/src/project-branches';
import type { DomainState } from '@workspacetree/schema';

describe('extractProjectStructure', () => {
  it('正确提取 Demo 项目中的主干、侧枝与引用关系', () => {
    const file = createDemoBranchFile();
    const structure = extractProjectStructure(file.domain);

    // 1. Spines: Demo has 3 spines
    expect(structure.spines).toHaveLength(file.domain.spines.length);
    expect(structure.spines[0]?.title).toBe('主干 1 · 论文写作');
    expect(structure.spines[0]?.nodeCount).toBeGreaterThan(1);
    expect(structure.spines[0]?.startTitle).toBeTruthy();
    expect(structure.spines[0]?.endTitle).toBeTruthy();

    // 2. Branches: Demo has multiple hierarchy side branches
    expect(structure.branches.length).toBeGreaterThan(0);
    for (const branch of structure.branches) {
      expect(branch.title).toBeTruthy();
      expect(branch.color).toBeTruthy();
      expect(branch.nodeCount).toBeGreaterThanOrEqual(1);
      expect(branch.deepestLeafId).toBeTruthy();
    }

    // 3. References: Demo has cross-branch dependency edges
    expect(structure.references.length).toBeGreaterThan(0);
    const edgeRef = structure.references.find((r) => r.type === 'edge_ref');
    expect(edgeRef).toBeDefined();
    if (edgeRef && edgeRef.type === 'edge_ref') {
      expect(edgeRef.fromTitle).toBeTruthy();
      expect(edgeRef.toTitle).toBeTruthy();
    }
  });

  it('能正确识别粘贴或独立未挂载的分支', () => {
    const file = createDemoBranchFile();
    const domain: DomainState = {
      ...file.domain,
      nodes: [
        ...file.domain.nodes,
        {
          id: 'n_pasted_root',
          title: '粘贴进来的子项目根',
          parentId: null,
          archived: false,
          blockIds: [],
        },
        {
          id: 'n_pasted_sub',
          title: '粘贴的子任务',
          parentId: 'n_pasted_root',
          archived: false,
          blockIds: [],
        },
      ],
      edges: [
        ...file.domain.edges,
        {
          id: 'e_pasted_1',
          type: 'hierarchy',
          fromNodeId: 'n_pasted_root',
          toNodeId: 'n_pasted_sub',
        },
      ],
      projectRefs: [
        {
          projectId: 'subproject_alpha',
          mode: 'link',
          hostNodeId: 'n_root',
        },
      ],
    };

    const structure = extractProjectStructure(domain);
    const pastedBranch = structure.branches.find((b) => b.id === 'n_pasted_root');
    expect(pastedBranch).toBeDefined();
    expect(pastedBranch?.isIndependent).toBe(true);
    expect(pastedBranch?.nodeCount).toBe(2);
    expect(pastedBranch?.deepestLeafId).toBe('n_pasted_sub');

    const projRef = structure.references.find(
      (r) => r.type === 'project_ref' && r.projectId === 'subproject_alpha',
    );
    expect(projRef).toBeDefined();
    if (projRef && projRef.type === 'project_ref') {
      expect(projRef.hostTitle).toBe('博士论文');
    }
  });
});
