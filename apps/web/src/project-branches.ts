import { resolveChildrenHierarchyRoles, resolveGraphBranchColors } from '@workspacetree/layout';
import type { DomainState } from '@workspacetree/schema';

export interface SpineSummaryItem {
  id: string;
  title: string;
  nodeIds: string[];
  nodeCount: number;
  startTitle: string;
  endTitle: string;
  leafNodeId: string;
}

export interface BranchSummaryItem {
  id: string;
  title: string;
  color: string;
  nodeCount: number;
  subtreeNodeIds: string[];
  deepestLeafId: string;
  parentTitle: string | null;
  isIndependent: boolean;
}

export interface ProjectRefSummaryItem {
  type: 'project_ref';
  projectId: string;
  mode: string;
  hostNodeId: string | null;
  hostTitle: string | null;
}

export interface EdgeRefSummaryItem {
  type: 'edge_ref';
  id: string;
  edgeType: 'reference' | 'dependency';
  fromNodeId: string;
  fromTitle: string;
  toNodeId: string;
  toTitle: string;
  note: string | null;
}

export type ReferenceSummaryItem = ProjectRefSummaryItem | EdgeRefSummaryItem;

export interface ProjectStructureSummary {
  spines: SpineSummaryItem[];
  branches: BranchSummaryItem[];
  references: ReferenceSummaryItem[];
}

export function extractProjectStructure(domain: DomainState): ProjectStructureSummary {
  const nodeMap = new Map(domain.nodes.map((n) => [n.id, n]));
  const hierarchyEdges = domain.edges.filter((e) => e.type === 'hierarchy');

  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();
  for (const edge of hierarchyEdges) {
    if (!nodeMap.has(edge.fromNodeId) || !nodeMap.has(edge.toNodeId)) continue;
    const list = childrenByParent.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    childrenByParent.set(edge.fromNodeId, list);
    parentByChild.set(edge.toNodeId, edge.fromNodeId);
  }

  // 1. Spines
  const spines: SpineSummaryItem[] = domain.spines.map((spine) => {
    const startId = spine.nodeIds[0];
    const endId = spine.nodeIds[spine.nodeIds.length - 1];
    return {
      id: spine.id,
      title: spine.title,
      nodeIds: spine.nodeIds,
      nodeCount: spine.nodeIds.length,
      startTitle: startId ? (nodeMap.get(startId)?.title ?? startId) : '空主线',
      endTitle: endId ? (nodeMap.get(endId)?.title ?? endId) : '空主线',
      leafNodeId: endId ?? domain.project.rootNodeId,
    };
  });

  // Branch colors
  const { nodeBranchColors } = resolveGraphBranchColors(
    domain.nodes,
    domain.edges,
    domain.project.rootNodeId,
    domain.spines,
  );

  function getSubtreeInfo(rootId: string): { subtreeNodeIds: string[]; deepestLeafId: string } {
    const subtreeNodeIds: string[] = [];
    let deepestLeafId = rootId;
    let maxDepth = -1;
    const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      subtreeNodeIds.push(id);
      const kids = childrenByParent.get(id) ?? [];
      if (kids.length === 0) {
        if (depth > maxDepth) {
          maxDepth = depth;
          deepestLeafId = id;
        }
      } else {
        for (const kid of kids) {
          queue.push({ id: kid, depth: depth + 1 });
        }
      }
    }
    return { subtreeNodeIds, deepestLeafId };
  }

  // 2. Branches:
  // (a) Independent / floating components (nodes that have no parent hierarchy edge, but are not rootNodeId)
  const branchRoots = new Set<string>();
  const independentRoots = new Set<string>();

  for (const node of domain.nodes) {
    if (node.id !== domain.project.rootNodeId && !parentByChild.has(node.id)) {
      branchRoots.add(node.id);
      independentRoots.add(node.id);
    }
  }

  // (b) Subtrees forked from connected hierarchy
  for (const node of domain.nodes) {
    const kids = childrenByParent.get(node.id) ?? [];
    if (kids.length === 0) continue;
    const roles = resolveChildrenHierarchyRoles(node.id, kids, domain.edges, domain.spines);
    for (const bId of roles.branches) {
      branchRoots.add(bId);
    }
    // If it's rootNodeId, any child that isn't continuation is also a branch
    if (node.id === domain.project.rootNodeId) {
      for (const kid of kids) {
        if (kid !== roles.continuation) {
          branchRoots.add(kid);
        }
      }
    }
  }

  const branches: BranchSummaryItem[] = [];
  for (const branchId of branchRoots) {
    const node = nodeMap.get(branchId);
    if (!node) continue;
    const { subtreeNodeIds, deepestLeafId } = getSubtreeInfo(branchId);
    const parentId = parentByChild.get(branchId);
    const parentTitle = parentId ? (nodeMap.get(parentId)?.title ?? parentId) : null;
    const isIndependent = independentRoots.has(branchId);
    const color = nodeBranchColors.get(branchId) ?? '#2563eb';

    branches.push({
      id: branchId,
      title: node.title,
      color,
      nodeCount: subtreeNodeIds.length,
      subtreeNodeIds,
      deepestLeafId,
      parentTitle,
      isIndependent,
    });
  }

  // Sort branches: independent/pasted first, then by subtree size descending
  branches.sort((a, b) => {
    if (a.isIndependent !== b.isIndependent) return a.isIndependent ? -1 : 1;
    return b.nodeCount - a.nodeCount || a.title.localeCompare(b.title, 'zh-CN');
  });

  // 3. References
  const references: ReferenceSummaryItem[] = [];
  for (const ref of domain.projectRefs) {
    references.push({
      type: 'project_ref',
      projectId: ref.projectId,
      mode: ref.mode,
      hostNodeId: ref.hostNodeId,
      hostTitle: ref.hostNodeId ? (nodeMap.get(ref.hostNodeId)?.title ?? ref.hostNodeId) : null,
    });
  }

  for (const edge of domain.edges) {
    if (edge.type === 'reference' || edge.type === 'dependency') {
      references.push({
        type: 'edge_ref',
        id: edge.id,
        edgeType: edge.type,
        fromNodeId: edge.fromNodeId,
        fromTitle: nodeMap.get(edge.fromNodeId)?.title ?? edge.fromNodeId,
        toNodeId: edge.toNodeId,
        toTitle: nodeMap.get(edge.toNodeId)?.title ?? edge.toNodeId,
        note: edge.note ?? null,
      });
    }
  }

  return { spines, branches, references };
}
