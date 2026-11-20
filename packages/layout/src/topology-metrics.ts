import type { TopologyGrowthSettings } from '@workspacetree/schema';
import type { Hierarchy } from './tree.js';

export interface TopologyMetrics {
  masses: Map<string, number>;
  topologyFactors: Map<string, number>;
}

/**
 * 后序遍历计算各节点的折扣子树质量（Subtree Mass）。
 * 复杂度严格为 O(N)，使用显式深度优先栈规避超深树递归溢出。
 * mass(i) = 1 + decay * sum(mass(child))
 */
export function computeSubtreeMasses(
  hierarchy: Hierarchy,
  massDecay = 0.75,
): Map<string, number> {
  const masses = new Map<string, number>();
  const { children } = hierarchy;

  // 显式栈后序遍历
  // 访问次序：子节点全部被处理后才计算父节点质量
  const allIds: string[] = Array.from(children.keys());
  const inDegree = new Map<string, number>();
  for (const id of allIds) {
    inDegree.set(id, (children.get(id) ?? []).length);
  }

  // 拓扑排序后序：从无子节点（叶节点）开始向上汇聚
  const queue: string[] = [];
  for (const [id, count] of inDegree.entries()) {
    if (count === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const childIds = children.get(id) ?? [];
    let childSum = 0;
    for (const cid of childIds) {
      childSum += masses.get(cid) ?? 1;
    }
    masses.set(id, 1 + massDecay * childSum);

    const parentId = hierarchy.parents.get(id);
    if (parentId !== null && parentId !== undefined && inDegree.has(parentId)) {
      const remaining = inDegree.get(parentId)! - 1;
      inDegree.set(parentId, remaining);
      if (remaining === 0) {
        queue.push(parentId);
      }
    }
  }

  // 针对成环或游离异常孤岛兜底
  for (const id of allIds) {
    if (!masses.has(id)) {
      masses.set(id, 1);
    }
  }

  return masses;
}

/**
 * 根至叶自顶向下（Pre-order）计算各节点拓扑因子 T_i。
 * 包含局部兄弟偏差修正与有界谱系记忆（Lineage Memory）。
 */
export function computeTopologyFactors(
  hierarchy: Hierarchy,
  masses: Map<string, number>,
  settings: TopologyGrowthSettings,
): Map<string, number> {
  const topo = new Map<string, number>();
  const { children, roots } = hierarchy;

  // 根节点 T_root 恒为 1.0
  for (const rootId of roots) {
    topo.set(rootId, 1.0);
  }

  if (!settings.enabled || settings.strength === 0) {
    for (const id of children.keys()) {
      topo.set(id, 1.0);
    }
    return topo;
  }

  const strength = Math.max(0, settings.strength ?? 0.12);
  const localMin = settings.localMin ?? 0.92;
  const localMax = settings.localMax ?? 1.08;
  const lineageMemory = Math.max(0, Math.min(1.0, settings.lineageMemory ?? 0.70));
  const lineageMin = settings.lineageMin ?? 0.88;
  const lineageMax = settings.lineageMax ?? 1.12;

  // BFS / 队列自顶向下推导
  const queue: string[] = [...roots];
  const visited = new Set<string>(roots);

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentRatio = topo.get(parentId) ?? 1.0;
    const siblingIds = children.get(parentId) ?? [];
    if (siblingIds.length === 0) continue;

    if (siblingIds.length === 1) {
      const singleId = siblingIds[0]!;
      // 独生子局部无兄弟偏差，localRatio = 1.0；温和衰减继承父级谱系记忆
      const inherited = 1.0 * Math.pow(parentRatio, lineageMemory);
      const finalRatio = Math.min(lineageMax, Math.max(lineageMin, inherited));
      topo.set(singleId, Number(finalRatio.toFixed(6)));
      if (!visited.has(singleId)) {
        visited.add(singleId);
        queue.push(singleId);
      }
      continue;
    }

    // 多兄弟：计算对数质量偏差
    const scores: number[] = siblingIds.map((id: string): number => Math.log1p(masses.get(id) ?? 1));
    const meanScore: number = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;

    for (let j = 0; j < siblingIds.length; j++) {
      const id = siblingIds[j]!;
      const delta = scores[j]! - meanScore;
      const rawLocal = Math.exp(strength * delta);
      const localRatio = Math.min(localMax, Math.max(localMin, rawLocal));
      const inherited = localRatio * Math.pow(parentRatio, lineageMemory);
      const finalRatio = Math.min(lineageMax, Math.max(lineageMin, inherited));
      topo.set(id, Number(finalRatio.toFixed(6)));

      if (!visited.has(id)) {
        visited.add(id);
        queue.push(id);
      }
    }
  }

  // 兜底游离节点
  for (const id of children.keys()) {
    if (!topo.has(id)) topo.set(id, 1.0);
  }

  return topo;
}

export function deriveTopology(
  hierarchy: Hierarchy,
  settings: TopologyGrowthSettings,
): TopologyMetrics {
  const masses = computeSubtreeMasses(hierarchy, settings.massDecay ?? 0.75);
  const topologyFactors = computeTopologyFactors(hierarchy, masses, settings);
  return { masses, topologyFactors };
}
