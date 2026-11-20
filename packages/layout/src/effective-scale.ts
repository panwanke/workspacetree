import type {
  Node,
  ProjectGrowthSettings,
  SavedPresentation,
} from '@workspacetree/schema';
import type { Hierarchy } from './tree.js';
import { depthRatio } from './growth-algorithms.js';
import { deriveTopology } from './topology-metrics.js';

export interface DerivedNodeScale {
  nodeId: string;
  depth: number;
  subtreeMass: number;
  depthRatio: number;          // G(d)
  topologyRatio: number;       // T
  autoLayoutRatio: number;     // G(d) * T
  userLayoutOverride: number;  // U (nodeScales[id] ?? 1.0)
  branchLayoutScale: number;   // 累积分支排版倍率 (∏ B^L)
  effectiveLayoutRatio: number;// autoLayoutRatio * U * branchLayoutScale
  userVisualScale: number;     // V (nodeVisualScales[id] ?? 1.0)
  branchVisualScale: number;   // 累积分支几何倍率 (∏ B^V)
  effectiveVisualRatio: number;// V * branchVisualScale
}

/**
 * 遍历计算所有节点的有效双层缩放及生长指标。
 * 单一权威事实来源（Single Source of Truth），供布局测量引擎与 Inspector 消费。
 */
export function deriveEffectiveScales(
  nodes: readonly Node[],
  hierarchy: Hierarchy,
  presentation: SavedPresentation,
): Record<string, DerivedNodeScale> {
  const { children, parents, roots } = hierarchy;
  const growth = presentation.scaleSettings?.growth;
  const growthEnabled = Boolean(growth?.enabled);

  // 1. 纯结构拓扑质量与拓扑因子推导
  const topology = growthEnabled && growth?.topology
    ? deriveTopology(hierarchy, growth.topology)
    : { masses: new Map<string, number>(), topologyFactors: new Map<string, number>() };

  // 2. 真实语义树深度 (根节点深度为 0)
  const depths = new Map<string, number>();
  for (const rootId of roots) depths.set(rootId, 0);

  const depthQueue = [...roots];
  while (depthQueue.length > 0) {
    const parentId = depthQueue.shift()!;
    const pDepth = depths.get(parentId) ?? 0;
    const childIds = children.get(parentId) ?? [];
    for (const cid of childIds) {
      if (!depths.has(cid)) {
        depths.set(cid, pDepth + 1);
        depthQueue.push(cid);
      }
    }
  }

  // 3. 递归累积祖先分支缩放
  const branchLayoutScales = new Map<string, number>();
  const branchVisualScales = new Map<string, number>();
  const visited = new Set<string>();

  const resolveBranch = (id: string): { layout: number; visual: number } => {
    if (branchLayoutScales.has(id)) {
      return {
        layout: branchLayoutScales.get(id)!,
        visual: branchVisualScales.get(id)!,
      };
    }
    if (visited.has(id)) return { layout: 1, visual: 1 };
    visited.add(id);

    const parent = parents.get(id);
    const parentRaw = parent ? resolveBranch(parent) : { layout: 1, visual: 1 };

    const inheritedL = parentRaw.layout * (presentation.branchScaleCompensation?.[id] ?? 1);
    const rawL = inheritedL * (presentation.branchScales[id] ?? 1);
    const rawV = parentRaw.visual * (presentation.branchVisualScales?.[id] ?? 1);

    branchLayoutScales.set(id, Math.max(0.1, rawL));
    branchVisualScales.set(id, Math.max(0.1, rawV));
    visited.delete(id);
    return { layout: rawL, visual: rawV };
  };

  for (const node of nodes) {
    resolveBranch(node.id);
  }

  // 4. 节点层级综合指标合成
  const result: Record<string, DerivedNodeScale> = {};

  for (const node of nodes) {
    const d = depths.get(node.id) ?? 0;
    const gRatio = growthEnabled && growth?.algorithm
      ? depthRatio(d, growth.algorithm)
      : 1.0;
    const tRatio = growthEnabled
      ? (topology.topologyFactors.get(node.id) ?? 1.0)
      : 1.0;
    const autoRatio = Number((gRatio * tRatio).toFixed(6));

    const u = (presentation.nodeScales ?? {})[node.id] ?? 1.0;
    const bL = branchLayoutScales.get(node.id) ?? 1.0;
    const effLayout = Number((autoRatio * u * bL).toFixed(6));

    const v = (presentation.nodeVisualScales ?? {})[node.id] ?? 1.0;
    const bV = branchVisualScales.get(node.id) ?? 1.0;
    const effVisual = Number((v * bV).toFixed(6));

    result[node.id] = {
      nodeId: node.id,
      depth: d,
      subtreeMass: topology.masses.get(node.id) ?? 1.0,
      depthRatio: gRatio,
      topologyRatio: tRatio,
      autoLayoutRatio: autoRatio,
      userLayoutOverride: u,
      branchLayoutScale: bL,
      effectiveLayoutRatio: Math.max(0.05, effLayout),
      userVisualScale: v,
      branchVisualScale: bV,
      effectiveVisualRatio: Math.max(0.05, effVisual),
    };
  }

  return result;
}

/**
 * 旧项目主动启用生长算法时：保持当前外观（Keep Appearance）。
 * 计算反向补偿 U_new = L_old / (G * T)，使开启瞬间全树所有节点的可见尺寸严格保持不变。
 */
export function compensateScaleForGrowth(
  nodes: readonly Node[],
  hierarchy: Hierarchy,
  presentation: SavedPresentation,
  growth: ProjectGrowthSettings,
): SavedPresentation {
  const next = structuredClone(presentation);
  next.scaleSettings = {
    ...(next.scaleSettings ?? {
      defaultChildMode: 'layout',
      childLayoutStep: -0.1,
      childVisualRatio: 0.9,
      minLayoutScale: 0.6,
      maxLayoutScale: 2.0,
      minVisualScale: 0.4,
      maxVisualScale: 2.0,
    }),
    growth: { ...growth, enabled: true },
  };

  const derived = deriveEffectiveScales(nodes, hierarchy, next);
  const nextNodeScales: Record<string, number> = { ...next.nodeScales };

  for (const node of nodes) {
    const metrics = derived[node.id];
    if (!metrics) continue;
    const oldLayout = presentation.nodeScales?.[node.id] ?? 1.0;
    const auto = metrics.autoLayoutRatio; // G * T
    if (auto > 0) {
      // U_new = L_old / (G * T)
      nextNodeScales[node.id] = Number((oldLayout / auto).toFixed(4));
    }
  }

  next.nodeScales = nextNodeScales;
  return next;
}

/**
 * 旧项目主动启用生长算法时：应用新生长外观（Apply Growth Appearance）。
 * 清空节点本地手动排版修正（U=1.0），使全树立即展现层级收敛与拓扑主干。
 */
export function applyGrowthAppearance(
  nodes: readonly Node[],
  presentation: SavedPresentation,
  growth: ProjectGrowthSettings,
): SavedPresentation {
  const next = structuredClone(presentation);
  next.scaleSettings = {
    ...(next.scaleSettings ?? {
      defaultChildMode: 'layout',
      childLayoutStep: -0.1,
      childVisualRatio: 0.9,
      minLayoutScale: 0.6,
      maxLayoutScale: 2.0,
      minVisualScale: 0.4,
      maxVisualScale: 2.0,
    }),
    growth: { ...growth, enabled: true },
  };

  // 重置所有 nodeScales 回退到自动基准 (U = 1.0)
  delete next.nodeScales;
  return next;
}
