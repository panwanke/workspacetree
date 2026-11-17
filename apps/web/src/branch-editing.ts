import { makeId, reparentNode } from '@workspacetree/core';
import {
  buildHierarchy,
  resolveLayoutDirection,
  resolveVisualGraph,
  type LayoutStrategy,
  type Point,
  type VisualGraph,
} from '@workspacetree/layout';
import { extractAssetIds } from '@workspacetree/markdown';
import type {
  BranchFile,
  Command,
  HierarchyEdgeRole,
  LayoutDirection,
  SavedPresentation,
} from '@workspacetree/schema';
import { replaceDomainEntry, type HistoryEntry } from './history';

export function subtreeIds(
  children: ReadonlyMap<string, readonly string[]>,
  rootId: string,
): string[] {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index++) ids.push(...(children.get(ids[index]) ?? []));
  return ids;
}

function positionKey(direction: LayoutDirection): 'nodePositions' | 'verticalNodePositions' {
  return direction === 'vertical' ? 'verticalNodePositions' : 'nodePositions';
}

function presentationEdit(
  label: string,
  before: SavedPresentation,
  after: SavedPresentation,
): HistoryEntry {
  const replace = (presentation: SavedPresentation): Command => ({
    type: 'presentation.replace',
    payload: { presentation },
  });
  return {
    label,
    stateClass: 'presentation',
    actorKind: 'human',
    forward: [replace(after)],
    inverse: [replace(structuredClone(before))],
  };
}

function translatedPositions(
  ids: readonly string[],
  positions: Readonly<Record<string, Point>>,
  from: Point,
  to: Point,
): Record<string, Point> {
  return Object.fromEntries(
    ids.map((id) => {
      const point = positions[id];
      return [id, { x: to.x + (point.x - from.x), y: to.y + (point.y - from.y) }];
    }),
  );
}

function expandedGraph(
  file: BranchFile,
  direction: LayoutDirection,
  strategy: LayoutStrategy,
): VisualGraph {
  return resolveVisualGraph(
    file.domain,
    { ...file.presentation, layoutDirection: direction, collapsedByDefault: [] },
    { strategy },
  );
}

function inheritedScale(
  parents: ReadonlyMap<string, string | null>,
  parentId: string | null,
  presentation: SavedPresentation,
): number {
  const path: string[] = [];
  for (let id = parentId; id !== null; id = parents.get(id) ?? null) path.push(id);
  return path
    .reverse()
    .reduce(
      (scale, id) =>
        scale *
        (presentation.branchScaleCompensation?.[id] ?? 1) *
        (presentation.branchScales[id] ?? 1),
      1,
    );
}

function branchDestination(
  source: VisualGraph,
  destination: VisualGraph,
  ids: readonly string[],
  nodeId: string,
  parentId: string,
  excluded: ReadonlySet<string> = new Set(ids),
): Point {
  const gap = 32;
  const target = destination.nodeById[parentId];
  const root = source.positions[nodeId];
  const others = destination.nodes.filter((node) => !excluded.has(node.id));
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const { position, size } = source.nodeById[id];
    left = Math.min(left, position.x - root.x);
    top = Math.min(top, position.y - root.y);
    right = Math.max(right, position.x + size.width - root.x);
    bottom = Math.max(bottom, position.y + size.height - root.y);
  }
  const clear = ({ x, y }: Point): boolean =>
    others.every(
      ({ position, size }) =>
        x + right + gap <= position.x ||
        x + left >= position.x + size.width + gap ||
        y + bottom + gap <= position.y ||
        y + top >= position.y + size.height + gap,
    );
  const nextTo = { x: target.position.x + target.size.width + gap - left, y: target.position.y };
  const below = { x: target.position.x, y: target.position.y + target.size.height + gap - top };
  const choices = destination.direction === 'vertical' ? [below, nextTo] : [nextTo, below];
  const available = choices.find(clear);
  if (available) return available;
  if (destination.direction === 'vertical') {
    let rightmost = nextTo.x;
    for (const node of others) {
      if (
        nextTo.y + bottom + gap > node.position.y &&
        nextTo.y + top < node.position.y + node.size.height + gap
      ) {
        rightmost = Math.max(rightmost, node.position.x + node.size.width + gap - left);
      }
    }
    return { x: rightmost, y: nextTo.y };
  }
  let lowest = below.y;
  for (const node of others) {
    if (
      below.x + right + gap > node.position.x &&
      below.x + left < node.position.x + node.size.width + gap
    ) {
      lowest = Math.max(lowest, node.position.y + node.size.height + gap - top);
    }
  }
  return { x: below.x, y: lowest };
}

export function transferBranch(
  source: BranchFile,
  target: BranchFile,
  nodeId: string,
  parentId: string,
  strategy: LayoutStrategy,
): { id: string; receive: HistoryEntry; remove: HistoryEntry } {
  if (nodeId === source.domain.project.rootNodeId) throw new Error('项目根节点不能剪切');
  const sourceTree = buildHierarchy(source.domain.nodes, source.domain.edges);
  const targetTree = buildHierarchy(target.domain.nodes, target.domain.edges);
  if (!sourceTree.parents.has(nodeId) || !targetTree.parents.has(parentId)) {
    throw new Error('源分支或目标节点已经不存在');
  }
  const ids = subtreeIds(sourceTree.children, nodeId);
  const moving = new Set(ids);
  const mapping = new Map(ids.map((id) => [id, makeId('n_')]));
  const mapped = (id: string) => mapping.get(id)!;
  const inside = (id: string | null) => id !== null && moving.has(id);
  const nodes = source.domain.nodes.filter((node) => moving.has(node.id));
  const blocks = new Set(nodes.flatMap((node) => node.blockIds));
  const hierarchyNotes = new Map(
    source.domain.edges
      .filter((edge) => edge.type === 'hierarchy')
      .map((edge) => [edge.toNodeId, edge.note]),
  );
  const hierarchyRoles = new Map(
    source.domain.edges
      .filter((edge) => edge.type === 'hierarchy')
      .map((edge) => [edge.toNodeId, edge.role]),
  );
  const primaryNotes = new Map(
    nodes.map((node) => ['blk_note_' + node.id, 'blk_note_' + mapped(node.id)]),
  );
  const blockMap = new Map([...blocks].map((id) => [id, primaryNotes.get(id) ?? makeId('b_')]));
  const next = structuredClone(target.domain);
  next.nodes.push(
    ...nodes.map((node) => ({
      ...node,
      id: mapped(node.id),
      parentId: node.id === nodeId ? parentId : mapped(sourceTree.parents.get(node.id)!),
      blockIds: node.blockIds.map((id) => blockMap.get(id)!),
    })),
  );
  next.blocks.push(
    ...source.domain.blocks
      .filter((block) => blocks.has(block.id))
      .map((block) => ({ ...block, id: blockMap.get(block.id)! })),
  );
  if (source.domain.assets) {
    const transferredMarkdown = source.domain.blocks
      .filter((block) => blocks.has(block.id))
      .map((block) => {
        const payload = block.payload as { markdown?: string } | undefined;
        return typeof payload?.markdown === 'string' ? payload.markdown : '';
      })
      .join('\n');
    const referencedAssetIds = extractAssetIds(transferredMarkdown);
    if (referencedAssetIds.length > 0) {
      next.assets = next.assets ? { ...next.assets } : {};
      for (const assetId of referencedAssetIds) {
        if (source.domain.assets[assetId]) {
          next.assets[assetId] = source.domain.assets[assetId];
        }
      }
    }
  }
  next.edges.push(
    ...source.domain.edges
      .filter(
        (edge) => edge.type !== 'hierarchy' && inside(edge.fromNodeId) && inside(edge.toNodeId),
      )
      .map((edge) => ({
        ...edge,
        id: makeId('e_'),
        fromNodeId: mapped(edge.fromNodeId),
        toNodeId: mapped(edge.toNodeId),
      })),
    ...nodes.map((node) => ({
      id: makeId('e_'),
      type: 'hierarchy' as const,
      toNodeId: mapped(node.id),
      fromNodeId: node.id === nodeId ? parentId : mapped(sourceTree.parents.get(node.id)!),
      role: (node.id === nodeId ? 'branch' : hierarchyRoles.get(node.id)) as
        HierarchyEdgeRole | undefined,
      note: node.id === nodeId ? undefined : hierarchyNotes.get(node.id),
    })),
  );
  next.tasks.push(
    ...source.domain.tasks
      .filter((task) => inside(task.nodeId))
      .map((task) => ({ ...task, id: makeId('task_'), nodeId: mapped(task.nodeId!) })),
  );
  for (const spine of source.domain.spines) {
    const path = spine.nodeIds.filter(inside);
    if (path.length > 1)
      next.spines.push({ ...spine, id: makeId('spn_'), nodeIds: path.map(mapped) });
  }
  next.projectRefs.push(
    ...source.domain.projectRefs
      .filter((ref) => inside(ref.hostNodeId) && ref.projectId !== next.project.id)
      .map((ref) => ({ ...ref, hostNodeId: mapped(ref.hostNodeId!) })),
  );

  const targetPresentation = structuredClone(target.presentation);
  const sourcePresentation = structuredClone(source.presentation);
  for (const field of [
    'nodeScales',
    'nodeSizes',
    'branchScales',
    'branchScaleCompensation',
  ] as const) {
    const values = sourcePresentation[field];
    if (!values) continue;
    const transferred = Object.fromEntries(
      ids.filter((id) => values[id] !== undefined).map((id) => [mapped(id), values[id]]),
    );
    Object.assign((targetPresentation[field] ??= {}), transferred);
    for (const id of ids) delete values[id];
  }
  const oldScale = inheritedScale(
    sourceTree.parents,
    sourceTree.parents.get(nodeId) ?? null,
    source.presentation,
  );
  const newScale = inheritedScale(targetTree.parents, parentId, target.presentation);
  if (oldScale !== newScale) {
    targetPresentation.branchScaleCompensation ??= {};
    targetPresentation.branchScaleCompensation[mapped(nodeId)] =
      ((source.presentation.branchScaleCompensation?.[nodeId] ?? 1) * oldScale) / newScale;
  }
  const ancestors = new Set<string>();
  for (let id: string | null = parentId; id !== null; id = targetTree.parents.get(id) ?? null)
    ancestors.add(id);
  targetPresentation.collapsedByDefault = [
    ...targetPresentation.collapsedByDefault.filter((id) => !ancestors.has(id)),
    ...sourcePresentation.collapsedByDefault.filter(inside).map(mapped),
  ];
  sourcePresentation.collapsedByDefault = sourcePresentation.collapsedByDefault.filter(
    (id) => !inside(id),
  );

  for (const direction of ['horizontal', 'vertical'] as const) {
    const key = positionKey(direction);
    const from = expandedGraph(source, direction, strategy);
    const to = expandedGraph(
      { ...target, domain: next, presentation: targetPresentation },
      direction,
      strategy,
    );
    const at = branchDestination(from, to, ids, nodeId, parentId, new Set(mapping.values()));
    const translated = translatedPositions(ids, from.positions, from.positions[nodeId], at);
    targetPresentation[key] = {
      ...targetPresentation[key],
      ...Object.fromEntries(ids.map((id) => [mapped(id), translated[id]])),
    };
    for (const id of ids) delete sourcePresentation[key]?.[id];
  }
  const remaining = structuredClone(source.domain);
  remaining.nodes = remaining.nodes.filter((node) => !inside(node.id));
  const retainedBlocks = new Set(remaining.nodes.flatMap((node) => node.blockIds));
  remaining.blocks = remaining.blocks.filter(
    (block) => !blocks.has(block.id) || retainedBlocks.has(block.id),
  );
  remaining.edges = remaining.edges.filter(
    (edge) => !inside(edge.fromNodeId) && !inside(edge.toNodeId),
  );
  remaining.tasks = remaining.tasks.filter((task) => !inside(task.nodeId));
  remaining.spines = remaining.spines
    .map((spine) => ({ ...spine, nodeIds: spine.nodeIds.filter((id) => !inside(id)) }))
    .filter((spine) => spine.nodeIds.length > 0);
  remaining.projectRefs = remaining.projectRefs.filter((ref) => !inside(ref.hostNodeId));
  if (!remaining.spines.some((spine) => spine.id === sourcePresentation.savedSpineDisplay)) {
    sourcePresentation.savedSpineDisplay = null;
  }
  const edit = (
    file: BranchFile,
    domain: BranchFile['domain'],
    presentation: SavedPresentation,
  ) => ({
    ...replaceDomainEntry(file.domain, domain),
    label: '跨标签页移动分支',
    actorKind: 'human' as const,
    chained: presentationEdit('移动分支位置', file.presentation, presentation),
    atomic: true,
  });
  return {
    id: mapped(nodeId),
    receive: edit(target, next, targetPresentation),
    remove: edit(source, remaining, sourcePresentation),
  };
}

export function reparentBranchEntry(
  file: BranchFile,
  nodeId: string,
  parentId: string | null,
  strategy: LayoutStrategy = 'timeline',
  keepPosition = false,
): HistoryEntry | null {
  const { domain, presentation } = file;
  const edgeId = makeId('e_');
  const nextDomain = reparentNode(domain, nodeId, parentId, edgeId);
  if (nextDomain === domain) return null;

  const { children, parents } = buildHierarchy(domain.nodes, domain.edges);
  const ids = subtreeIds(children, nodeId);
  const oldEdgeIndex = domain.edges.findIndex(
    (edge) => edge.type === 'hierarchy' && edge.toNodeId === nodeId,
  );
  const oldEdge = domain.edges[oldEdgeIndex] ?? null;
  const node = domain.nodes.find((item) => item.id === nodeId)!;
  const previousSpines = domain.spines.filter((spine, index) => spine !== nextDomain.spines[index]);
  const nextPresentation = structuredClone(presentation);
  nextPresentation.layoutDirection = resolveLayoutDirection(presentation);
  const oldInherited = inheritedScale(parents, parents.get(nodeId) ?? null, presentation);
  const newInherited = inheritedScale(parents, parentId, presentation);
  const compensation =
    (presentation.branchScaleCompensation?.[nodeId] ?? 1) * (oldInherited / newInherited);
  if (oldInherited !== newInherited) {
    if (!Number.isFinite(compensation) || compensation <= 0)
      throw new Error('Invalid inherited branch scale');
    if (compensation === 1) {
      if (nextPresentation.branchScaleCompensation) {
        delete nextPresentation.branchScaleCompensation[nodeId];
        if (!Object.keys(nextPresentation.branchScaleCompensation).length) {
          delete nextPresentation.branchScaleCompensation;
        }
      }
    } else {
      nextPresentation.branchScaleCompensation ??= {};
      nextPresentation.branchScaleCompensation[nodeId] = compensation;
    }
  }
  if (parentId !== null) {
    const ancestors = new Set<string>();
    for (let id: string | null = parentId; id !== null; id = parents.get(id) ?? null)
      ancestors.add(id);
    nextPresentation.collapsedByDefault = presentation.collapsedByDefault.filter(
      (id) => !ancestors.has(id),
    );
  }
  for (const direction of ['horizontal', 'vertical'] as const) {
    const graph = expandedGraph(file, direction, strategy);
    const origin = graph.positions[nodeId];
    const target =
      keepPosition || parentId === null
        ? origin
        : branchDestination(
            graph,
            resolveVisualGraph(
              nextDomain,
              { ...nextPresentation, layoutDirection: direction },
              { strategy },
            ),
            ids,
            nodeId,
            parentId,
          );
    const key = positionKey(direction);
    nextPresentation[key] = {
      ...nextPresentation[key],
      ...translatedPositions(ids, graph.positions, origin, target),
    };
  }
  return {
    label: parentId === null ? '解除父子连接' : '移动分支',
    stateClass: 'domain',
    actorKind: 'human',
    forward: [{ type: 'node.reparent', payload: { id: nodeId, parentId, edgeId } }],
    inverse: [
      {
        type: 'node.restoreParent',
        payload: {
          id: nodeId,
          parentId: node.parentId,
          edge: oldEdge,
          edgeIndex: oldEdgeIndex,
          spines: previousSpines,
        },
      },
    ],
    atomic: true,
    chained: presentationEdit('移动分支位置', presentation, nextPresentation),
  };
}

export function translateBranchPositions(
  file: BranchFile,
  nodeId: string,
  direction: LayoutDirection,
  to: Point,
  strategy: LayoutStrategy = 'timeline',
): Record<string, Point> {
  const { children } = buildHierarchy(file.domain.nodes, file.domain.edges);
  const ids = subtreeIds(children, nodeId);
  const graph = expandedGraph(file, direction, strategy);
  return translatedPositions(ids, graph.positions, graph.positions[nodeId], to);
}

export function restoreBranchLayoutEntry(
  file: BranchFile,
  nodeId: string,
  direction: LayoutDirection,
): HistoryEntry | null {
  const { children } = buildHierarchy(file.domain.nodes, file.domain.edges);
  const ids = new Set(subtreeIds(children, nodeId));
  const key = positionKey(direction);
  const before = Object.entries(file.presentation[key] ?? {});
  const remaining = before.filter(([id]) => !ids.has(id));
  if (before.length === remaining.length) return null;
  return presentationEdit('恢复此分支自动布局', file.presentation, {
    ...file.presentation,
    layoutDirection: resolveLayoutDirection(file.presentation),
    [key]: Object.fromEntries(remaining),
  });
}
