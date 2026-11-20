import { describe, expect, it } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import {
  applyGrowthAppearance,
  buildHierarchy,
  compensateScaleForGrowth,
  deriveEffectiveScales,
  resolveVisualGraph,
} from '@workspacetree/layout';
import { createNodeEntry } from '../../apps/web/src/history.js';

describe('双层缩放与层级拓扑生长集成测试 (Growth Integration - Group D & E)', () => {
  it('启用生长算法时：节点有效排版尺寸自适应收敛，VisualNode 携带完整 scaleMetrics', () => {
    const file = createMinimalBranchFile();
    // 拓扑: n_root -> n_child -> n_grandchild
    file.domain.nodes.push({
      id: 'n_grandchild',
      title: '孙节点',
      parentId: 'n_child',
      blockIds: [],
      archived: false,
    });
    file.domain.edges.push({
      id: 'e_2',
      type: 'hierarchy',
      fromNodeId: 'n_child',
      toNodeId: 'n_grandchild',
    });

    // 启用渐近衰减生长
    file.presentation.scaleSettings = {
      defaultChildMode: 'layout',
      childLayoutStep: -0.1,
      childVisualRatio: 0.9,
      minLayoutScale: 0.6,
      maxLayoutScale: 2.0,
      minVisualScale: 0.4,
      maxVisualScale: 2.0,
      growth: {
        enabled: true,
        algorithm: {
          type: 'asymptotic',
          decay: 0.25,
          minRatio: 0.55,
        },
        topology: {
          enabled: true,
          massDecay: 0.75,
          strength: 0.12,
          localMin: 0.92,
          localMax: 1.08,
          lineageMemory: 0.70,
          lineageMin: 0.88,
          lineageMax: 1.12,
        },
      },
    };

    const graph = resolveVisualGraph(file.domain, file.presentation);

    const rootNode = graph.nodes.find((n) => n.id === 'n_root')!;
    const childNode = graph.nodes.find((n) => n.id === 'n_child')!;
    const grandNode = graph.nodes.find((n) => n.id === 'n_grandchild')!;

    // 验证深度与指标挂载
    expect(rootNode.scaleMetrics?.depth).toBe(0);
    expect(rootNode.scaleMetrics?.depthRatio).toBe(1.0);
    expect(rootNode.effectiveLayoutScale).toBe(1.0);

    expect(childNode.scaleMetrics?.depth).toBe(1);
    expect(childNode.scaleMetrics?.depthRatio).toBeCloseTo(0.90, 2);
    expect(childNode.effectiveLayoutScale).toBeCloseTo(0.90, 2);

    expect(grandNode.scaleMetrics?.depth).toBe(2);
    expect(grandNode.scaleMetrics?.depthRatio).toBeCloseTo(0.823, 2);
    expect(grandNode.effectiveLayoutScale).toBeCloseTo(0.823, 2);

    // 验证排版基准尺寸严格递减收敛
    expect(rootNode.layoutSize!.width).toBeGreaterThan(childNode.layoutSize!.width);
    expect(childNode.layoutSize!.width).toBeGreaterThan(grandNode.layoutSize!.width);
  });

  it('旧项目开启生长并选择“保持当前外观”：反算补偿使全树所有节点可见尺寸严格不变', () => {
    const file = createMinimalBranchFile();
    // 模拟旧项目具有手动排版缩放
    file.presentation.nodeScales = {
      n_root: 1.0,
      n_child: 0.85,
    };

    const initialGraph = resolveVisualGraph(file.domain, file.presentation);
    const initialChildEff = initialGraph.nodes.find((n) => n.id === 'n_child')!.effectiveLayoutScale;
    expect(initialChildEff).toBe(0.85);

    const growthSettings = {
      enabled: true,
      algorithm: {
        type: 'asymptotic' as const,
        decay: 0.25,
        minRatio: 0.55,
      },
      topology: {
        enabled: true,
        massDecay: 0.75,
        strength: 0.12,
        localMin: 0.92,
        localMax: 1.08,
        lineageMemory: 0.70,
        lineageMin: 0.88,
        lineageMax: 1.12,
      },
    };

    const hierarchy = buildHierarchy(file.domain.nodes, file.domain.edges);
    const compensatedPresentation = compensateScaleForGrowth(
      file.domain.nodes,
      hierarchy,
      file.presentation,
      growthSettings,
    );

    const compensatedGraph = resolveVisualGraph(file.domain, compensatedPresentation);
    const compensatedChild = compensatedGraph.nodes.find((n) => n.id === 'n_child')!;

    // 开启瞬间的有效排版尺寸与初始状态严格相等 (保留外观，像素误差 < 0.05px)
    expect(compensatedChild.effectiveLayoutScale).toBeCloseTo(initialChildEff, 3);
    const initialSize = initialGraph.nodes.find((n) => n.id === 'n_child')!.layoutSize!;
    expect(compensatedChild.layoutSize!.width).toBeCloseTo(initialSize.width, 0);
    expect(compensatedChild.layoutSize!.height).toBeCloseTo(initialSize.height, 0);
  });

  it('选择“应用新生长外观”：清空本地 U，立即展现自适应层级收敛', () => {
    const file = createMinimalBranchFile();
    file.presentation.nodeScales = {
      n_root: 1.0,
      n_child: 0.85,
    };

    const growthSettings = {
      enabled: true,
      algorithm: {
        type: 'asymptotic' as const,
        decay: 0.25,
        minRatio: 0.55,
      },
      topology: {
        enabled: true,
        massDecay: 0.75,
        strength: 0.12,
        localMin: 0.92,
        localMax: 1.08,
        lineageMemory: 0.70,
        lineageMin: 0.88,
        lineageMax: 1.12,
      },
    };

    const freshPresentation = applyGrowthAppearance(
      file.domain.nodes,
      file.presentation,
      growthSettings,
    );

    expect(freshPresentation.nodeScales).toBeUndefined();

    const graph = resolveVisualGraph(file.domain, freshPresentation);
    const childNode = graph.nodes.find((n) => n.id === 'n_child')!;
    // n_child 自动收敛至渐近衰减曲线值 0.90
    expect(childNode.effectiveLayoutScale).toBeCloseTo(0.90, 2);
  });

  it('createNodeEntry 在生长模式下不注入硬编码 nodeScales，默认 U=1.0', () => {
    const file = createMinimalBranchFile();
    file.presentation.scaleSettings = {
      defaultChildMode: 'layout',
      childLayoutStep: -0.1,
      childVisualRatio: 0.9,
      minLayoutScale: 0.6,
      maxLayoutScale: 2.0,
      minVisualScale: 0.4,
      maxVisualScale: 2.0,
      growth: {
        enabled: true,
        algorithm: {
          type: 'asymptotic',
          decay: 0.25,
          minRatio: 0.55,
        },
        topology: {
          enabled: true,
          massDecay: 0.75,
          strength: 0.12,
          localMin: 0.92,
          localMax: 1.08,
          lineageMemory: 0.70,
          lineageMin: 0.88,
          lineageMax: 1.12,
        },
      },
    };

    const entry = createNodeEntry('n_new', '新子节点', 'node', 'n_root', undefined, file.presentation);

    // 验证不产生 presentation.setNodeScale 命令（保持默认 U=1.0）
    const presentationCmds = entry.chained?.forward ?? [];
    const setScaleCmd = presentationCmds.find((c) => c.type === 'presentation.setNodeScale');
    expect(setScaleCmd).toBeUndefined();
  });
});
