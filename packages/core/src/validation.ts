/**
 * 图合法性与引用完整性（契约 2 / 7；01 C4 / C5）。
 * hierarchy 与 node.parentId 都必须单父无环；Spine 必须是连续层级边路径。
 * 非法 scale 独立在呈现层校验（C8）。
 */
import {
  MAX_DISPLAY_SCALE,
  MAX_NODE_SCALE,
  MIN_DISPLAY_SCALE,
  MIN_NODE_SCALE,
  type DomainState,
  type SavedPresentation,
} from '@workspacetree/schema';
import { InvalidGraphError } from './errors.js';

function requireUnique(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new InvalidGraphError(`duplicate ${label} id: ${id}`, { id });
    }
    seen.add(id);
  }
}

export function validateDomain(domain: DomainState): void {
  const nodeIds = domain.nodes.map((node) => node.id);
  requireUnique(nodeIds, 'node');
  requireUnique(
    domain.tasks.map((task) => task.id),
    'task',
  );
  requireUnique(
    domain.edges.map((edge) => edge.id),
    'edge',
  );
  requireUnique(
    domain.spines.map((spine) => spine.id),
    'spine',
  );
  requireUnique(
    domain.blocks.map((block) => block.id),
    'block',
  );

  const nodeSet = new Set(nodeIds);
  if (!nodeSet.has(domain.project.rootNodeId)) {
    throw new InvalidGraphError('rootNodeId does not reference an existing node', {
      rootNodeId: domain.project.rootNodeId,
    });
  }

  for (const node of domain.nodes) {
    if (node.parentId !== null && !nodeSet.has(node.parentId)) {
      throw new InvalidGraphError('node.parentId references a missing node', {
        nodeId: node.id,
        parentId: node.parentId,
      });
    }
  }

  const blockSet = new Set(domain.blocks.map((block) => block.id));
  for (const node of domain.nodes) {
    for (const blockId of node.blockIds) {
      if (!blockSet.has(blockId)) {
        throw new InvalidGraphError('node.blockIds references a missing block', {
          nodeId: node.id,
          blockId,
        });
      }
    }
  }

  const hierarchyParents = new Map<string, string>();
  const continuations = new Set<string>();
  for (const edge of domain.edges) {
    if (!nodeSet.has(edge.fromNodeId) || !nodeSet.has(edge.toNodeId)) {
      throw new InvalidGraphError('edge references a missing node', {
        edgeId: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
      });
    }
    if (edge.type === 'hierarchy') {
      if (hierarchyParents.has(edge.toNodeId)) {
        throw new InvalidGraphError('hierarchy edge violates single-parent rule', {
          edgeId: edge.id,
          childNodeId: edge.toNodeId,
        });
      }
      hierarchyParents.set(edge.toNodeId, edge.fromNodeId);
      if (edge.role === 'continuation') {
        if (continuations.has(edge.fromNodeId)) {
          throw new InvalidGraphError('parent node has multiple continuation children', {
            edgeId: edge.id,
            parentNodeId: edge.fromNodeId,
            childNodeId: edge.toNodeId,
          });
        }
        continuations.add(edge.fromNodeId);
      }
    } else if (edge.role !== undefined) {
      throw new InvalidGraphError('non-hierarchy edge cannot have a hierarchy role', {
        edgeId: edge.id,
        type: edge.type,
      });
    }
  }

  for (const start of nodeSet) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new InvalidGraphError('hierarchy cycle detected', { nodeId: start, cycleAt: cursor });
      }
      seen.add(cursor);
      cursor = hierarchyParents.get(cursor);
    }
  }

  // node.parentId 是独立于 hierarchy 边的第二套父子关系，两者都必须无环（01 C4）。
  // 现阶段 reducer 允许二者暂不一致（node.add 只写 parentId、edge.add 只写边），
  // 因此这里只检测环与悬空引用；收敛为单一真相源需连同 reducer / service 一并修改。
  const declaredParents = new Map<string, string>();
  for (const node of domain.nodes) {
    if (node.parentId !== null) declaredParents.set(node.id, node.parentId);
  }
  for (const start of nodeSet) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new InvalidGraphError('parentId cycle detected', { nodeId: start, cycleAt: cursor });
      }
      seen.add(cursor);
      cursor = declaredParents.get(cursor);
    }
  }

  for (const task of domain.tasks) {
    if (task.nodeId !== null && !nodeSet.has(task.nodeId)) {
      throw new InvalidGraphError('task.nodeId references a missing node', {
        taskId: task.id,
        nodeId: task.nodeId,
      });
    }
  }

  for (const spine of domain.spines) {
    for (const nodeId of spine.nodeIds) {
      if (!nodeSet.has(nodeId)) {
        throw new InvalidGraphError('spine.nodeIds references a missing node', {
          spineId: spine.id,
          nodeId,
        });
      }
    }
    // SpineSchema 契约：由连续有效层级边组成的有序路径；多条 Spine 可共享前缀。
    // 缺此校验会让 Phase 2 的共享前缀 / 高亮几何拿到无效基础数据。
    for (let index = 1; index < spine.nodeIds.length; index += 1) {
      const parent = spine.nodeIds[index - 1]!;
      const child = spine.nodeIds[index]!;
      if (hierarchyParents.get(child) !== parent) {
        throw new InvalidGraphError('spine.nodeIds is not a continuous hierarchy path', {
          spineId: spine.id,
          fromNodeId: parent,
          toNodeId: child,
          actualParentId: hierarchyParents.get(child) ?? null,
        });
      }
    }
  }

  for (const ref of domain.projectRefs) {
    if (ref.projectId === domain.project.id) {
      throw new InvalidGraphError('projectRef cannot reference itself', {
        projectId: ref.projectId,
      });
    }
  }
}

export function validatePresentation(presentation: SavedPresentation): void {
  const validateScales = (
    scales: Record<string, number>,
    min: number,
    max: number,
    label: string,
  ): void => {
    for (const [nodeId, scale] of Object.entries(scales)) {
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < min || scale > max) {
        throw new InvalidGraphError(`illegal ${label} scale value`, { nodeId, scale, min, max });
      }
    }
  };
  validateScales(presentation.branchScales, MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE, 'branch');
  validateScales(
    presentation.branchScaleCompensation ?? {},
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    'branch compensation',
  );
  validateScales(presentation.nodeScales ?? {}, MIN_NODE_SCALE, MAX_NODE_SCALE, 'node');
  if (
    presentation.layoutDirection != null &&
    presentation.layoutDirection !== 'horizontal' &&
    presentation.layoutDirection !== 'vertical'
  ) {
    throw new InvalidGraphError('illegal layout direction', {
      layoutDirection: presentation.layoutDirection,
    });
  }
}
