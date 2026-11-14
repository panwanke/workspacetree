/**
 * Undo/Redo 反向命令栈（06 §二 Phase 1 任务 1、验收 5 / 8）。
 *
 * 关键约束：不做状态快照、不绕过写入口。每个用户动作都产出一对
 * `forward` / `inverse` 命令，二者经同一个 CommandService.executeBatch 落盘（C6）。
 * 因此拖动只产生 presentation 批次、零语义 Commit；Undo 本身也是一次正常命令写入。
 *
 * 本模块为纯逻辑，不 import React / DOM，可在 Node 下独立测试。
 */
import {
  DEFAULT_LAYOUT_OPTIONS,
  LOD_MIN_HEIGHT,
  LOD_MIN_WIDTH,
  resolveLayoutDirection,
} from '@workspacetree/layout';
import type {
  ActorKind,
  AssetRecord,
  BranchFile,
  Command,
  DomainState,
  Edge,
  HierarchyEdgeRole,
  LayoutDirection,
  Node,
  SavedPresentation,
  StateClass,
  Task,
} from '@workspacetree/schema';

export interface Point {
  x: number;
  y: number;
}

export interface HistoryEntry {
  label: string;
  stateClass: StateClass;
  actorKind: ActorKind;
  forward: Command[];
  inverse: Command[];
  /** The next batch for a gesture spanning domain and presentation state. */
  chained?: HistoryEntry;
  /** Save the domain entry and its presentation entry in one write. */
  atomic?: boolean;
}

function cmd(type: string, payload: Record<string, unknown>): Command {
  return { type, payload };
}

function entry(
  label: string,
  stateClass: StateClass,
  forward: Command[],
  inverse: Command[],
  actorKind: ActorKind = 'human',
): HistoryEntry {
  return { label, stateClass, actorKind, forward, inverse };
}

function findNode(domain: DomainState, id: string): Node {
  const node = domain.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`unknown node: ${id}`);
  return node;
}

function edgeAddCommand(edge: Edge, index?: number): Command {
  return cmd('edge.add', { ...edge, ...(index === undefined ? {} : { index }) });
}

function taskAddCommand(task: Task): Command {
  return cmd('task.add', task);
}

export function createNodeEntry(
  id: string,
  title: string,
  parentId: string | null,
  edgeId: string,
  roleOrPresentation?: HierarchyEdgeRole | SavedPresentation,
  presentationOrPosition?: SavedPresentation | Point,
  initialPositionOrDirection?: Point | LayoutDirection,
  direction?: LayoutDirection,
): HistoryEntry {
  let role: HierarchyEdgeRole | undefined;
  let presentation: SavedPresentation | undefined;
  let initialPosition: Point | undefined;
  let resolvedDirection: LayoutDirection | undefined = direction;

  if (typeof roleOrPresentation === 'string') {
    role = roleOrPresentation as HierarchyEdgeRole;
    if (
      typeof presentationOrPosition === 'object' &&
      presentationOrPosition !== null &&
      !('x' in presentationOrPosition)
    ) {
      presentation = presentationOrPosition as SavedPresentation;
    }
    if (
      typeof initialPositionOrDirection === 'object' &&
      initialPositionOrDirection !== null &&
      'x' in initialPositionOrDirection
    ) {
      initialPosition = initialPositionOrDirection as Point;
    }
  } else if (typeof roleOrPresentation === 'object' && roleOrPresentation !== null) {
    presentation = roleOrPresentation as SavedPresentation;
    if (
      typeof presentationOrPosition === 'object' &&
      presentationOrPosition !== null &&
      'x' in presentationOrPosition
    ) {
      initialPosition = presentationOrPosition as Point;
    }
    if (typeof initialPositionOrDirection === 'string') {
      resolvedDirection = initialPositionOrDirection as LayoutDirection;
    }
  }

  const forward = [cmd('node.add', { id, title, parentId })];
  if (parentId !== null) {
    forward.push(
      cmd('edge.add', {
        id: edgeId,
        type: 'hierarchy',
        fromNodeId: parentId,
        toNodeId: id,
        ...(role ? { role } : {}),
      }),
    );
  }
  const label = parentId === null ? '创建独立分支' : role === 'branch' ? '新建分支' : '新建节点';
  const creation = entry(label, 'domain', forward, [cmd('node.remove', { id })]);

  const presentationCmds: Command[] = [];
  if (initialPosition) {
    presentationCmds.push(
      cmd('presentation.moveNode', {
        nodeId: id,
        x: initialPosition.x,
        y: initialPosition.y,
        direction: resolvedDirection ?? 'horizontal',
      }),
    );
  }
  if (parentId !== null) {
    if (presentation) {
      const scale = presentation.nodeScales?.[parentId];
      if (scale !== undefined && scale !== 1) {
        presentationCmds.push(cmd('presentation.setNodeScale', { nodeId: id, scale }));
      }
    }
    const parentBaseWidth =
      presentation?.nodeSizes?.[parentId]?.width ?? DEFAULT_LAYOUT_OPTIONS.nodeWidth;
    const parentBaseHeight =
      presentation?.nodeSizes?.[parentId]?.height ?? DEFAULT_LAYOUT_OPTIONS.nodeHeight;
    const defaultWidth = Math.max(LOD_MIN_WIDTH, Math.round(parentBaseWidth * 0.85));
    const defaultHeight = Math.max(LOD_MIN_HEIGHT, Math.round(parentBaseHeight * 0.85));
    presentationCmds.push(
      cmd('presentation.setNodeSize', {
        nodeId: id,
        size: { width: defaultWidth, height: defaultHeight },
      }),
    );
  }
  if (presentationCmds.length > 0) {
    creation.chained = entry('初始化节点位置与样式', 'presentation', presentationCmds, []);
    creation.atomic = true;
  }
  return creation;
}

/** 删除整棵子树：捕获被删节点、全部关联边、任务与 Spine 成员，Undo 可完整还原拓扑。 */
export function deleteSubtreeEntry(domain: DomainState, rootId: string): HistoryEntry {
  const children = new Map<string, string[]>();
  for (const edge of domain.edges) {
    if (edge.type !== 'hierarchy') continue;
    const list = children.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    children.set(edge.fromNodeId, list);
  }
  const removed = new Set<string>();
  const collect = (id: string): void => {
    if (removed.has(id)) return;
    removed.add(id);
    for (const child of children.get(id) ?? []) collect(child);
  };
  collect(rootId);

  const removedNodes = domain.nodes.filter((node) => removed.has(node.id));
  const removedEdges = domain.edges.filter(
    (edge) => removed.has(edge.fromNodeId) || removed.has(edge.toNodeId),
  );
  const removedTasks = domain.tasks.filter(
    (task) => task.nodeId !== null && removed.has(task.nodeId),
  );

  const forward: Command[] = [];
  for (const edge of removedEdges) forward.push(cmd('edge.remove', { id: edge.id }));
  for (const task of removedTasks) forward.push(cmd('task.remove', { id: task.id }));
  // 叶子先删、根最后删；node.remove 还会级联清理残留引用。
  for (const node of [...removedNodes].reverse()) forward.push(cmd('node.remove', { id: node.id }));

  // 数组顺序参与 semanticHash；逐条重放会把还原节点追加到数组末尾，导致哈希漂移。
  // 因此删除子树的反向命令用一次整域替换，保证 Undo 后语义哈希与拓扑逐字节一致。
  const before: DomainState = structuredClone(domain);
  return entry('删除子树', 'domain', forward, [cmd('workspace.replace', { domain: before })]);
}

export function renameNodeEntry(domain: DomainState, id: string, title: string): HistoryEntry {
  const before = findNode(domain, id).title;
  return entry(
    '重命名节点',
    'domain',
    [cmd('node.rename', { id, title })],
    [cmd('node.rename', { id, title: before })],
  );
}

export function setNodeTagsEntry(domain: DomainState, id: string, tags: string[]): HistoryEntry {
  const before = findNode(domain, id).tags;
  return entry(
    '编辑节点标签',
    'domain',
    [cmd('node.setTags', { id, tags: tags.length ? [...new Set(tags)] : null })],
    [cmd('node.setTags', { id, tags: before ?? null })],
  );
}

export function setStartAtEntry(
  domain: DomainState,
  id: string,
  startAt: string | null,
): HistoryEntry {
  const before = findNode(domain, id).startAt ?? null;
  return entry(
    '设置日期',
    'domain',
    [cmd('node.setStartAt', { id, startAt })],
    [cmd('node.setStartAt', { id, startAt: before })],
  );
}

export function getNodeNoteBlock(domain: DomainState, id: string) {
  const blockId = `blk_note_${id}`;
  const block = domain.blocks.find((item) => item.id === blockId);
  if (!block || typeof block.payload !== 'object' || block.payload === null) return undefined;
  const markdown = (block.payload as { markdown?: unknown }).markdown;
  return typeof markdown === 'string' ? { id: blockId, markdown } : undefined;
}

export function getNodeNote(domain: DomainState, id: string): string {
  return getNodeNoteBlock(domain, id)?.markdown ?? '';
}

export function setNodeNoteEntry(
  domain: DomainState,
  id: string,
  markdown: string,
  newAssets?: Record<string, AssetRecord>,
): HistoryEntry {
  const before = getNodeNote(domain, id);
  const forwardCmd = newAssets
    ? cmd('node.setNoteWithAssets', { id, markdown, assets: newAssets })
    : cmd('node.setNote', { id, markdown });

  const inverseCmds: Command[] = [cmd('node.setNote', { id, markdown: before })];
  if (newAssets) {
    for (const assetId of Object.keys(newAssets)) {
      if (!domain.assets || !(assetId in domain.assets)) {
        inverseCmds.push(cmd('asset.remove', { id: assetId }));
      }
    }
  }

  return entry('编辑 Markdown 笔记', 'domain', [forwardCmd], inverseCmds);
}

export function addEdgeEntry(edge: Edge): HistoryEntry {
  return entry('新增连线', 'domain', [edgeAddCommand(edge)], [cmd('edge.remove', { id: edge.id })]);
}

export function removeEdgeEntry(domain: DomainState, edgeId: string): HistoryEntry {
  const index = domain.edges.findIndex((item) => item.id === edgeId);
  const edge = domain.edges[index];
  if (!edge) throw new Error(`unknown edge: ${edgeId}`);
  return entry(
    '删除连线',
    'domain',
    [cmd('edge.remove', { id: edgeId })],
    [edgeAddCommand(edge, index)],
  );
}

export function toggleTaskEntry(domain: DomainState, taskId: string): HistoryEntry {
  const task = domain.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  if (task.status) {
    const { status: _status, ...completed } = task;
    return editTaskEntry(task, { ...completed, done: true });
  }
  const next = !task.done;
  return entry(
    '切换任务',
    'domain',
    [cmd('task.complete', { id: taskId, done: next })],
    [cmd('task.complete', { id: taskId, done: task.done })],
  );
}

export function addTaskEntry(task: Task): HistoryEntry {
  return entry('新增任务', 'domain', [taskAddCommand(task)], [cmd('task.remove', { id: task.id })]);
}

export function editTaskEntry(before: Task, after: Task): HistoryEntry {
  return entry('编辑 TODO', 'domain', [cmd('task.edit', after)], [cmd('task.edit', before)]);
}

export function setTaskTagsEntry(domain: DomainState, id: string, tags: string[]): HistoryEntry {
  const task = domain.tasks.find((item) => item.id === id);
  if (!task) throw new Error('unknown task: ' + id);
  return entry(
    '编辑 TODO 标签',
    'domain',
    [cmd('task.setTags', { id, tags: tags.length ? [...new Set(tags)] : null })],
    [cmd('task.setTags', { id, tags: task.tags ?? null })],
  );
}

export function createSpineEntry(id: string, title: string, nodeIds: string[]): HistoryEntry {
  return entry(
    '创建主干',
    'domain',
    [cmd('spine.add', { id, title, nodeIds })],
    [cmd('spine.remove', { id })],
  );
}

export function removeSpineEntry(domain: DomainState, spineId: string): HistoryEntry {
  const spine = domain.spines.find((item) => item.id === spineId);
  if (!spine) throw new Error(`unknown spine: ${spineId}`);
  return entry(
    '删除主干',
    'domain',
    [cmd('spine.remove', { id: spineId })],
    [cmd('spine.add', { id: spine.id, title: spine.title, nodeIds: spine.nodeIds })],
  );
}

function moveCommand(nodeId: string, at: Point, direction: LayoutDirection): Command {
  return cmd('presentation.moveNode', { nodeId, x: at.x, y: at.y, direction });
}

function positionsFor(file: BranchFile, direction: LayoutDirection) {
  return direction === 'vertical'
    ? (file.presentation.verticalNodePositions ?? {})
    : file.presentation.nodePositions;
}

/** 拖动合批：帧级 move 只累积，finish 才生成唯一一个 presentation 批次。 */
export function moveEntry(
  moves: readonly { nodeId: string; from: Point; to: Point }[],
  direction: LayoutDirection = 'horizontal',
): HistoryEntry {
  const forward: Command[] = [];
  const inverse: Command[] = [];
  for (const move of moves) {
    forward.push(moveCommand(move.nodeId, move.to, direction));
    inverse.push(moveCommand(move.nodeId, move.from, direction));
  }
  return entry(
    direction === 'vertical' ? '纵向拖动节点' : '拖动节点',
    'presentation',
    forward,
    inverse,
  );
}

export function setLayoutDirectionEntry(
  file: BranchFile,
  direction: LayoutDirection,
): HistoryEntry {
  const before = file.presentation.layoutDirection;
  const restore = before
    ? cmd('presentation.setLayoutDirection', { direction: before })
    : cmd('presentation.replace', { presentation: structuredClone(file.presentation) });
  return entry(
    '设置布局方向',
    'presentation',
    [cmd('presentation.setLayoutDirection', { direction })],
    [restore],
  );
}

export function scaledCustomSize(presentation: SavedPresentation, nodeId: string, scale: number) {
  const size = presentation.nodeSizes?.[nodeId];
  if (!size) return undefined;
  const ratio = scale / (presentation.nodeScales?.[nodeId] ?? 1);
  return { width: size.width * ratio, height: size.height * ratio };
}

export function setNodeScaleEntry(
  file: BranchFile,
  nodeId: string,
  scale: number,
  resizeCustomBox = false,
): HistoryEntry {
  const before = file.presentation.nodeScales?.[nodeId];
  const size = resizeCustomBox ? scaledCustomSize(file.presentation, nodeId, scale) : undefined;
  const inverse =
    before === undefined
      ? [cmd('presentation.replace', { presentation: structuredClone(file.presentation) })]
      : [
          cmd('presentation.setNodeScale', { nodeId, scale: before }),
          ...(size
            ? [
                cmd('presentation.setNodeSize', {
                  nodeId,
                  size: file.presentation.nodeSizes?.[nodeId],
                }),
              ]
            : []),
        ];
  return entry(
    '设置节点缩放',
    'presentation',
    [
      cmd('presentation.setNodeScale', { nodeId, scale }),
      ...(size ? [cmd('presentation.setNodeSize', { nodeId, size })] : []),
    ],
    inverse,
  );
}

export function setNodeSizeEntry(
  file: BranchFile,
  nodeId: string,
  size: { width: number; height: number } | null,
): HistoryEntry {
  const before = file.presentation.nodeSizes?.[nodeId] ?? null;
  return entry(
    '调整节点方框大小',
    'presentation',
    [cmd('presentation.setNodeSize', { nodeId, size })],
    [cmd('presentation.setNodeSize', { nodeId, size: before })],
  );
}

export function setBranchScaleEntry(file: BranchFile, nodeId: string, scale: number): HistoryEntry {
  const before = file.presentation.branchScales[nodeId];
  const inverse =
    before === undefined
      ? [cmd('presentation.replace', { presentation: structuredClone(file.presentation) })]
      : [cmd('presentation.setScale', { nodeId, scale: before })];
  return entry(
    '设置分支缩放',
    'presentation',
    [cmd('presentation.setScale', { nodeId, scale })],
    inverse,
  );
}

export function setCollapsedEntry(
  file: BranchFile,
  nodeId: string,
  collapsed = !file.presentation.collapsedByDefault.includes(nodeId),
): HistoryEntry {
  return setCollapsedNodesEntry(file, [nodeId], collapsed);
}

export function setCollapsedNodesEntry(
  file: BranchFile,
  nodeIds: readonly string[],
  collapsed: boolean,
): HistoryEntry {
  const before = new Set(file.presentation.collapsedByDefault);
  return entry(
    collapsed ? '折叠分支' : '展开分支',
    'presentation',
    nodeIds.map((nodeId) => cmd('presentation.collapse', { nodeId, collapsed })),
    nodeIds.map((nodeId) =>
      cmd('presentation.collapse', { nodeId, collapsed: before.has(nodeId) }),
    ),
  );
}

export const collapseEntry = setCollapsedEntry;

export function clearPositionEntry(
  file: BranchFile,
  nodeId: string,
  direction: LayoutDirection = 'horizontal',
): HistoryEntry {
  const before = positionsFor(file, direction)[nodeId];
  const forward = [cmd('presentation.clearManualPosition', { nodeId, direction })];
  const preserveDirection =
    direction === 'horizontal' &&
    before &&
    file.presentation.layoutDirection == null &&
    Object.keys(file.presentation.nodePositions).length === 1;
  if (preserveDirection) {
    forward.unshift(cmd('presentation.setLayoutDirection', { direction }));
  }
  return entry(
    '恢复节点自动位置',
    'presentation',
    forward,
    preserveDirection
      ? [cmd('presentation.replace', { presentation: structuredClone(file.presentation) })]
      : before
        ? [moveCommand(nodeId, before, direction)]
        : forward,
  );
}

export const clearManualPositionEntry = clearPositionEntry;

export function clearPositionsEntry(file: BranchFile, direction?: LayoutDirection): HistoryEntry {
  const directions: LayoutDirection[] = direction ? [direction] : ['horizontal', 'vertical'];
  const inverse: Command[] = directions.flatMap((item) =>
    Object.entries(positionsFor(file, item)).map(([nodeId, at]) => moveCommand(nodeId, at, item)),
  );
  const payload = direction ? { direction } : {};
  const forward = [cmd('presentation.clearManualPositions', payload)];
  if (
    direction !== 'vertical' &&
    file.presentation.layoutDirection == null &&
    resolveLayoutDirection(file.presentation) === 'horizontal'
  ) {
    forward.unshift(cmd('presentation.setLayoutDirection', { direction: 'horizontal' }));
    inverse.splice(
      0,
      inverse.length,
      cmd('presentation.replace', {
        presentation: structuredClone(file.presentation),
      }),
    );
  }
  return entry(
    direction === 'vertical' ? '纵向自动布局' : '自动布局',
    'presentation',
    forward,
    inverse.length > 0 ? inverse : forward,
  );
}

/** .branch.json 受控导入：整域替换仍然经 CommandService，actor.kind = external-import。 */
export function replaceDomainEntry(current: DomainState, next: DomainState): HistoryEntry {
  return entry(
    '导入项目文件',
    'domain',
    [cmd('workspace.replace', { domain: next })],
    [cmd('workspace.replace', { domain: current })],
    'external-import',
  );
}

/** 呈现状态随项目文件受控导入，反向命令可恢复导入前的完整呈现状态。 */
export function replacePresentationEntry(
  current: SavedPresentation,
  next: SavedPresentation,
): HistoryEntry {
  return entry(
    '导入呈现状态',
    'presentation',
    [cmd('presentation.replace', { presentation: structuredClone(next) })],
    [cmd('presentation.replace', { presentation: structuredClone(current) })],
    'external-import',
  );
}

export interface DragBatch {
  entry: HistoryEntry;
  frames: number;
  mergedCommands: number;
}

/**
 * 100 次连续拖动 → 1 个持久化批次、1 条历史记录、N 条合并后的命令（N = 被拖节点数）。
 * 不在此处调用任何 service，因此绝不产生帧级历史记录或语义 Commit。
 */
export class DragCoalescer {
  private frames = 0;
  private direction: LayoutDirection = 'horizontal';
  private readonly start = new Map<string, Point>();
  private readonly latest = new Map<string, Point>();

  begin(nodeId: string, at: Point, direction: LayoutDirection = 'horizontal'): void {
    this.frames = 0;
    this.direction = direction;
    this.start.clear();
    this.latest.clear();
    this.start.set(nodeId, { ...at });
    this.latest.set(nodeId, { ...at });
  }

  move(nodeId: string, at: Point, direction?: LayoutDirection): void {
    this.frames += 1;
    if (direction) this.direction = direction;
    if (!this.start.has(nodeId)) this.start.set(nodeId, { ...at });
    this.latest.set(nodeId, { ...at });
  }

  get frameCount(): number {
    return this.frames;
  }

  finish(direction: LayoutDirection = this.direction): DragBatch | null {
    const moves: { nodeId: string; from: Point; to: Point }[] = [];
    for (const [nodeId, to] of this.latest) {
      const from = this.start.get(nodeId) ?? to;
      if (Math.abs(from.x - to.x) > 0.01 || Math.abs(from.y - to.y) > 0.01) {
        moves.push({ nodeId, from, to });
      }
    }
    const result =
      moves.length > 0
        ? { entry: moveEntry(moves, direction), frames: this.frames, mergedCommands: moves.length }
        : null;
    this.frames = 0;
    this.direction = 'horizontal';
    this.start.clear();
    this.latest.clear();
    return result;
  }
}
