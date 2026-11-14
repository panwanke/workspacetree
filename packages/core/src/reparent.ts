import { EdgeSchema, SpineSchema, type DomainState, type Edge } from '@workspacetree/schema';
import { ValidationError } from './errors.js';
import { validateDomain } from './validation.js';

export function reparentNode(
  domain: DomainState,
  nodeId: string,
  parentId: string | null,
  edgeId: string | null,
): DomainState {
  const node = domain.nodes.find((item) => item.id === nodeId);
  if (!node) throw new ValidationError('Source node no longer exists');
  if (nodeId === domain.project.rootNodeId) {
    throw new ValidationError('The project root cannot be moved');
  }
  if (parentId !== null && !domain.nodes.some((item) => item.id === parentId)) {
    throw new ValidationError('Destination node no longer exists');
  }
  const incoming = new Map(
    domain.edges.filter((edge) => edge.type === 'hierarchy').map((edge) => [edge.toNodeId, edge]),
  );
  const parents = new Map(
    domain.nodes.map((item) => [item.id, incoming.get(item.id)?.fromNodeId ?? item.parentId]),
  );
  const previous = incoming.get(nodeId);
  if ((previous?.fromNodeId ?? node.parentId) === parentId) return domain;

  const ancestors = new Set<string>();
  let cursor = parentId;
  while (cursor !== null) {
    if (cursor === nodeId || ancestors.has(cursor)) {
      throw new ValidationError('A branch cannot be moved into itself or its descendants');
    }
    ancestors.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }

  const next = {
    ...domain,
    nodes: domain.nodes.map((item) => (item.id === nodeId ? { ...item, parentId } : item)),
    edges: [...domain.edges],
    spines: [...domain.spines],
  };
  if (previous) {
    const index = next.edges.indexOf(previous);
    if (parentId === null) next.edges.splice(index, 1);
    else next.edges[index] = { ...previous, fromNodeId: parentId, role: 'branch' };
  } else if (parentId !== null) {
    if (!edgeId) throw new ValidationError('A new hierarchy edge requires an ID');
    next.edges.push({
      id: edgeId,
      type: 'hierarchy',
      fromNodeId: parentId,
      toNodeId: nodeId,
      role: 'branch',
    });
  }

  if (previous) {
    const parentPath: string[] = [];
    cursor = parentId;
    while (cursor !== null) {
      parentPath.push(cursor);
      cursor = incoming.get(cursor)?.fromNodeId ?? null;
    }
    parentPath.reverse();
    next.spines = next.spines.map((spine) => {
      const index = spine.nodeIds.indexOf(nodeId);
      if (index <= 0 || spine.nodeIds[index - 1] !== previous.fromNodeId) return spine;
      return { ...spine, nodeIds: [...parentPath, ...spine.nodeIds.slice(index)] };
    });
  }
  validateDomain(next);
  return next;
}

export function restoreNodeParent(
  domain: DomainState,
  nodeId: string,
  parentId: string | null,
  previousEdge: unknown,
  edgeIndex: number,
  previousSpines: unknown[],
): void {
  const node = domain.nodes.find((item) => item.id === nodeId);
  if (!node || nodeId === domain.project.rootNodeId) {
    throw new ValidationError('Cannot restore parent for this node');
  }
  const parsedSpines = previousSpines.map((spine) => SpineSchema.safeParse(spine));
  if (parsedSpines.some((result) => !result.success)) {
    throw new ValidationError('Invalid previous spine path');
  }
  const spineMap = new Map(
    parsedSpines.flatMap((result) => (result.success ? [[result.data.id, result.data]] : [])),
  );
  let edge: Edge | undefined;
  if (previousEdge !== null) {
    const parsed = EdgeSchema.safeParse(previousEdge);
    if (!parsed.success || parsed.data.type !== 'hierarchy' || parsed.data.toNodeId !== nodeId) {
      throw new ValidationError('Invalid previous hierarchy edge');
    }
    edge = parsed.data;
  }

  node.parentId = parentId;
  domain.edges = domain.edges.filter(
    (item) => item.type !== 'hierarchy' || item.toNodeId !== nodeId,
  );
  if (edge) {
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex > domain.edges.length) {
      throw new ValidationError('Invalid previous hierarchy edge position');
    }
    domain.edges.splice(edgeIndex, 0, edge);
  }
  domain.spines = domain.spines.map((spine) => spineMap.get(spine.id) ?? spine);
}
