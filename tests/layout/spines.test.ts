import { describe, expect, it } from 'vitest';
import { multiSpineHighlight } from '@workspacetree/layout';
import type { Edge, Spine } from '@workspacetree/schema';

const spines: Spine[] = [
  { id: 'spine-a', title: 'A', nodeIds: ['root', 'trunk', 'joint', 'leaf-a'] },
  { id: 'spine-b', title: 'B', nodeIds: ['root', 'trunk', 'joint', 'leaf-b'] },
  { id: 'spine-c', title: 'C', nodeIds: ['root', 'trunk', 'joint', 'leaf-c'] },
];

const hierarchyEdges: Edge[] = [
  { id: 'e-root-trunk', type: 'hierarchy', fromNodeId: 'root', toNodeId: 'trunk' },
  { id: 'e-trunk-joint', type: 'hierarchy', fromNodeId: 'trunk', toNodeId: 'joint' },
  { id: 'e-joint-a', type: 'hierarchy', fromNodeId: 'joint', toNodeId: 'leaf-a' },
  { id: 'e-joint-b', type: 'hierarchy', fromNodeId: 'joint', toNodeId: 'leaf-b' },
  { id: 'e-joint-c', type: 'hierarchy', fromNodeId: 'joint', toNodeId: 'leaf-c' },
];

describe('多 Spine 高亮', () => {
  it('支持三条共享前缀与中间节点的连续路径', () => {
    const result = multiSpineHighlight(spines, hierarchyEdges, ['spine-a', 'spine-b', 'spine-c']);

    expect(result.nodeIds).toEqual(['root', 'trunk', 'joint', 'leaf-a', 'leaf-b', 'leaf-c']);
    expect(result.edgeIds).toEqual([
      'e-root-trunk',
      'e-trunk-joint',
      'e-joint-a',
      'e-joint-b',
      'e-joint-c',
    ]);
    expect(result.paths).toEqual([
      {
        spineId: 'spine-a',
        nodeIds: ['root', 'trunk', 'joint', 'leaf-a'],
        edgeIds: ['e-root-trunk', 'e-trunk-joint', 'e-joint-a'],
        continuous: true,
      },
      {
        spineId: 'spine-b',
        nodeIds: ['root', 'trunk', 'joint', 'leaf-b'],
        edgeIds: ['e-root-trunk', 'e-trunk-joint', 'e-joint-b'],
        continuous: true,
      },
      {
        spineId: 'spine-c',
        nodeIds: ['root', 'trunk', 'joint', 'leaf-c'],
        edgeIds: ['e-root-trunk', 'e-trunk-joint', 'e-joint-c'],
        continuous: true,
      },
    ]);
  });

  it('共享前缀与重复选择只合并一次节点和边', () => {
    const result = multiSpineHighlight(spines, hierarchyEdges, ['spine-a', 'spine-b', 'spine-a']);

    expect(result.paths.map((path) => path.spineId)).toEqual(['spine-a', 'spine-b']);
    expect(result.nodeIds).toEqual(['root', 'trunk', 'joint', 'leaf-a', 'leaf-b']);
    expect(result.edgeIds).toEqual(['e-root-trunk', 'e-trunk-joint', 'e-joint-a', 'e-joint-b']);
    expect(new Set(result.nodeIds).size).toBe(result.nodeIds.length);
    expect(new Set(result.edgeIds).size).toBe(result.edgeIds.length);
  });

  it('来回选择不改原始 Spine 和边数据', () => {
    const originalSpines = structuredClone(spines);
    const originalEdges = structuredClone(hierarchyEdges);
    const first = multiSpineHighlight(spines, hierarchyEdges, ['spine-a', 'spine-b']);
    multiSpineHighlight(spines, hierarchyEdges, ['spine-c']);
    const third = multiSpineHighlight(spines, hierarchyEdges, ['spine-a', 'spine-b']);

    expect(third).toEqual(first);
    expect(first.paths[0]?.nodeIds).not.toBe(spines[0]?.nodeIds);
    expect(spines).toEqual(originalSpines);
    expect(hierarchyEdges).toEqual(originalEdges);
  });

  it.each(['dependency', 'reference', 'custom'] as const)(
    '%s 边不能替代 hierarchy 边判定连续路径',
    (type) => {
      const edges = hierarchyEdges.map((edge) =>
        edge.id === 'e-trunk-joint' ? { ...edge, type } : edge,
      );
      const result = multiSpineHighlight(spines, edges, ['spine-a']);

      expect(result.paths[0]?.continuous).toBe(false);
      expect(result.paths[0]?.edgeIds).toEqual(['e-root-trunk', 'e-joint-a']);
      expect(result.edgeIds).toEqual(['e-root-trunk', 'e-joint-a']);
      expect(result.nodeIds).toEqual(['root', 'trunk', 'joint', 'leaf-a']);
    },
  );

  it('缺失 Spine 被忽略，空输入返回无高亮', () => {
    const empty = { nodeIds: [], edgeIds: [], paths: [] };

    expect(multiSpineHighlight(spines, hierarchyEdges, [])).toEqual(empty);
    expect(multiSpineHighlight(spines, hierarchyEdges, ['missing'])).toEqual(empty);
    expect(
      multiSpineHighlight(spines, hierarchyEdges, ['missing', 'spine-a']).paths.map(
        (path) => path.spineId,
      ),
    ).toEqual(['spine-a']);
  });
});
