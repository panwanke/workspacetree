/**
 * T-26 06 §二 Phase 1 验收 2 / 3 / 4 / 8：纯函数布局与几何。
 * 本文件在 Vitest node 环境运行，本身就是「核心布局函数在无 React 环境下可独立调用」的证据。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@workspacetree/core';
import {
  DEFAULT_VISIBLE_EDGE_TYPES,
  bezierPath,
  computeTreeLayout,
  filterEdges,
  hasOverlap,
  pathForNodes,
  pathToRoot,
  relationCounts,
  resolvePositions,
  spineHighlight,
  taskStats,
} from '@workspacetree/layout';
import { createDemoDomain } from '../fixtures/phase1-demo';

const domain = createDemoDomain();

describe('T-26 自动布局与手动锁点', () => {
  it('30+ 节点全部获得坐标，且自动布局无重叠', () => {
    expect(domain.nodes.length).toBeGreaterThanOrEqual(30);
    const layout = computeTreeLayout(domain.nodes, domain.edges, {}, domain.project.rootNodeId);
    expect(Object.keys(layout.positions)).toHaveLength(domain.nodes.length);
    expect(layout.positions[domain.project.rootNodeId]).toEqual({ x: 0, y: expect.any(Number) });
    expect(hasOverlap(layout.positions)).toBe(false);
    expect(new Set(layout.order).size).toBe(domain.nodes.length);
  });

  it('SavedPresentation 手动坐标覆盖自动布局并登记为锁点', () => {
    const manual = { n_writing_template: { x: 999, y: 888 } };
    const result = resolvePositions(domain, { nodePositions: manual }, {});
    expect(result.positions.n_writing_template).toEqual({ x: 999, y: 888 });
    expect(result.locked).toEqual(['n_writing_template']);
    expect(hasOverlap(result.positions, {}, result.locked)).toBe(false);
  });

  it('pathToRoot 返回 root → node 的连续层级路径', () => {
    expect(pathToRoot(domain.nodes, domain.edges, 'n_writing_template')).toEqual([
      'n_root',
      'n_init',
      'n_writing_init',
      'n_writing_template',
    ]);
  });
});

describe('T-27 曲线几何 / 默认边图层 / 关联数量提示', () => {
  it('贝塞尔路径随节点移动而重算，且与导出端共用同一函数', () => {
    const a = pathForNodes({ x: 0, y: 0 }, { x: 400, y: 100 });
    const b = pathForNodes({ x: 0, y: 0 }, { x: 400, y: 260 });
    expect(a.path).toMatch(/^M .* C /);
    expect(a.path).not.toBe(b.path);
    expect(bezierPath(a.anchors.source, a.anchors.target)).toBe(a.path);
  });

  it('默认只显示 hierarchy 边，节点给出隐藏关联数量', () => {
    const visible = filterEdges(domain.edges, DEFAULT_VISIBLE_EDGE_TYPES);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((edge) => edge.type === 'hierarchy')).toBe(true);
    const counts = relationCounts(domain.edges, DEFAULT_VISIBLE_EDGE_TYPES);
    const hidden = domain.edges.filter((edge) => edge.type !== 'hierarchy');
    expect(hidden.length).toBe(5);
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(hidden.length * 2);
    expect(counts[hidden[0].fromNodeId]).toBeGreaterThan(0);
  });

  it('开启关系图层后跨分支连线全部可见', () => {
    const all = filterEdges(domain.edges, ['hierarchy', 'dependency', 'reference', 'custom']);
    expect(all).toHaveLength(domain.edges.length);
  });
});

describe('T-28 单主干高亮与任务统计', () => {
  it('高亮只返回显示集合，原始拓扑不变', () => {
    const before = canonicalize(domain);
    const highlight = spineHighlight(domain.spines, domain.edges, 'spn_demo_1');
    expect(highlight.nodeIds).toHaveLength(5);
    expect(highlight.edgeIds).toHaveLength(4);
    expect(spineHighlight(domain.spines, domain.edges, null).nodeIds).toEqual([]);
    expect(spineHighlight(domain.spines, domain.edges, 'missing').nodeIds).toEqual([]);
    expect(canonicalize(domain)).toBe(before);
  });

  it('来回切换主干不改变 DomainState，也不改布局坐标', () => {
    const first = spineHighlight(domain.spines, domain.edges, 'spn_demo_1');
    const second = spineHighlight(domain.spines, domain.edges, 'spn_demo_2');
    const third = spineHighlight(domain.spines, domain.edges, 'spn_demo_1');
    expect(first.nodeIds).toEqual(third.nodeIds);
    expect(first.nodeIds).not.toEqual(second.nodeIds);
    expect(computeTreeLayout(domain.nodes, domain.edges).positions).toEqual(
      computeTreeLayout(domain.nodes, domain.edges).positions,
    );
  });

  it('任务统计按节点聚合', () => {
    const stats = taskStats(domain.tasks, 'n_writing_template');
    expect(stats.total).toBe(1);
    expect(stats.done === 0 || stats.done === 1).toBe(true);
    expect(taskStats(domain.tasks, 'not-there').percent).toBe(0);
  });
});

describe('T-29 布局包在无 React 环境下独立', () => {
  it('layout/src 全部源码不含 React / DOM / Node / 产品名依赖', () => {
    const dir = resolve(process.cwd(), 'packages/layout/src');
    const sources = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(resolve(dir, file), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/from ['"]react/);
    expect(sources).not.toMatch(/from ['"]node:/);
    expect(sources).not.toMatch(/document\.|window\./);
    expect(sources).not.toMatch(/['"]WorkspaceTree['"]/);
  });
});
