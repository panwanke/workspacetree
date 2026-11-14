import type { Edge, HierarchyEdgeRole, Node, Spine } from '@workspacetree/schema';

export const BRANCH_PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#dc2626', // red
  '#7c3aed', // purple
  '#0891b2', // cyan
  '#ea580c', // orange
  '#059669', // emerald
  '#d97706', // amber
] as const;

export const MAINLINE_COLOR = '#64748b';
export const DEPENDENCY_COLOR = '#dc2626';
export const REFERENCE_COLOR = '#c026d3';

export interface ChildrenHierarchyRoles {
  continuation: string | null;
  leaves: string[];
  branches: string[];
  roleByChild: Map<string, HierarchyEdgeRole>;
}

export function resolveChildrenHierarchyRoles(
  parentId: string,
  childIds: readonly string[],
  edges: readonly Edge[],
  spines: readonly Spine[] = [],
): ChildrenHierarchyRoles {
  const roleByChild = new Map<string, HierarchyEdgeRole>();
  const edgeByChild = new Map<string, Edge>();
  for (const edge of edges) {
    if (
      edge.type === 'hierarchy' &&
      edge.fromNodeId === parentId &&
      childIds.includes(edge.toNodeId)
    ) {
      edgeByChild.set(edge.toNodeId, edge);
    }
  }

  let explicitContinuation: string | null = null;
  const leaves: string[] = [];
  const branches: string[] = [];
  const unassigned: string[] = [];

  for (const childId of childIds) {
    const edge = edgeByChild.get(childId);
    if (edge?.role === 'continuation') {
      explicitContinuation = childId;
      roleByChild.set(childId, 'continuation');
    } else if (edge?.role === 'branch') {
      branches.push(childId);
      roleByChild.set(childId, 'branch');
    } else if (edge?.role === 'leaf') {
      leaves.push(childId);
      roleByChild.set(childId, 'leaf');
    } else {
      unassigned.push(childId);
    }
  }

  const hasHierarchyChildren = (nodeId: string) =>
    edges.some((e) => e.type === 'hierarchy' && e.fromNodeId === nodeId);

  let continuation: string | null = explicitContinuation;
  if (!continuation && unassigned.length > 0) {
    // Check spines for continuous paths passing through parentId -> childId
    const spineRank = new Map<string, number>();
    for (const { nodeIds } of spines) {
      const idx = nodeIds.indexOf(parentId);
      if (idx >= 0 && idx + 1 < nodeIds.length) {
        const nextId = nodeIds[idx + 1];
        if (unassigned.includes(nextId)) {
          const rank = nodeIds.length - (idx + 1);
          spineRank.set(nextId, Math.max(spineRank.get(nextId) ?? 0, rank));
        }
      }
    }
    // Sort unassigned children: spine rank first, then original edge order
    unassigned.sort((a, b) => (spineRank.get(b) ?? 0) - (spineRank.get(a) ?? 0));
    continuation = unassigned[0];
    roleByChild.set(continuation, 'continuation');
    for (let i = 1; i < unassigned.length; i++) {
      const childId = unassigned[i];
      if (hasHierarchyChildren(childId)) {
        branches.push(childId);
        roleByChild.set(childId, 'branch');
      } else {
        leaves.push(childId);
        roleByChild.set(childId, 'leaf');
      }
    }
  } else {
    for (const childId of unassigned) {
      if (hasHierarchyChildren(childId)) {
        branches.push(childId);
        roleByChild.set(childId, 'branch');
      } else {
        leaves.push(childId);
        roleByChild.set(childId, 'leaf');
      }
    }
  }

  return { continuation, leaves, branches, roleByChild };
}

/**
 * 遍历层次结构，为主线与各分支分配确定性的颜色。
 * 主线连线使用 MAINLINE_COLOR。
 * 每条侧枝（从分叉边开始）依次分配稳定、易区分的调色板颜色。
 * 节点折叠与展开不影响颜色分配（直接基于 domain 实体计算）。
 */
export function resolveGraphBranchColors(
  nodes: readonly Node[],
  edges: readonly Edge[],
  rootNodeId: string,
  spines: readonly Spine[] = [],
): {
  edgeColors: Map<string, string>;
  nodeBranchColors: Map<string, string>;
} {
  const edgeColors = new Map<string, string>();
  const nodeBranchColors = new Map<string, string>();

  const hierarchyEdgesByParent = new Map<string, Edge[]>();
  const edgeById = new Map<string, Edge>();
  for (const edge of edges) {
    edgeById.set(edge.id, edge);
    if (edge.type === 'hierarchy') {
      const list = hierarchyEdgesByParent.get(edge.fromNodeId) ?? [];
      list.push(edge);
      hierarchyEdgesByParent.set(edge.fromNodeId, list);
    } else if (edge.type === 'dependency') {
      edgeColors.set(edge.id, DEPENDENCY_COLOR);
    } else {
      edgeColors.set(edge.id, REFERENCE_COLOR);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let paletteIndex = 0;
  const nextColor = () => {
    const color = BRANCH_PALETTE[paletteIndex % BRANCH_PALETTE.length];
    paletteIndex += 1;
    return color;
  };

  const traverse = (nodeId: string, currentBranchColor: string): void => {
    nodeBranchColors.set(nodeId, currentBranchColor);
    const childEdges = hierarchyEdgesByParent.get(nodeId) ?? [];
    if (childEdges.length === 0) return;

    const childIds = childEdges.map((e) => e.toNodeId).filter((id) => nodeMap.has(id));
    const roles = resolveChildrenHierarchyRoles(nodeId, childIds, edges, spines);

    // 1. Continuation child
    if (roles.continuation) {
      const edge = childEdges.find((e) => e.toNodeId === roles.continuation);
      if (edge) {
        edgeColors.set(edge.id, currentBranchColor);
        traverse(roles.continuation, currentBranchColor);
      }
    }

    // 2. Normal leaves
    for (const leafId of roles.leaves) {
      const edge = childEdges.find((e) => e.toNodeId === leafId);
      if (edge) {
        edgeColors.set(edge.id, currentBranchColor);
        traverse(leafId, currentBranchColor);
      }
    }

    // 3. Branches: every branch fork gets a new distinct branch color
    for (const branchId of roles.branches) {
      const edge = childEdges.find((e) => e.toNodeId === branchId);
      if (edge) {
        const branchColor = nextColor();
        edgeColors.set(edge.id, branchColor);
        traverse(branchId, branchColor);
      }
    }
  };

  // Start with root node on mainline
  if (nodeMap.has(rootNodeId)) {
    traverse(rootNodeId, MAINLINE_COLOR);
  }

  // Handle any other root/independent branches
  const childrenSet = new Set(edges.filter((e) => e.type === 'hierarchy').map((e) => e.toNodeId));
  for (const node of nodes) {
    if (node.id !== rootNodeId && !childrenSet.has(node.id) && !nodeBranchColors.has(node.id)) {
      const branchColor = nextColor();
      traverse(node.id, branchColor);
    }
  }

  return { edgeColors, nodeBranchColors };
}
