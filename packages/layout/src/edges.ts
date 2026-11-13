/**
 * 边图层、关联数量提示、主干高亮与任务统计（06 §二 Phase 1 任务 3 / 4、验收 2 / 3 / 8）。
 * 全部为纯函数；高亮只产出「显示集合」，绝不改动 DomainState 拓扑。
 */
import type { Edge, EdgeType, Spine, Task } from '@workspacetree/schema';
import { DEFAULT_VISIBLE_EDGE_TYPES, type VisibleEdgeTypes } from './types.js';

export function filterEdges(
  edges: readonly Edge[],
  visibleTypes: VisibleEdgeTypes = DEFAULT_VISIBLE_EDGE_TYPES,
): Edge[] {
  const visible = new Set<EdgeType>(visibleTypes);
  return edges.filter((edge) => visible.has(edge.type));
}

/** 被隐藏的关联边数量，按端点双向计数，用于节点卡片上的「关联数量提示」。 */
export function relationCounts(
  edges: readonly Edge[],
  visibleTypes: VisibleEdgeTypes = DEFAULT_VISIBLE_EDGE_TYPES,
): Record<string, number> {
  const visible = new Set<EdgeType>(visibleTypes);
  const counts: Record<string, number> = {};
  for (const edge of edges) {
    if (visible.has(edge.type)) continue;
    counts[edge.fromNodeId] = (counts[edge.fromNodeId] ?? 0) + 1;
    counts[edge.toNodeId] = (counts[edge.toNodeId] ?? 0) + 1;
  }
  return counts;
}

export function hiddenRelationCount(
  edges: readonly Edge[],
  visibleTypes: VisibleEdgeTypes = DEFAULT_VISIBLE_EDGE_TYPES,
): number {
  const visible = new Set<EdgeType>(visibleTypes);
  return edges.filter((edge) => !visible.has(edge.type)).length;
}

export interface SpineHighlight {
  spineId: string | null;
  nodeIds: string[];
  edgeIds: string[];
}

export interface SpinePathHighlight {
  spineId: string;
  nodeIds: string[];
  edgeIds: string[];
  continuous: boolean;
}

export interface MultiSpineHighlight {
  nodeIds: string[];
  edgeIds: string[];
  paths: SpinePathHighlight[];
}

/**
 * 单主干高亮：沿 Spine 的相邻节点对找出连接边；只返回显示集合，原始拓扑不变（验收 3）。
 * 找不到 spineId 时返回空高亮，而不是抛错，便于「来回切换」。
 */
export function spineHighlight(
  spines: readonly Spine[],
  edges: readonly Edge[],
  spineId: string | null,
): SpineHighlight {
  if (!spineId) return { spineId: null, nodeIds: [], edgeIds: [] };
  const spine = spines.find((item) => item.id === spineId);
  if (!spine) return { spineId: null, nodeIds: [], edgeIds: [] };
  const nodeIds = [...spine.nodeIds];
  const edgeIds: string[] = [];
  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    const from = nodeIds[i];
    const to = nodeIds[i + 1];
    const match = edges.find(
      (edge) =>
        (edge.fromNodeId === from && edge.toNodeId === to) ||
        (edge.fromNodeId === to && edge.toNodeId === from),
    );
    if (match) edgeIds.push(match.id);
  }
  return { spineId, nodeIds, edgeIds };
}

/** 多主干高亮：保留每条有效路径的连续性，并合并去重所有显示集合。 */
export function multiSpineHighlight(
  spines: readonly Spine[],
  edges: readonly Edge[],
  spineIds: readonly string[],
): MultiSpineHighlight {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const paths: SpinePathHighlight[] = [];
  const seenSpineIds = new Set<string>();
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();

  for (const spineId of spineIds) {
    if (seenSpineIds.has(spineId)) continue;
    seenSpineIds.add(spineId);
    const spine = spines.find((item) => item.id === spineId);
    if (!spine) continue;

    const pathNodeIds = [...spine.nodeIds];
    const pathEdgeIds: string[] = [];
    let continuous = true;
    for (let i = 0; i < pathNodeIds.length - 1; i += 1) {
      const from = pathNodeIds[i];
      const to = pathNodeIds[i + 1];
      const match = edges.find(
        (edge) => edge.type === 'hierarchy' && edge.fromNodeId === from && edge.toNodeId === to,
      );
      if (match) pathEdgeIds.push(match.id);
      else continuous = false;
    }

    for (const nodeId of pathNodeIds) {
      if (seenNodeIds.has(nodeId)) continue;
      seenNodeIds.add(nodeId);
      nodeIds.push(nodeId);
    }
    for (const edgeId of pathEdgeIds) {
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
      edgeIds.push(edgeId);
    }
    paths.push({ spineId, nodeIds: pathNodeIds, edgeIds: pathEdgeIds, continuous });
  }

  return { nodeIds, edgeIds, paths };
}

export interface TaskStats {
  total: number;
  done: number;
  percent: number;
}

export function taskStats(tasks: readonly Task[], nodeId: string): TaskStats {
  const own = tasks.filter((task) => task.nodeId === nodeId);
  const done = own.filter((task) => task.done).length;
  return {
    total: own.length,
    done,
    percent: own.length === 0 ? 0 : Math.round((done / own.length) * 100),
  };
}

export function overallTaskStats(tasks: readonly Task[]): TaskStats {
  const done = tasks.filter((task) => task.done).length;
  return {
    total: tasks.length,
    done,
    percent: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
  };
}
