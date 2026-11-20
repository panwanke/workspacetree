/**
 * 单主干层级树自动布局（06 §二 Phase 1 任务 2、验收 4 / 8）。
 * 纯函数：输入 DomainState 的 nodes / edges 与 SavedPresentation 的手动坐标，输出坐标表。
 * 不在本模块使用 DOM、React 或平台 API，因此可在 Node 下独立调用与测试。
 */
import type { DomainState, Edge, Node, SavedPresentation } from '@workspacetree/schema';
import {
  DEFAULT_LAYOUT_OPTIONS,
  type Bounds,
  type LayoutOptions,
  type LayoutResult,
  type Point,
} from './types.js';

export interface Hierarchy {
  children: Map<string, string[]>;
  parents: Map<string, string | null>;
  roots: string[];
}

/** hierarchy 边优先，缺省时回落到 node.parentId；任何成环父引用直接忽略，保证布局可终止。 */
export function buildHierarchy(nodes: readonly Node[], edges: readonly Edge[]): Hierarchy {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const parents = new Map<string, string | null>();
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const edge of edges) {
    if (edge.type !== 'hierarchy') continue;
    if (!idSet.has(edge.fromNodeId) || !idSet.has(edge.toNodeId)) continue;
    if (edge.fromNodeId === edge.toNodeId) continue;
    if (!parents.has(edge.toNodeId)) parents.set(edge.toNodeId, edge.fromNodeId);
  }
  for (const node of nodes) {
    if (!parents.has(node.id)) {
      const fallback =
        node.parentId !== null && idSet.has(node.parentId) && node.parentId !== node.id
          ? node.parentId
          : null;
      parents.set(node.id, fallback);
    }
  }

  // 自环 / 互相指认的父链不会被 layout 递归消费：遇到已访问节点即断开。
  for (const id of ids) {
    const seen = new Set<string>([id]);
    let cursor = parents.get(id) ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        parents.set(id, null);
        break;
      }
      seen.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
  }

  for (const id of ids) {
    const parent = parents.get(id) ?? null;
    if (parent !== null) children.get(parent)?.push(id);
  }
  const roots = ids.filter((id) => (parents.get(id) ?? null) === null);
  return { children, parents, roots };
}

/** 缩进树布局：叶子按序占行，父节点取子节点纵向中点，深度决定横向列，天然无重叠。 */
export function computeTreeLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  options: LayoutOptions = {},
  rootNodeId?: string,
): LayoutResult {
  const cfg = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const { children, roots } = buildHierarchy(nodes, edges);
  const colWidth = cfg.nodeWidth + cfg.horizontalGap;
  const rowHeight = cfg.nodeHeight + cfg.verticalGap;
  const positions: Record<string, Point> = {};
  const order: string[] = [];
  let leafCursor = 0;
  const visiting = new Set<string>();

  const place = (id: string, depth: number): number => {
    if (visiting.has(id)) return leafCursor * rowHeight;
    visiting.add(id);
    order.push(id);
    const kids = children.get(id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = leafCursor * rowHeight;
      leafCursor += 1;
    } else {
      const ys = kids.map((child) => place(child, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    positions[id] = { x: depth * colWidth, y };
    visiting.delete(id);
    return y;
  };

  const orderedRoots = rootNodeId
    ? [...roots.filter((id) => id === rootNodeId), ...roots.filter((id) => id !== rootNodeId)]
    : roots;
  for (const root of orderedRoots) place(root, 0);
  // 成环节点可能既不出现在 roots 也没被遍历到，兜底单列排布，避免坐标缺失。
  for (const node of nodes) {
    if (!positions[node.id]) {
      positions[node.id] = { x: 0, y: leafCursor * rowHeight };
      leafCursor += 1;
      order.push(node.id);
    }
  }
  return { positions, locked: [], order };
}

/**
 * 自动布局 + 手动锁点（任务 2 / 验收 4）：
 * SavedPresentation.nodePositions 中的坐标优先，且不被自动布局覆盖。
 */
export function resolvePositions(
  domain: Pick<DomainState, 'nodes' | 'edges' | 'project'>,
  presentation: Pick<SavedPresentation, 'nodePositions'>,
  options: LayoutOptions = {},
): LayoutResult {
  const auto = computeTreeLayout(domain.nodes, domain.edges, options, domain.project.rootNodeId);
  const positions: Record<string, Point> = { ...auto.positions };
  const locked: string[] = [];
  for (const [id, point] of Object.entries(presentation.nodePositions)) {
    if (!positions[id]) continue;
    positions[id] = { x: point.x, y: point.y };
    locked.push(id);
  }
  return { positions, locked: locked.sort(), order: auto.order };
}

/** 从指定节点沿 hierarchy 父链回溯到根，返回 root → node 的有序路径（用于创建 Spine）。 */
export function pathToRoot(
  nodes: readonly Node[],
  edges: readonly Edge[],
  nodeId: string,
): string[] {
  const { parents } = buildHierarchy(nodes, edges);
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = nodeId;
  while (cursor !== null && !seen.has(cursor) && parents.has(cursor)) {
    seen.add(cursor);
    path.unshift(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return path;
}

/** 验收 4「布局无明显重叠」：任意两节点矩形相交即视为重叠（手动锁点除外）。 */
export function hasOverlap(
  positions: Record<string, Point>,
  options: LayoutOptions = {},
  ignoreIds: readonly string[] = [],
): boolean {
  const cfg = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const ignore = new Set(ignoreIds);
  const entries = Object.entries(positions).filter(([id]) => !ignore.has(id));
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i][1];
      const b = entries[j][1];
      if (Math.abs(a.x - b.x) < cfg.nodeWidth && Math.abs(a.y - b.y) < cfg.nodeHeight) {
        return true;
      }
    }
  }
  return false;
}

export function layoutBounds(
  positions: Record<string, Point>,
  options: LayoutOptions = {},
  padding = 40,
): Bounds {
  const cfg = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const points = Object.values(positions);
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: cfg.nodeWidth + padding * 2,
      maxY: cfg.nodeHeight + padding * 2,
    };
  }
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x)) + cfg.nodeWidth;
  const maxY = Math.max(...points.map((p) => p.y)) + cfg.nodeHeight;
  return { minX, minY, maxX, maxY };
}
