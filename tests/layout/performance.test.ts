import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { exportSvg } from '@workspacetree/export';
import { multiSpineHighlight, resolveVisualGraph } from '@workspacetree/layout';
import { createDemoDomain } from '../fixtures/phase1-demo';
import { collapseToAtMost, createSyntheticDomain } from '../support/synthetic-project.js';

function presentation(overrides: Record<string, unknown> = {}) {
  return {
    nodePositions: {},
    verticalNodePositions: {},
    branchScales: {},
    nodeScales: {},
    collapsedByDefault: [],
    savedSpineDisplay: null,
    layoutDirection: 'horizontal' as const,
    ...overrides,
  };
}

describe('嵌套缩放与 LOD', () => {
  it('多级比例的乘积低于阈值时切换摘要，并保留最小点击区', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(
      domain,
      presentation({
        branchScales: {
          n_writing_init: 0.35,
          n_writing_template: 0.35,
          n_writing_template_latex: 0.35,
        },
      }),
    );
    expect(graph.nodeById.n_writing_init.scale).toBeCloseTo(0.35, 4);
    expect(graph.nodeById.n_writing_template.scale).toBeCloseTo(0.1225, 4);
    expect(graph.nodeById.n_writing_template_latex.scale).toBe(0.1);
    expect(graph.nodeById.n_writing_template_latex.lod).toBe('summary');
    expect(graph.nodeById.n_writing_template_latex.size.width).toBeGreaterThanOrEqual(140);
    expect(graph.nodeById.n_writing_template_latex.size.height).toBeGreaterThanOrEqual(44);
    expect(graph.nodeById.n_exp.scale).toBe(1);
    expect(graph.nodeById.n_exp.lod).toBe('full');
  });

  it('LOD 摘要在 SVG 中保持正常字号且三个视图共用同一尺寸', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(
      domain,
      presentation({ branchScales: { n_writing_init: 0.2 } }),
    );
    const svg = exportSvg({
      nodes: domain.nodes,
      edges: domain.edges,
      positions: graph.positions,
      graph,
    }).svg;
    expect(svg).toContain('LOD summary');
    expect(svg).toContain(`width="${graph.sizes.n_writing_init.width}"`);
    expect(svg).toContain('font-size="14"');
  });
});

describe('大项目统一几何性能', () => {
  it('3000 节点完整布局线性完成，折叠后可见节点不超过 300', () => {
    const domain = createSyntheticDomain(3000);
    const started = performance.now();
    const full = resolveVisualGraph(domain, presentation());
    const elapsed = performance.now() - started;
    expect(full.nodes).toHaveLength(3000);
    expect(Object.keys(full.positions)).toHaveLength(3000);
    expect(elapsed).toBeLessThan(6000);

    const collapsed = resolveVisualGraph(
      domain,
      presentation({ collapsedByDefault: collapseToAtMost(domain, 300) }),
    );
    expect(collapsed.nodes.length).toBeLessThanOrEqual(300);
    expect(collapsed.nodeById[domain.project.rootNodeId]).toBeDefined();
    expect(collapsed.edges.every((edge) => collapsed.nodeById[edge.sourceId])).toBe(true);
  });

  it('三条共享前缀主干不复制节点，路径均由 hierarchy 边连续组成', () => {
    const domain = createSyntheticDomain(500);
    const highlight = multiSpineHighlight(
      domain.spines,
      domain.edges,
      domain.spines.map((spine) => spine.id),
    );
    expect(highlight.paths).toHaveLength(3);
    expect(highlight.paths.every((path) => path.continuous)).toBe(true);
    expect(new Set(highlight.nodeIds).size).toBe(highlight.nodeIds.length);
    expect(highlight.nodeIds).toContain(domain.project.rootNodeId);
  });
});
