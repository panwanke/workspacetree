import type { DomainState, Node } from '@workspacetree/schema';

export function syntheticNodeId(index: number): string {
  return `n_${index.toString().padStart(6, '0')}`;
}

export function createSyntheticDomain(count: number): DomainState {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const nodes: Node[] = [];
  const edges: DomainState['edges'] = [];
  const tasks: DomainState['tasks'] = [];
  for (let index = 0; index < count; index += 1) {
    const id = syntheticNodeId(index);
    const parentIndex = index === 0 ? -1 : Math.floor((index - 1) / 3);
    const parentId = parentIndex >= 0 ? syntheticNodeId(parentIndex) : null;
    nodes.push({
      id,
      title: `合成节点 ${index}`,
      parentId,
      blockIds: [],
      archived: index > 0 && index % 997 === 0,
      startAt: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    });
    if (parentId) {
      edges.push({
        id: `e_h_${index}`,
        type: 'hierarchy',
        fromNodeId: parentId,
        toNodeId: id,
      });
    }
    if (index % 10 === 0) {
      tasks.push({
        id: `tsk_${index}`,
        nodeId: id,
        title: `任务 ${index}`,
        done: index % 30 === 0,
      });
    }
    if (index > 0 && index % 20 === 0 && index + 1 < count) {
      edges.push({
        id: `e_x_${index}`,
        type: 'dependency',
        fromNodeId: id,
        toNodeId: syntheticNodeId(index + 1),
      });
    }
  }
  const spine = (leaf: number): DomainState['spines'][number] => {
    const nodeIds: string[] = [];
    let cursor: number | null = leaf;
    while (cursor !== null && cursor >= 0) {
      nodeIds.unshift(syntheticNodeId(cursor));
      cursor = cursor === 0 ? null : Math.floor((cursor - 1) / 3);
    }
    return { id: `spn_${leaf}`, title: `主干 ${leaf}`, nodeIds };
  };
  return {
    project: {
      id: 'prj_synthetic',
      title: `${count} 节点合成项目`,
      rootNodeId: syntheticNodeId(0),
    },
    nodes,
    edges,
    tasks,
    spines: [spine(count - 1), spine(Math.max(1, count - 2)), spine(Math.max(1, count - 3))],
    blocks: [],
    projectRefs: [],
    archived: false,
    archiveMeta: null,
  };
}

export function collapseToAtMost(domain: DomainState, maxVisible = 300): string[] {
  const collapsed: string[] = [];
  const depth = (index: number): number => {
    let result = 0;
    let cursor = index;
    while (cursor > 0) {
      cursor = Math.floor((cursor - 1) / 3);
      result += 1;
    }
    return result;
  };
  for (let index = 0; index < domain.nodes.length; index += 1) {
    if (depth(index) === 4) collapsed.push(syntheticNodeId(index));
  }
  void maxVisible;
  return collapsed;
}
