/**
 * T-30 06 §二 Phase 1 验收 6：SVG 导出与画布结构一致，且可选择包含哪些边类型。
 */
import { describe, expect, it } from 'vitest';
import { computeTreeLayout, pathForNodes, resolveVisualGraph } from '@workspacetree/layout';
import { exportSvg } from '@workspacetree/export';
import { createDemoDomain } from '../../apps/web/src/demo';

const domain = createDemoDomain();
const positions = computeTreeLayout(
  domain.nodes,
  domain.edges,
  {},
  domain.project.rootNodeId,
).positions;

describe('T-30 SVG 导出', () => {
  it('默认只导出 hierarchy 边，节点数与画布一致', () => {
    const result = exportSvg({
      nodes: domain.nodes,
      edges: domain.edges,
      positions,
      tasks: domain.tasks,
    });
    expect(result.svg.startsWith('<svg')).toBe(true);
    expect(result.svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(result.meta.nodeCount).toBe(domain.nodes.length);
    expect(result.meta.edgeTypes).toEqual(['hierarchy']);
    expect(result.meta.edgeCount).toBe(
      domain.edges.filter((edge) => edge.type === 'hierarchy').length,
    );
    expect(result.svg).not.toContain('data-edge-type="dependency"');
  });

  it('显式选择边类型后全部出现在导出中', () => {
    const result = exportSvg({
      nodes: domain.nodes,
      edges: domain.edges,
      positions,
      tasks: domain.tasks,
      visibleEdgeTypes: ['hierarchy', 'dependency', 'reference', 'custom'],
    });
    expect(result.meta.edgeCount).toBe(domain.edges.length);
    expect(result.meta.edgeTypes).toEqual(['custom', 'dependency', 'hierarchy', 'reference']);
    expect(result.svg).toContain('data-edge-type="dependency"');
  });

  it('导出路径与画布几何函数完全一致（端点不漂移）', () => {
    const edge = domain.edges.find((item) => item.type === 'hierarchy')!;
    const expected = pathForNodes(positions[edge.fromNodeId], positions[edge.toNodeId]).path;
    const result = exportSvg({ nodes: domain.nodes, edges: [edge], positions });
    expect(result.svg).toContain(`d="${expected}"`);
  });

  it('复用统一几何导出缩放、折叠摘要和汇聚连线', () => {
    const graph = resolveVisualGraph(domain, {
      nodePositions: {},
      verticalNodePositions: {},
      branchScales: { n_design: 0.5 },
      nodeScales: {},
      collapsedByDefault: ['n_writing_init'],
      layoutDirection: 'horizontal',
    });
    const result = exportSvg({
      nodes: domain.nodes,
      edges: domain.edges,
      positions: graph.positions,
      graph,
      tasks: domain.tasks,
      visibleEdgeTypes: ['hierarchy', 'dependency', 'reference', 'custom'],
    });
    expect(result.meta.nodeCount).toBe(domain.nodes.length - 13);
    expect(result.svg).toContain('13 nodes');
    expect(result.svg).toContain(`width="${graph.sizes.n_writing_init.width}"`);
    expect(result.svg).not.toContain('data-node-id="n_writing_template"');
    expect(result.svg).toContain('visual:dependency:n_analysis_prelim:n_writing_init');
  });

  it('标题做 XML 转义，高亮节点有明显描边', () => {
    const result = exportSvg({
      nodes: domain.nodes,
      edges: domain.edges,
      positions,
      title: 'A & B <demo>',
      highlightNodeIds: [domain.project.rootNodeId],
    });
    expect(result.svg).toContain('A &amp; B &lt;demo&gt;');
    expect(result.svg).toContain('stroke="#ea580c"');
  });

  it('renders a direct edge note as escaped text', () => {
    const edge = {
      ...domain.edges.find((item) => item.type === 'hierarchy')!,
      note: '条件 <复核> & 结果',
    };
    const result = exportSvg({ nodes: domain.nodes, edges: [edge], positions });
    expect(result.svg).toContain(`data-edge-note="${edge.id}"`);
    expect(result.svg).toContain('条件 &lt;复核&gt; &amp; 结果');
  });
});
