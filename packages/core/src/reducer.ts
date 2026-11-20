/**
 * 纯函数 reducer（05 §四 / 04 §一.1）。不依赖 React、浏览器 API 或桌面壳。
 * 不变量 A：stateClass = presentation 的命令只改 SavedPresentation，
 * 不产生语义 Commit、不写 state_class = domain 的 operations。
 * Phase 1 追加反向命令（node.rename / edge.remove / task.remove / spine.* /
 * workspace.replace），供 Undo/Redo 与受控导入经同一 Command Service 重放（C6）。
 */
import {
  AssetRecordSchema,
  DomainStateSchema,
  EdgeStyleSchema,
  NodeScaleSchema,
  SavedPresentationSchema,
  ScaleSchema,
  ScaleSettingsSchema,
  StartAtSchema,
  TagsSchema,
  TaskSchema,
  type CommandEnvelope,
  type Commit,
  type DomainState,
  type LayoutDirection,
  type Node,
  type Operation,
  type SavedPresentation,
  type Task,
} from '@workspacetree/schema';
import { computeSemanticHash } from './canonical.js';
import { ValidationError } from './errors.js';
import { newCommitId } from './ids.js';
import { reparentNode, restoreNodeParent } from './reparent.js';

export interface ReducerResult {
  domain: DomainState;
  presentation: SavedPresentation;
  operations: Operation[];
  commit: Commit | null;
}

export const DOMAIN_COMMAND_TYPES = new Set([
  'project.rename',
  'node.add',
  'node.remove',
  'node.rename',
  'node.setStartAt',
  'node.setNote',
  'node.editMarkdownBlock',
  'node.setTags',
  'node.reparent',
  'node.restoreParent',
  'task.add',
  'task.remove',
  'task.complete',
  'task.edit',
  'task.setTags',
  'edge.add',
  'edge.remove',
  'edge.reconnect',
  'edge.setNote',
  'spine.add',
  'spine.remove',
  'spine.rename',
  'spine.setNodes',
  'project.archive',
  'workspace.replace',
  'asset.put',
  'asset.remove',
  'node.setNoteWithAssets',
]);

export const PRESENTATION_COMMAND_TYPES = new Set([
  'presentation.moveNode',
  'presentation.setScale',
  'presentation.setVisualScale',
  'presentation.setNodeScale',
  'presentation.setNodeVisualScale',
  'presentation.setScaleSettings',
  'presentation.setNodeSize',
  'presentation.collapse',
  'presentation.setDefaultSpine',
  'presentation.setLayoutDirection',
  'presentation.setEdgeStyle',
  'presentation.clearManualPosition',
  'presentation.clearManualPositions',
  'presentation.replace',
]);

type Payload = Record<string, unknown>;

function payloadOf(envelope: CommandEnvelope, keys: string[]): Payload {
  const raw = envelope.command.payload;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('command.payload must be an object');
  }
  const payload = raw as Payload;
  for (const key of keys) {
    if (!(key in payload)) {
      throw new ValidationError(`command.payload missing required field: ${key}`);
    }
  }
  return payload;
}

function str(payload: Payload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`command.payload.${key} must be a non-empty string`);
  }
  return value;
}

function num(payload: Payload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`command.payload.${key} must be a finite number`);
  }
  return value;
}

function bool(payload: Payload, key: string): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new ValidationError(`command.payload.${key} must be a boolean`);
  }
  return value;
}

function optionalBool(payload: Payload, key: string, fallback: boolean): boolean {
  return key in payload ? bool(payload, key) : fallback;
}

function strArray(payload: Payload, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`command.payload.${key} must be a string array`);
  }
  return value as string[];
}

function setTags(target: { tags?: string[] }, value: unknown): void {
  if (value === null) {
    delete target.tags;
    return;
  }
  const parsed = TagsSchema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError('command.payload.tags must be a tag array or null');
  target.tags = parsed.data;
}

function taskOf(payload: Payload): Task {
  const parsed = TaskSchema.safeParse(payload);
  if (!parsed.success) throw new ValidationError('invalid task fields', parsed.error.issues);
  const task = parsed.data;
  if (task.done && task.status) {
    throw new ValidationError('a completed task cannot be pending, discarded, or paused');
  }
  return task;
}

function nullableStr(payload: Payload, key: string): string | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`command.payload.${key} must be a string or null`);
  }
  return value;
}

function nullableDate(payload: Payload, key: string): string | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  const parsed = StartAtSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`command.payload.${key} must be a YYYY-MM-DD date or null`);
  }
  return parsed.data;
}

function directionOf(payload: Payload): LayoutDirection {
  const value = payload.direction ?? 'horizontal';
  if (value !== 'horizontal' && value !== 'vertical') {
    throw new ValidationError('command.payload.direction must be horizontal or vertical');
  }
  return value;
}

function scaleOf(payload: Payload, nodeScale: boolean): number {
  const value = num(payload, 'scale');
  const parsed = (nodeScale ? NodeScaleSchema : ScaleSchema).safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      nodeScale
        ? 'command.payload.scale must be between 0.35 and 2.00'
        : 'command.payload.scale must be between 0.10 and 2.00',
    );
  }
  return parsed.data;
}

function cloneDomain(domain: DomainState): DomainState {
  return {
    project: { ...domain.project },
    nodes: domain.nodes.map((node) => ({
      ...node,
      blockIds: [...node.blockIds],
      ...(node.tags === undefined ? {} : { tags: [...node.tags] }),
    })),
    edges: domain.edges.map((edge) => ({ ...edge })),
    tasks: domain.tasks.map((task) => ({
      ...task,
      ...(task.tags === undefined ? {} : { tags: [...task.tags] }),
    })),
    spines: domain.spines.map((spine) => ({ ...spine, nodeIds: [...spine.nodeIds] })),
    blocks: domain.blocks.map((block) => ({ ...block })),
    projectRefs: domain.projectRefs.map((ref) => ({ ...ref })),
    ...(domain.assets === undefined ? {} : { assets: { ...domain.assets } }),
    archived: domain.archived,
    archiveMeta: domain.archiveMeta ? { ...domain.archiveMeta } : null,
  };
}

function clonePresentation(presentation: SavedPresentation): SavedPresentation {
  const cloneRecords = <T extends object>(records: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(records).map(([key, value]) => [key, { ...value }]));
  return {
    nodePositions: cloneRecords(presentation.nodePositions),
    verticalNodePositions: cloneRecords(presentation.verticalNodePositions ?? {}),
    branchScales: { ...presentation.branchScales },
    ...(presentation.branchVisualScales === undefined
      ? {}
      : { branchVisualScales: { ...presentation.branchVisualScales } }),
    ...(presentation.branchScaleCompensation === undefined
      ? {}
      : { branchScaleCompensation: { ...presentation.branchScaleCompensation } }),
    nodeScales: { ...presentation.nodeScales },
    ...(presentation.nodeVisualScales === undefined
      ? {}
      : { nodeVisualScales: { ...presentation.nodeVisualScales } }),
    ...(presentation.nodeSizes === undefined
      ? {}
      : { nodeSizes: presentation.nodeSizes && cloneRecords(presentation.nodeSizes) }),
    ...(presentation.edgeStyles === undefined
      ? {}
      : { edgeStyles: cloneRecords(presentation.edgeStyles) }),
    ...(presentation.scaleSettings === undefined
      ? {}
      : { scaleSettings: { ...presentation.scaleSettings } }),
    collapsedByDefault: [...presentation.collapsedByDefault],
    savedSpineDisplay: presentation.savedSpineDisplay,
    ...(presentation.layoutDirection === undefined
      ? {}
      : { layoutDirection: presentation.layoutDirection }),
  };
}

function removePresentationNode(presentation: SavedPresentation, id: string): void {
  delete presentation.nodePositions[id];
  if (presentation.verticalNodePositions) delete presentation.verticalNodePositions[id];
  delete presentation.branchScales[id];
  if (presentation.branchVisualScales) delete presentation.branchVisualScales[id];
  if (presentation.branchScaleCompensation) {
    delete presentation.branchScaleCompensation[id];
    if (Object.keys(presentation.branchScaleCompensation).length === 0) {
      delete presentation.branchScaleCompensation;
    }
  }
  if (presentation.nodeScales) delete presentation.nodeScales[id];
  if (presentation.nodeVisualScales) delete presentation.nodeVisualScales[id];
  if (presentation.nodeSizes) delete presentation.nodeSizes[id];
  presentation.collapsedByDefault = presentation.collapsedByDefault.filter(
    (nodeId) => nodeId !== id,
  );
}

/** 删除节点时级联清理引用，保证 validateDomain 在图操作后仍成立（契约 2 / 7）。 */
function removeNodeCascade(domain: DomainState, id: string): void {
  domain.nodes = domain.nodes.filter((node) => node.id !== id);
  domain.edges = domain.edges.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id);
  domain.tasks = domain.tasks.filter((task) => task.nodeId !== id);
  domain.spines = domain.spines.map((spine) => ({
    ...spine,
    nodeIds: spine.nodeIds.filter((nodeId) => nodeId !== id),
  }));
  for (const node of domain.nodes) {
    if (node.parentId === id) node.parentId = null;
  }
}

export function applyCommand(
  domain: DomainState,
  presentation: SavedPresentation,
  envelope: CommandEnvelope,
): ReducerResult {
  const type = envelope.command.type;
  const isDomain = DOMAIN_COMMAND_TYPES.has(type);
  const isPresentation = PRESENTATION_COMMAND_TYPES.has(type);
  if (!isDomain && !isPresentation) {
    throw new ValidationError(`unsupported command type: ${type}`);
  }
  if (isDomain && envelope.stateClass !== 'domain') {
    throw new ValidationError(`${type} requires stateClass = domain`);
  }
  if (isPresentation && envelope.stateClass !== 'presentation') {
    throw new ValidationError(`${type} requires stateClass = presentation`);
  }

  const nextDomain = cloneDomain(domain);
  const nextPresentation = clonePresentation(presentation);

  switch (type) {
    case 'node.add': {
      const payload = payloadOf(envelope, ['id', 'title']);
      const node: Node = {
        id: str(payload, 'id'),
        title: str(payload, 'title'),
        parentId: 'parentId' in payload ? nullableStr(payload, 'parentId') : null,
        blockIds: 'blockIds' in payload ? strArray(payload, 'blockIds') : [],
        archived: optionalBool(payload, 'archived', false),
        startAt: 'startAt' in payload ? nullableDate(payload, 'startAt') : null,
      };
      if ('tags' in payload) setTags(node, payload.tags);
      nextDomain.nodes.push(node);
      break;
    }
    case 'node.remove': {
      const payload = payloadOf(envelope, ['id']);
      const id = str(payload, 'id');
      removeNodeCascade(nextDomain, id);
      removePresentationNode(nextPresentation, id);
      break;
    }
    case 'node.rename': {
      const payload = payloadOf(envelope, ['id', 'title']);
      const id = str(payload, 'id');
      const node = nextDomain.nodes.find((item) => item.id === id);
      if (!node) throw new ValidationError(`unknown node id: ${id}`);
      node.title = str(payload, 'title');
      break;
    }
    case 'node.reparent': {
      const payload = payloadOf(envelope, ['id', 'parentId']);
      const id = str(payload, 'id');
      const parentId = nullableStr(payload, 'parentId');
      Object.assign(
        nextDomain,
        reparentNode(nextDomain, id, parentId, nullableStr(payload, 'edgeId')),
      );
      break;
    }
    case 'node.restoreParent': {
      const payload = payloadOf(envelope, ['id', 'parentId', 'edge', 'edgeIndex', 'spines']);
      if (!Array.isArray(payload.spines)) throw new ValidationError('Expected previous spines');
      restoreNodeParent(
        nextDomain,
        str(payload, 'id'),
        nullableStr(payload, 'parentId'),
        payload.edge,
        num(payload, 'edgeIndex'),
        payload.spines,
      );
      break;
    }
    case 'node.setStartAt': {
      const payload = payloadOf(envelope, ['id', 'startAt']);
      const id = str(payload, 'id');
      const node = nextDomain.nodes.find((item) => item.id === id);
      if (!node) throw new ValidationError(`unknown node id: ${id}`);
      node.startAt = nullableDate(payload, 'startAt');
      break;
    }
    case 'node.setNote':
    case 'node.setNoteWithAssets': {
      const payload = payloadOf(envelope, ['id', 'markdown']);
      const id = str(payload, 'id');
      const node = nextDomain.nodes.find((item) => item.id === id);
      if (!node) throw new ValidationError(`unknown node id: ${id}`);
      const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
      const blockId = `blk_note_${id}`;
      if (markdown.length === 0) {
        node.blockIds = node.blockIds.filter((item) => item !== blockId);
        nextDomain.blocks = nextDomain.blocks.filter((item) => item.id !== blockId);
      } else {
        const existing = nextDomain.blocks.find((item) => item.id === blockId);
        if (existing) {
          existing.kind = 'text';
          existing.payload = { markdown };
        } else {
          nextDomain.blocks.push({ id: blockId, kind: 'text', payload: { markdown } });
        }
        if (!node.blockIds.includes(blockId)) {
          node.blockIds.push(blockId);
        }
      }
      if (payload.assets && typeof payload.assets === 'object' && !Array.isArray(payload.assets)) {
        nextDomain.assets = nextDomain.assets ?? {};
        for (const [assetId, record] of Object.entries(payload.assets)) {
          const parsed = AssetRecordSchema.safeParse(record);
          if (!parsed.success) {
            throw new ValidationError(`invalid asset record: ${assetId}`, parsed.error.issues);
          }
          nextDomain.assets[assetId] = parsed.data;
        }
      }
      break;
    }
    case 'asset.put': {
      const payload = payloadOf(envelope, ['id', 'asset']);
      const id = str(payload, 'id');
      const parsed = AssetRecordSchema.safeParse(payload.asset);
      if (!parsed.success) {
        throw new ValidationError(`invalid asset record: ${id}`, parsed.error.issues);
      }
      nextDomain.assets = nextDomain.assets ?? {};
      nextDomain.assets[id] = parsed.data;
      break;
    }
    case 'asset.remove': {
      const payload = payloadOf(envelope, ['id']);
      const id = str(payload, 'id');
      if (nextDomain.assets && id in nextDomain.assets) {
        delete nextDomain.assets[id];
      }
      break;
    }
    case 'node.editMarkdownBlock': {
      const payload = payloadOf(envelope, ['id', 'blockId', 'markdown']);
      const id = str(payload, 'id');
      const blockId = str(payload, 'blockId');
      const node = nextDomain.nodes.find((item) => item.id === id);
      const block = nextDomain.blocks.find((item) => item.id === blockId);
      if (
        !node?.blockIds.includes(blockId) ||
        !block ||
        !['text', 'checklist'].includes(block.kind)
      ) {
        throw new ValidationError('unknown node Markdown block: ' + blockId);
      }
      if (
        typeof payload.markdown !== 'string' ||
        typeof block.payload !== 'object' ||
        block.payload === null ||
        !('markdown' in block.payload)
      ) {
        throw new ValidationError('invalid Markdown block: ' + blockId);
      }
      block.payload = { ...block.payload, markdown: payload.markdown };
      if (payload.assets && typeof payload.assets === 'object' && !Array.isArray(payload.assets)) {
        nextDomain.assets = nextDomain.assets ?? {};
        for (const [assetId, record] of Object.entries(payload.assets)) {
          const parsed = AssetRecordSchema.safeParse(record);
          if (!parsed.success) {
            throw new ValidationError(`invalid asset record: ${assetId}`, parsed.error.issues);
          }
          nextDomain.assets[assetId] = parsed.data;
        }
      }
      break;
    }
    case 'node.setTags':
    case 'task.setTags': {
      const payload = payloadOf(envelope, ['id', 'tags']);
      const id = str(payload, 'id');
      const kind = type === 'node.setTags' ? 'node' : 'task';
      const entities = kind === 'node' ? nextDomain.nodes : nextDomain.tasks;
      const entity = entities.find((item) => item.id === id);
      if (!entity) throw new ValidationError('unknown ' + kind + ' id: ' + id);
      setTags(entity, payload.tags);
      break;
    }
    case 'task.add': {
      const payload = payloadOf(envelope, ['id', 'nodeId', 'title']);
      const index = 'index' in payload ? payload.index : nextDomain.tasks.length;
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index > nextDomain.tasks.length
      ) {
        throw new ValidationError('Invalid task insertion index');
      }
      const task = taskOf({
        ...payload,
        ...(payload.tags === null ? { tags: undefined } : {}),
        done: optionalBool(payload, 'done', false),
      });
      nextDomain.tasks.splice(index, 0, task);
      break;
    }
    case 'task.edit': {
      const payload = payloadOf(envelope, ['id', 'nodeId', 'title', 'done']);
      const task = taskOf(payload);
      const index = nextDomain.tasks.findIndex((item) => item.id === task.id);
      if (index < 0) throw new ValidationError('unknown task id: ' + task.id);
      nextDomain.tasks[index] = task;
      break;
    }
    case 'task.remove': {
      const payload = payloadOf(envelope, ['id']);
      const id = str(payload, 'id');
      nextDomain.tasks = nextDomain.tasks.filter((task) => task.id !== id);
      break;
    }
    case 'task.complete': {
      const payload = payloadOf(envelope, ['id', 'done']);
      const task = nextDomain.tasks.find((item) => item.id === payload.id);
      if (!task) throw new ValidationError(`unknown task id: ${String(payload.id)}`);
      task.done = bool(payload, 'done');
      if (task.done) delete task.status;
      else delete task.completedAt;
      break;
    }
    case 'edge.add': {
      const payload = payloadOf(envelope, ['id', 'type', 'fromNodeId', 'toNodeId']);
      const edgeType = str(payload, 'type');
      if (!['hierarchy', 'dependency', 'reference', 'custom'].includes(edgeType)) {
        throw new ValidationError(`unknown edge type: ${edgeType}`);
      }
      const edge: DomainState['edges'][number] = {
        id: str(payload, 'id'),
        type: edgeType as DomainState['edges'][number]['type'],
        fromNodeId: str(payload, 'fromNodeId'),
        toNodeId: str(payload, 'toNodeId'),
      };
      if ('role' in payload && payload.role !== undefined && payload.role !== null) {
        if (edge.type !== 'hierarchy') {
          throw new ValidationError('Only hierarchy edges can have a role');
        }
        const role = str(payload, 'role');
        if (!['continuation', 'leaf', 'branch'].includes(role)) {
          throw new ValidationError(`unknown edge role: ${role}`);
        }
        if (role === 'continuation') {
          const hasContinuation = nextDomain.edges.some(
            (item) =>
              item.type === 'hierarchy' &&
              item.fromNodeId === edge.fromNodeId &&
              item.role === 'continuation',
          );
          if (hasContinuation) {
            throw new ValidationError(
              `parent node ${edge.fromNodeId} already has a continuation child`,
            );
          }
        }
        edge.role = role as DomainState['edges'][number]['role'];
      }
      const note = nullableStr(payload, 'note');
      if (note !== null) {
        if (/[\r\n]/.test(note)) throw new ValidationError('Edge note must be a single line');
        edge.note = note;
      }
      const index = 'index' in payload ? payload.index : nextDomain.edges.length;
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index > nextDomain.edges.length
      ) {
        throw new ValidationError('Invalid edge insertion index');
      }
      nextDomain.edges.splice(index, 0, edge);
      break;
    }
    case 'edge.setNote': {
      const payload = payloadOf(envelope, ['id', 'note']);
      const edge = nextDomain.edges.find((item) => item.id === str(payload, 'id'));
      if (!edge) throw new ValidationError('Unknown edge');
      const note = nullableStr(payload, 'note');
      if (note && /[\r\n]/.test(note)) throw new ValidationError('Edge note must be a single line');
      if (note === null) delete edge.note;
      else edge.note = note;
      break;
    }
    case 'edge.reconnect': {
      const payload = payloadOf(envelope, ['id', 'fromNodeId', 'toNodeId']);
      const id = str(payload, 'id');
      const edge = nextDomain.edges.find((item) => item.id === id);
      if (!edge || edge.type === 'hierarchy') {
        throw new ValidationError('Reconnect requires an existing non-hierarchy edge');
      }
      const fromNodeId = str(payload, 'fromNodeId');
      const toNodeId = str(payload, 'toNodeId');
      if (fromNodeId === toNodeId)
        throw new ValidationError('Cannot connect a node to the same node');
      if (
        nextDomain.edges.some(
          (item) =>
            item.id !== id &&
            item.type === edge.type &&
            item.fromNodeId === fromNodeId &&
            item.toNodeId === toNodeId,
        )
      ) {
        throw new ValidationError('This connection already exists');
      }
      edge.fromNodeId = fromNodeId;
      edge.toNodeId = toNodeId;
      break;
    }
    case 'edge.remove': {
      const payload = payloadOf(envelope, ['id']);
      const id = str(payload, 'id');
      nextDomain.edges = nextDomain.edges.filter((edge) => edge.id !== id);
      break;
    }
    case 'spine.add': {
      const payload = payloadOf(envelope, ['id', 'title', 'nodeIds']);
      nextDomain.spines.push({
        id: str(payload, 'id'),
        title: str(payload, 'title'),
        nodeIds: strArray(payload, 'nodeIds'),
      });
      break;
    }
    case 'spine.remove': {
      const payload = payloadOf(envelope, ['id']);
      const id = str(payload, 'id');
      nextDomain.spines = nextDomain.spines.filter((spine) => spine.id !== id);
      break;
    }
    case 'spine.rename': {
      const payload = payloadOf(envelope, ['id', 'title']);
      const id = str(payload, 'id');
      const title = str(payload, 'title').trim();
      if (!title) throw new ValidationError('Spine title cannot be empty');
      const spine = nextDomain.spines.find((item) => item.id === id);
      if (!spine) throw new ValidationError(`unknown spine id: ${id}`);
      spine.title = title;
      break;
    }
    case 'spine.setNodes': {
      const payload = payloadOf(envelope, ['id', 'nodeIds']);
      const id = str(payload, 'id');
      const spine = nextDomain.spines.find((item) => item.id === id);
      if (!spine) throw new ValidationError(`unknown spine id: ${id}`);
      spine.nodeIds = strArray(payload, 'nodeIds');
      break;
    }
    case 'project.rename': {
      const payload = payloadOf(envelope, ['title']);
      const title = str(payload, 'title').trim();
      if (!title) throw new ValidationError('Project title cannot be empty');
      nextDomain.project.title = title;
      break;
    }
    case 'project.archive': {
      const payload = payloadOf(envelope, ['reason', 'at']);
      nextDomain.archived = true;
      nextDomain.archiveMeta = {
        reason: str(payload, 'reason'),
        at: str(payload, 'at'),
        replacementBranchId: nullableStr(payload, 'replacementBranchId'),
      };
      break;
    }
    case 'workspace.replace': {
      const payload = payloadOf(envelope, ['domain']);
      if (
        'expectedSemanticHash' in payload &&
        str(payload, 'expectedSemanticHash') !== computeSemanticHash(nextDomain)
      ) {
        throw new ValidationError(
          'Workspace content changed before this operation. Retry with the latest version.',
        );
      }
      const parsed = DomainStateSchema.safeParse(payload.domain);
      if (!parsed.success) {
        throw new ValidationError('command.payload.domain is not a well-formed DomainState');
      }
      Object.assign(nextDomain, cloneDomain(parsed.data));
      break;
    }
    case 'presentation.moveNode': {
      const payload = payloadOf(envelope, ['nodeId', 'x', 'y']);
      const positions =
        directionOf(payload) === 'vertical'
          ? nextPresentation.verticalNodePositions!
          : nextPresentation.nodePositions;
      positions[str(payload, 'nodeId')] = {
        x: num(payload, 'x'),
        y: num(payload, 'y'),
      };
      break;
    }
    case 'presentation.setScale': {
      const payload = payloadOf(envelope, ['nodeId', 'scale']);
      nextPresentation.branchScales[str(payload, 'nodeId')] = scaleOf(payload, false);
      break;
    }
    case 'presentation.setVisualScale': {
      const payload = payloadOf(envelope, ['nodeId', 'scale']);
      if (!nextPresentation.branchVisualScales) nextPresentation.branchVisualScales = {};
      nextPresentation.branchVisualScales[str(payload, 'nodeId')] = scaleOf(payload, false);
      break;
    }
    case 'presentation.setNodeScale': {
      const payload = payloadOf(envelope, ['nodeId', 'scale']);
      if (!nextPresentation.nodeScales) nextPresentation.nodeScales = {};
      nextPresentation.nodeScales[str(payload, 'nodeId')] = scaleOf(payload, true);
      break;
    }
    case 'presentation.setNodeVisualScale': {
      const payload = payloadOf(envelope, ['nodeId', 'scale']);
      if (!nextPresentation.nodeVisualScales) nextPresentation.nodeVisualScales = {};
      nextPresentation.nodeVisualScales[str(payload, 'nodeId')] = scaleOf(payload, true);
      break;
    }
    case 'presentation.setScaleSettings': {
      const payload = payloadOf(envelope, ['settings']);
      const parsed = ScaleSettingsSchema.safeParse(payload.settings);
      if (!parsed.success) {
        throw new ValidationError('command.payload.settings is invalid scale settings');
      }
      nextPresentation.scaleSettings = parsed.data;
      break;
    }
    case 'presentation.setNodeSize': {
      const payload = payloadOf(envelope, ['nodeId', 'size']);
      const nodeId = str(payload, 'nodeId');
      if (!nextPresentation.nodeSizes) nextPresentation.nodeSizes = {};
      if (payload.size === null || payload.size === undefined) {
        delete nextPresentation.nodeSizes[nodeId];
      } else {
        const raw = payload.size as { width?: unknown; height?: unknown };
        if (
          typeof raw !== 'object' ||
          typeof raw.width !== 'number' ||
          typeof raw.height !== 'number' ||
          raw.width <= 0 ||
          raw.height <= 0
        ) {
          throw new ValidationError('command.payload.size must have positive width and height');
        }
        nextPresentation.nodeSizes[nodeId] = { width: raw.width, height: raw.height };
      }
      break;
    }
    case 'presentation.collapse': {
      const payload = payloadOf(envelope, ['nodeId', 'collapsed']);
      const nodeId = str(payload, 'nodeId');
      const collapsed = bool(payload, 'collapsed');
      const set = new Set(nextPresentation.collapsedByDefault);
      if (collapsed) set.add(nodeId);
      else set.delete(nodeId);
      nextPresentation.collapsedByDefault = [...set].sort();
      break;
    }
    case 'presentation.setDefaultSpine': {
      const payload = payloadOf(envelope, ['spineId']);
      nextPresentation.savedSpineDisplay = str(payload, 'spineId');
      break;
    }
    case 'presentation.setLayoutDirection': {
      const payload = payloadOf(envelope, ['direction']);
      nextPresentation.layoutDirection = directionOf(payload);
      break;
    }
    case 'presentation.setEdgeStyle': {
      const payload = payloadOf(envelope, ['edgeId', 'style']);
      const edgeId = str(payload, 'edgeId');
      if (payload.style === null || payload.style === undefined) {
        if (nextPresentation.edgeStyles) delete nextPresentation.edgeStyles[edgeId];
        break;
      }
      const parsed = EdgeStyleSchema.safeParse(payload.style);
      if (!parsed.success) {
        throw new ValidationError('command.payload.style is not a well-formed EdgeStyle');
      }
      if (Object.keys(parsed.data).length === 0) {
        if (nextPresentation.edgeStyles) delete nextPresentation.edgeStyles[edgeId];
        break;
      }
      nextPresentation.edgeStyles ??= {};
      nextPresentation.edgeStyles[edgeId] = parsed.data;
      break;
    }
    case 'presentation.clearManualPosition': {
      const payload = payloadOf(envelope, ['nodeId']);
      const nodeId = str(payload, 'nodeId');
      if (directionOf(payload) === 'vertical') {
        delete nextPresentation.verticalNodePositions![nodeId];
      } else {
        delete nextPresentation.nodePositions[nodeId];
      }
      break;
    }
    case 'presentation.clearManualPositions': {
      const payload = payloadOf(envelope, []);
      if (!('direction' in payload)) {
        nextPresentation.nodePositions = {};
        nextPresentation.verticalNodePositions = {};
      } else if (directionOf(payload) === 'vertical') {
        nextPresentation.verticalNodePositions = {};
      } else {
        nextPresentation.nodePositions = {};
      }
      break;
    }
    case 'presentation.replace': {
      const payload = payloadOf(envelope, ['presentation']);
      const parsed = SavedPresentationSchema.safeParse(payload.presentation);
      if (!parsed.success) {
        throw new ValidationError(
          'command.payload.presentation is not a well-formed SavedPresentation',
        );
      }
      delete nextPresentation.nodeSizes;
      delete nextPresentation.branchScaleCompensation;
      delete nextPresentation.layoutDirection;
      delete nextPresentation.edgeStyles;
      Object.assign(nextPresentation, clonePresentation(parsed.data));
      break;
    }
    default:
      throw new ValidationError(`unhandled command type: ${type}`);
  }

  const operation: Operation = {
    operationId: envelope.operationId,
    type,
    stateClass: envelope.stateClass,
    payload: envelope.command.payload,
    actor: envelope.actor,
    audit: envelope.audit ?? null,
  };

  const commit: Commit | null = isDomain
    ? {
        id: newCommitId(),
        parentId: null,
        operationIds: [envelope.operationId],
        semanticRevision: 0,
        semanticHash: computeSemanticHash(nextDomain),
      }
    : null;

  return {
    domain: nextDomain,
    presentation: nextPresentation,
    operations: [operation],
    commit,
  };
}

/**
 * 批量 ChangeSet 的纯函数应用（06 §二 Phase 0 验收 16）。
 * 一次校验、一次应用：任一命令失败即抛错，调用方因此不会落盘，实现「失败整批回滚」。
 * 子 Operation 的 operationId 带序号后缀，保持幂等可追溯。
 * 不变量 A 不变：presentation 批次不产生 Commit、不写 domain operations。
 */
export function applyChangeSet(
  domain: DomainState,
  presentation: SavedPresentation,
  envelopes: CommandEnvelope[],
): ReducerResult {
  if (envelopes.length === 0) {
    throw new ValidationError('changeSet.commands must not be empty');
  }
  let currentDomain = domain;
  let currentPresentation = presentation;
  const operations: Operation[] = [];
  let commit: Commit | null = null;

  for (const [index, envelope] of envelopes.entries()) {
    const scoped: CommandEnvelope = {
      ...envelope,
      operationId: `${envelope.operationId}#${index + 1}`,
    };
    const result = applyCommand(currentDomain, currentPresentation, scoped);
    currentDomain = result.domain;
    currentPresentation = result.presentation;
    operations.push(...result.operations);
    if (result.commit) {
      commit = {
        ...result.commit,
        parentId: commit ? commit.id : null,
        operationIds: commit
          ? [...commit.operationIds, ...result.commit.operationIds]
          : result.commit.operationIds,
      };
    }
  }

  return { domain: currentDomain, presentation: currentPresentation, operations, commit };
}
