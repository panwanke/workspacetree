/**
 * 统一视觉几何：时间排序、横纵布局、手动锁点、节点/分支缩放与折叠。
 * 2D、3D 和 SVG 必须消费本模块的结果，不分别推导显示坐标。
 */
import type { DomainState, Edge, Node, SavedPresentation } from '@workspacetree/schema';
import { indexWorkspaceTasks, selectNodeNote, workspaceTaskCounts } from '@workspacetree/markdown';
import { resolveGraphBranchColors } from './roles.js';
import { placeStructure } from './structure.js';
import { buildHierarchy } from './tree.js';
import {
  DEFAULT_LAYOUT_OPTIONS,
  LOD_MIN_HEIGHT,
  LOD_MIN_WIDTH,
  LOD_SCALE_THRESHOLD,
  type AnchorSide,
  type DateAnchor,
  type LayoutDirection,
  type LayoutOptions,
  type Point,
  type Size,
  type VisualEdge,
  type VisualGraph,
  type VisualNode,
  type VisibleEdgeTypes,
} from './types.js';

type Presentation = Pick<
  SavedPresentation,
  | 'nodePositions'
  | 'branchScales'
  | 'branchScaleCompensation'
  | 'collapsedByDefault'
  | 'layoutDirection'
  | 'verticalNodePositions'
  | 'nodeScales'
> & {
  nodeSizes?: SavedPresentation['nodeSizes'];
};

function compareByDate(a: Node, b: Node): number {
  const aDate = a.startAt ?? null;
  const bDate = b.startAt ?? null;
  if (aDate !== bDate) {
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    return aDate.localeCompare(bDate);
  }
  return a.id.localeCompare(b.id);
}

interface HierarchyLike {
  children: ReadonlyMap<string, string[]>;
  parents: ReadonlyMap<string, string | null>;
  roots: string[];
}

interface SubtreeStats {
  memberCount: Map<string, number>;
  taskDone: Map<string, number>;
  taskTotal: Map<string, number>;
  externalConnections: Map<string, number>;
}

/** 一次后序聚合所有子树统计，避免每个折叠节点重复扫描整份任务与边。 */
function computeSubtreeStats(
  domain: Pick<DomainState, 'nodes' | 'edges'>,
  hierarchy: HierarchyLike,
  ownTasks: ReadonlyMap<string, { total: number; done: number }>,
): SubtreeStats {
  const ids = domain.nodes.map((node) => node.id);
  const memberCount = new Map(ids.map((id) => [id, 1]));
  const taskDone = new Map(ids.map((id) => [id, ownTasks.get(id)?.done ?? 0]));
  const taskTotal = new Map(ids.map((id) => [id, ownTasks.get(id)?.total ?? 0]));
  const degreeSum = new Map(ids.map((id) => [id, 0]));
  const crossInternal = new Map(ids.map((id) => [id, 0]));
  const depths = new Map<string, number>();
  const postorder: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (visiting.has(id)) return;
    visiting.add(id);
    depths.set(id, depth);
    for (const child of hierarchy.children.get(id) ?? []) visit(child, depth + 1);
    postorder.push(id);
  };
  for (const root of hierarchy.roots) visit(root, 0);
  for (const id of ids) if (!depths.has(id)) visit(id, 0);

  const parentOf = (id: string): string | null => hierarchy.parents.get(id) ?? null;
  const lca = (a: string, b: string): string | null => {
    let left: string | null = a;
    let right: string | null = b;
    const seen = new Set<string>();
    while (left && right && !seen.has(`${left}:${right}`)) {
      seen.add(`${left}:${right}`);
      const leftDepth = depths.get(left) ?? 0;
      const rightDepth = depths.get(right) ?? 0;
      if (leftDepth > rightDepth) left = parentOf(left);
      else if (rightDepth > leftDepth) right = parentOf(right);
      else if (left !== right) {
        left = parentOf(left);
        right = parentOf(right);
      } else return left;
    }
    return left === right ? left : null;
  };
  for (const edge of domain.edges) {
    degreeSum.set(edge.fromNodeId, (degreeSum.get(edge.fromNodeId) ?? 0) + 1);
    degreeSum.set(edge.toNodeId, (degreeSum.get(edge.toNodeId) ?? 0) + 1);
    if (edge.type === 'hierarchy') continue;
    const ancestor = lca(edge.fromNodeId, edge.toNodeId);
    if (ancestor) crossInternal.set(ancestor, (crossInternal.get(ancestor) ?? 0) + 1);
  }
  for (const id of postorder) {
    const parent = parentOf(id);
    if (!parent || !memberCount.has(parent)) continue;
    memberCount.set(parent, (memberCount.get(parent) ?? 0) + (memberCount.get(id) ?? 0));
    taskTotal.set(parent, (taskTotal.get(parent) ?? 0) + (taskTotal.get(id) ?? 0));
    taskDone.set(parent, (taskDone.get(parent) ?? 0) + (taskDone.get(id) ?? 0));
    degreeSum.set(parent, (degreeSum.get(parent) ?? 0) + (degreeSum.get(id) ?? 0));
    crossInternal.set(parent, (crossInternal.get(parent) ?? 0) + (crossInternal.get(id) ?? 0));
  }
  const externalConnections = new Map<string, number>();
  for (const id of ids) {
    const internal = (memberCount.get(id) ?? 1) - 1 + (crossInternal.get(id) ?? 0);
    externalConnections.set(id, Math.max(0, (degreeSum.get(id) ?? 0) - 2 * internal));
  }
  return { memberCount, taskDone, taskTotal, externalConnections };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeBounds(nodes: readonly VisualNode[], padding = 48) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 320, maxY: 180 };
  const minX = Math.min(...nodes.map((node) => node.position.x)) - padding;
  const minY = Math.min(...nodes.map((node) => node.position.y)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width)) + padding;
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height)) + padding;
  return { minX, minY, maxX, maxY };
}

export function resolveLayoutDirection(
  presentation: Pick<SavedPresentation, 'layoutDirection' | 'nodePositions'>,
): LayoutDirection {
  return (
    presentation.layoutDirection ??
    (Object.keys(presentation.nodePositions).length > 0 ? 'horizontal' : 'vertical')
  );
}

export function markdownPreviewMinHeight(scale: number): number {
  return Math.round(Math.max(110, 124 * Math.min(scale, 2)));
}

export function resolveVisualGraph(
  domain: Pick<DomainState, 'nodes' | 'edges' | 'project' | 'tasks'> &
    Partial<Pick<DomainState, 'spines' | 'blocks'>>,
  presentation: Presentation,
  options: LayoutOptions = {},
): VisualGraph {
  const cfg = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const direction = resolveLayoutDirection(presentation);
  const hierarchy = buildHierarchy(domain.nodes, domain.edges);
  const nodeMap = new Map(domain.nodes.map((node) => [node.id, node]));
  const collapsed = new Set(presentation.collapsedByDefault.filter((id) => nodeMap.has(id)));
  const hidden = new Set<string>();
  const hideDescendants = (id: string): void => {
    for (const child of hierarchy.children.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hideDescendants(child);
    }
  };
  for (const id of collapsed) hideDescendants(id);
  const visibleNodes = domain.nodes.filter((node) => !hidden.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const rawBranchScales = new Map<string, number>();
  const branchScales = new Map<string, number>();
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const resolveBranchScale = (id: string): number => {
    const cached = rawBranchScales.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const parent = hierarchy.parents.get(id) ?? null;
    const parentRaw = parent && visibleIds.has(parent) ? resolveBranchScale(parent) : 1;
    const inherited = parentRaw * (presentation.branchScaleCompensation?.[id] ?? 1);
    const raw = inherited * (presentation.branchScales[id] ?? 1);
    rawBranchScales.set(id, raw);
    branchScales.set(id, Math.max(0.1, raw));
    depths.set(id, parent && visibleIds.has(parent) ? (depths.get(parent) ?? 0) + 1 : 0);
    visiting.delete(id);
    return raw;
  };
  for (const node of visibleNodes) resolveBranchScale(node.id);

  const sizes: Record<string, Size> = {};
  const scales: Record<string, number> = {};
  const lodById = new Map<string, 'full' | 'summary'>();
  const taskIndex = indexWorkspaceTasks(domain);
  for (const node of visibleNodes) {
    const branchScale = branchScales.get(node.id) ?? 1;
    const scale = Math.max(0.1, branchScale * ((presentation.nodeScales ?? {})[node.id] ?? 1));
    const lod = scale < LOD_SCALE_THRESHOLD ? 'summary' : 'full';
    scales[node.id] = scale;
    lodById.set(node.id, lod);
    const customSize = (presentation.nodeSizes ?? {})[node.id];
    if (customSize) {
      sizes[node.id] = {
        width: Math.max(LOD_MIN_WIDTH * 0.5, customSize.width * branchScale),
        height: Math.max(LOD_MIN_HEIGHT * 0.7, customSize.height * branchScale),
      };
    } else {
      sizes[node.id] = {
        width:
          lod === 'summary'
            ? Math.max(LOD_MIN_WIDTH, cfg.nodeWidth * scale)
            : cfg.nodeWidth * scale,
        height:
          lod === 'summary'
            ? Math.max(LOD_MIN_HEIGHT, cfg.nodeHeight * scale)
            : cfg.nodeHeight * scale,
      };
    }
    if (lod === 'full' && selectNodeNote(node, taskIndex.markdownByBlock)?.markdown.trim()) {
      sizes[node.id].height = Math.max(sizes[node.id].height, markdownPreviewMinHeight(scale));
    }
  }

  const { positions, order, dateAnchors } =
    options.strategy && options.strategy !== 'timeline'
      ? placeStructure(
          visibleNodes,
          hierarchy,
          domain.project.rootNodeId,
          sizes,
          direction,
          cfg,
          domain.spines ?? [],
          options.strategy,
          domain.nodes,
          domain.edges,
        )
      : placeTimeline(visibleNodes, hierarchy, domain.project.rootNodeId, sizes, direction, cfg);

  const manual =
    direction === 'horizontal'
      ? presentation.nodePositions
      : (presentation.verticalNodePositions ?? {});
  const locked: string[] = [];
  for (const [id, point] of Object.entries(manual)) {
    if (!positions[id]) continue;
    positions[id] = { x: point.x, y: point.y };
    locked.push(id);
  }

  const { edgeColors, nodeBranchColors } = resolveGraphBranchColors(
    domain.nodes,
    domain.edges,
    domain.project.rootNodeId,
    domain.spines ?? [],
  );

  const ownTasks = new Map(
    [...taskIndex.byNode].map(([id, items]) => [id, workspaceTaskCounts(items)]),
  );
  const subtreeStats = computeSubtreeStats(domain, hierarchy, ownTasks);
  const visualNodes: VisualNode[] = visibleNodes.map((node) => {
    const isCollapsed = collapsed.has(node.id);
    return {
      id: node.id,
      position: positions[node.id],
      size: sizes[node.id],
      scale: scales[node.id],
      branchScale: branchScales.get(node.id) ?? 1,
      depth: depths.get(node.id) ?? 0,
      startAt: node.startAt ?? null,
      collapsed: isCollapsed,
      collapsedCount: isCollapsed ? (subtreeStats.memberCount.get(node.id) ?? 1) - 1 : 0,
      taskDone: isCollapsed
        ? (subtreeStats.taskDone.get(node.id) ?? 0)
        : (ownTasks.get(node.id)?.done ?? 0),
      taskTotal: isCollapsed
        ? (subtreeStats.taskTotal.get(node.id) ?? 0)
        : (ownTasks.get(node.id)?.total ?? 0),
      externalConnectionCount: subtreeStats.externalConnections.get(node.id) ?? 0,
      lod: lodById.get(node.id) ?? 'full',
      branchColor: nodeBranchColors.get(node.id) ?? '#64748b',
    };
  });
  const nodeById = Object.fromEntries(visualNodes.map((node) => [node.id, node]));
  const edges = resolveVisualEdges(
    domain.edges,
    domain.nodes,
    nodeById,
    hierarchy.parents,
    undefined,
    edgeColors,
  );
  return {
    direction,
    nodes: visualNodes,
    nodeById,
    edges,
    positions,
    sizes,
    scales,
    locked: locked.sort(),
    order,
    dateAnchors,
    hiddenNodeIds: [...hidden].sort(),
    bounds: computeBounds(visualNodes),
  };
}

function placeTimeline(
  nodes: readonly Node[],
  hierarchy: HierarchyLike,
  rootId: string,
  sizes: Readonly<Record<string, Size>>,
  direction: LayoutDirection,
  cfg: typeof DEFAULT_LAYOUT_OPTIONS & LayoutOptions,
): { positions: Record<string, Point>; order: string[]; dateAnchors: DateAnchor[] } {
  const horizontal = direction === 'horizontal';
  const crossGap = horizontal ? cfg.verticalGap : Math.min(cfg.horizontalGap, 44);
  const mainGap = Math.max(1, horizontal ? cfg.horizontalGap : cfg.verticalGap);
  const columns = Math.max(1, Math.floor(cfg.timelineColumns));
  const cardCrossSize = horizontal ? cfg.nodeHeight : cfg.nodeWidth;
  const crossBudget = cfg.timelineCrossSize ?? columns * cardCrossSize + (columns - 1) * crossGap;
  const branchOrder = new Map<string, number>();
  const lanes = new Map<string, number>();
  const stack = [...hierarchy.roots]
    .sort()
    .map((id, index) => ({ id, lane: index % columns }))
    .reverse();
  while (stack.length) {
    const { id, lane } = stack.pop()!;
    if (!sizes[id]) continue;
    branchOrder.set(id, branchOrder.size);
    lanes.set(id, lane);
    const children = (hierarchy.children.get(id) ?? []).slice().sort();
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ id: children[index], lane: (lane + index) % columns });
    }
  }
  const rank = (node: Node) => branchOrder.get(node.id) ?? Number.MAX_SAFE_INTEGER;
  const orderedNodes = [...nodes].sort((a, b) => {
    if (a.id === rootId && !a.startAt) return -1;
    if (b.id === rootId && !b.startAt) return 1;
    if (a.startAt === b.startAt || (!a.startAt && !b.startAt)) {
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    }
    return compareByDate(a, b);
  });

  const positions: Record<string, Point> = {};
  const dateAnchors: DateAnchor[] = [];
  let main = 0;
  let rowCross = 0;
  let rowMainSize = 0;
  let rowCount = 0;
  let currentDate: string | null | undefined;
  let anchor: DateAnchor | undefined;
  const finishRow = () => {
    if (!rowCount) return;
    main += rowMainSize + mainGap;
    rowCross = 0;
    rowMainSize = 0;
    rowCount = 0;
  };

  for (const node of orderedNodes) {
    const date = node.startAt ?? null;
    const undatedRoot = !date && node.id === rootId;
    if (date !== currentDate || undatedRoot) {
      finishRow();
      currentDate = date;
      anchor = date ? { date, position: main, nodeIds: [] } : undefined;
      if (anchor) dateAnchors.push(anchor);
    }
    const { width, height } = sizes[node.id];
    const crossSize = horizontal ? height : width;
    const mainSize = horizontal ? width : height;
    if (rowCount >= columns || (rowCount > 0 && rowCross + crossSize > crossBudget)) {
      finishRow();
    }
    const preferredCross = (lanes.get(node.id) ?? 0) * (cardCrossSize + crossGap);
    const preferredFits = preferredCross >= rowCross && preferredCross + crossSize <= crossBudget;
    const cross = preferredFits ? preferredCross : rowCross;
    positions[node.id] = horizontal ? { x: main, y: cross } : { x: cross, y: main };
    if (anchor) {
      if (anchor.nodeIds.length === 0) anchor.position = main + mainSize / 2;
      anchor.nodeIds.push(node.id);
    }
    rowCount++;
    rowCross = cross + crossSize + crossGap;
    rowMainSize = Math.max(rowMainSize, mainSize);
    if (undatedRoot) finishRow();
  }

  return { positions, order: orderedNodes.map((node) => node.id), dateAnchors };
}

function nearestVisible(
  id: string,
  visible: Readonly<Record<string, VisualNode>>,
  parents: ReadonlyMap<string, string | null>,
): string | null {
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    if (visible[cursor]) return cursor;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return null;
}

export function resolveVisualEdges(
  edges: readonly Edge[],
  _nodes: readonly Node[],
  visible: Readonly<Record<string, VisualNode>>,
  parents: ReadonlyMap<string, string | null>,
  visibleTypes: VisibleEdgeTypes = ['hierarchy', 'dependency', 'reference', 'custom'],
  edgeColors?: ReadonlyMap<string, string>,
): VisualEdge[] {
  const allowed = new Set(visibleTypes);
  const groups = new Map<string, VisualEdge>();
  for (const edge of edges) {
    if (!allowed.has(edge.type)) continue;
    const sourceId = nearestVisible(edge.fromNodeId, visible, parents);
    const targetId = nearestVisible(edge.toNodeId, visible, parents);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const key = `${edge.type}:${sourceId}:${targetId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.originalEdgeIds.push(edge.id);
      existing.aggregatedCount += 1;
    } else {
      const color =
        edgeColors?.get(edge.id) ??
        (edge.type === 'hierarchy'
          ? '#64748b'
          : edge.type === 'dependency'
            ? '#dc2626'
            : '#c026d3');
      groups.set(key, {
        id: `visual:${key}`,
        type: edge.type,
        sourceId,
        targetId,
        originalEdgeIds: [edge.id],
        aggregatedCount: 1,
        color,
      });
    }
  }
  return [...groups.values()];
}

/** 供 3D 渲染器使用：同一布局结果投影到 x/z 平面，y 只表达层级高度。 */
export function projectVisualNode(node: VisualNode): { x: number; y: number; z: number } {
  return {
    x: node.position.x + node.size.width / 2,
    y: -node.depth * 18,
    z: node.position.y + node.size.height / 2,
  };
}

export function visualEdgeAnchors(
  source: VisualNode,
  target: VisualNode,
  direction: LayoutDirection,
): { source: Point; target: Point; sourceSide: AnchorSide; targetSide: AnchorSide } {
  const sourceCenter = {
    x: source.position.x + source.size.width / 2,
    y: source.position.y + source.size.height / 2,
  };
  const targetCenter = {
    x: target.position.x + target.size.width / 2,
    y: target.position.y + target.size.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const separatedX = Math.abs(dx) >= (source.size.width + target.size.width) / 2;
  const separatedY = Math.abs(dy) >= (source.size.height + target.size.height) / 2;
  const horizontal =
    direction === 'horizontal' ? separatedX || !separatedY : !separatedY && separatedX;
  if (horizontal) {
    return {
      source: {
        x: sourceCenter.x + ((dx >= 0 ? 1 : -1) * source.size.width) / 2,
        y: sourceCenter.y,
      },
      target: {
        x: targetCenter.x + ((dx >= 0 ? -1 : 1) * target.size.width) / 2,
        y: targetCenter.y,
      },
      sourceSide: dx >= 0 ? 'right' : 'left',
      targetSide: dx >= 0 ? 'left' : 'right',
    };
  }
  return {
    source: {
      x: sourceCenter.x,
      y: sourceCenter.y + ((dy >= 0 ? 1 : -1) * source.size.height) / 2,
    },
    target: {
      x: targetCenter.x,
      y: targetCenter.y + ((dy >= 0 ? -1 : 1) * target.size.height) / 2,
    },
    sourceSide: dy >= 0 ? 'bottom' : 'top',
    targetSide: dy >= 0 ? 'top' : 'bottom',
  };
}

export function visualEdgePath(
  source: VisualNode,
  target: VisualNode,
  direction: LayoutDirection,
): string {
  const anchors = visualEdgeAnchors(source, target, direction);
  return directionalBezierPath(anchors.source, anchors.target, anchors.sourceSide);
}

export function directionalBezierPath(
  source: Point,
  target: Point,
  direction: LayoutDirection | AnchorSide,
): string {
  const horizontal = direction === 'horizontal' || direction === 'left' || direction === 'right';
  const offset = horizontal ? target.x - source.x : target.y - source.y;
  const sign =
    direction === 'right' || direction === 'bottom'
      ? 1
      : direction === 'left' || direction === 'top'
        ? -1
        : Math.sign(offset);
  const spread = sign * Math.abs(offset) * 0.45;
  const c1 = horizontal
    ? { x: source.x + spread, y: source.y }
    : { x: source.x, y: source.y + spread };
  const c2 = horizontal
    ? { x: target.x - spread, y: target.y }
    : { x: target.x, y: target.y - spread };
  return `M ${round(source.x)},${round(source.y)} C ${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(target.x)},${round(target.y)}`;
}
