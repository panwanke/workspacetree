import { canonicalize, makeId, newNodeId } from '@workspacetree/core';
import {
  appendMarkdownTask,
  decodeTaskTitle,
  editMarkdownTaskLine,
  escapeTaskTitle,
  localToday,
  readMarkdownBlocks,
  readMarkdownTasks,
  removeMarkdownTask,
  replaceMarkdownTaskLine,
  TASK_STATUS_CONFIG,
  type MarkdownTaskItem,
} from '@workspacetree/markdown';
import {
  StartAtSchema,
  TagSchema,
  type BranchFile,
  type Command,
  type DomainState,
  type Task,
} from '@workspacetree/schema';
import {
  addTaskEntry,
  createNodeEntry,
  editTaskEntry,
  getNodeNoteBlock,
  removeTaskEntry,
  setNodeNoteEntry,
  type HistoryEntry,
} from './history';
import type { TodoStatus } from './markdown-todos';

export type TodoTarget =
  { mode: 'inbox' } | { mode: 'existing'; nodeId: string } | { mode: 'new'; parentId: string };

export interface TodoDraft {
  title: string;
  status: TodoStatus;
  tags: readonly string[];
  scheduledAt: string | null;
  target: TodoTarget;
}

export type TodoSource =
  | { source: 'task'; id: string; task: Task }
  | { source: 'markdown'; nodeId: string; blockId: string; lineIndex: number; markdown: string };

type LocatedTodo =
  | { source: 'task'; nodeId: string | null; task: Task; index: number }
  | {
      source: 'markdown';
      nodeId: string;
      blockId: string;
      markdown: string;
      task: MarkdownTaskItem;
    };

function locateTodo(domain: DomainState, source: TodoSource, rebase = false): LocatedTodo {
  if (source.source === 'task') {
    const index = domain.tasks.findIndex((item) => item.id === source.id);
    const task = domain.tasks[index];
    if (!task || canonicalize(task) !== canonicalize(source.task)) {
      throw new Error('这条 TODO 已变化，请重新打开后重试。');
    }
    return { source: 'task', nodeId: task.nodeId, task, index };
  }

  const node = domain.nodes.find((item) => item.id === source.nodeId);
  const blocks = domain.blocks.filter((block) => block.id === source.blockId);
  const markdown = readMarkdownBlocks(blocks).get(source.blockId);
  if (!node?.blockIds.includes(source.blockId) || markdown === undefined) {
    throw new Error('原笔记已变化，请重新打开这条 TODO。');
  }
  const tasks = readMarkdownTasks(markdown);
  const task = tasks.find((item) => item.lineIndex === source.lineIndex);
  if (markdown !== source.markdown) {
    const previousLines = source.markdown.split(/\r?\n/);
    const raw = previousLines[source.lineIndex];
    if (
      !rebase ||
      !task ||
      task.raw !== raw ||
      previousLines.length !== markdown.split(/\r?\n/).length ||
      previousLines.filter((line) => line === raw).length !== 1 ||
      tasks.filter((item) => item.raw === raw).length !== 1
    ) {
      throw new Error('原笔记已变化，请重新打开这条 TODO。');
    }
  }
  if (!task) throw new Error('找不到原 TODO。');
  return { ...source, markdown, task };
}

function fieldsOf(item: LocatedTodo): TodoDraft {
  const { task } = item;
  return {
    title: task.title,
    tags: task.tags ?? [],
    status:
      item.source === 'markdown'
        ? item.task.status
        : (item.task.status ?? (item.task.done ? 'done' : 'open')),
    scheduledAt: task.scheduledAt ?? null,
    target: item.nodeId === null ? { mode: 'inbox' } : { mode: 'existing', nodeId: item.nodeId },
  };
}

function markdownEdit(
  nodeId: string,
  blockId: string,
  before: string,
  after: string,
): HistoryEntry {
  const payload = { id: nodeId, blockId };
  return {
    label: '编辑 TODO',
    stateClass: 'domain',
    actorKind: 'human',
    forward: [{ type: 'node.editMarkdownBlock', payload: { ...payload, markdown: after } }],
    inverse: [{ type: 'node.editMarkdownBlock', payload: { ...payload, markdown: before } }],
  };
}

export function deleteTodoEntry(file: BranchFile, source: TodoSource): HistoryEntry {
  const original = locateTodo(file.domain, source);
  if (original.source === 'task') return removeTaskEntry(original.task, original.index);
  return {
    ...markdownEdit(
      original.nodeId,
      original.blockId,
      original.markdown,
      removeMarkdownTask(original.markdown, original.task),
    ),
    label: '删除 TODO',
  };
}

export function updateTodoEntry(
  file: BranchFile,
  source: TodoSource,
  changes: Partial<TodoDraft>,
  day = localToday(),
): HistoryEntry {
  const original = locateTodo(file.domain, source, !changes.target);
  return buildTodoEntry(file, original, { ...fieldsOf(original), ...changes }, day);
}

export function saveTodoEntry(
  file: BranchFile,
  source: TodoSource | null,
  draft: TodoDraft,
  day = localToday(),
): HistoryEntry {
  const original = source ? locateTodo(file.domain, source) : null;
  return buildTodoEntry(file, original, draft, day);
}

function buildTodoEntry(
  file: BranchFile,
  original: LocatedTodo | null,
  draft: TodoDraft,
  day: string,
): HistoryEntry {
  const { domain } = file;
  const { target, status } = draft;
  const unchangedLegacyTitle = original?.source === 'task' && draft.title === original.task.title;
  const title = unchangedLegacyTitle ? draft.title : draft.title.trim();
  if (!unchangedLegacyTitle && /[\r\n]/.test(title)) throw new Error('TODO 标题须在一行内。');
  const scheduledAt =
    draft.scheduledAt === null ? undefined : StartAtSchema.parse(draft.scheduledAt);
  const tags = [...new Set(draft.tags.map((tag) => TagSchema.parse(tag)))];
  const before = original && fieldsOf(original);
  const completedAt =
    status === 'done'
      ? before?.status === 'done'
        ? original?.task.completedAt
        : StartAtSchema.parse(day)
      : undefined;
  const newId = target.mode === 'new' ? newNodeId() : null;
  const nodeId = target.mode === 'existing' ? target.nodeId : newId;
  const label = original ? '编辑 TODO' : '新建 TODO';
  const forward: Command[] = [];
  const inverse: Command[] = [];
  const result: HistoryEntry = {
    label,
    stateClass: 'domain',
    actorKind: 'human',
    forward,
    inverse,
  };

  function append(entry: HistoryEntry) {
    forward.push(...entry.forward);
    inverse.unshift(...entry.inverse);
  }

  const titleChanged = title !== before?.title;
  const tagsChanged = canonicalize(tags) !== canonicalize(before?.tags);
  const statusChanged = status !== before?.status;
  const scheduleChanged = (scheduledAt ?? null) !== before?.scheduledAt;
  if (
    original &&
    nodeId === original.nodeId &&
    !titleChanged &&
    !tagsChanged &&
    !statusChanged &&
    !scheduleChanged
  ) {
    return result;
  }

  if (newId && target.mode === 'new') {
    append(createNodeEntry(newId, title || '未命名 TODO', target.parentId, makeId('e_')));
    if (scheduledAt)
      forward.push({ type: 'node.setStartAt', payload: { id: newId, startAt: scheduledAt } });
  }

  if (original?.source === 'markdown') {
    if (nodeId === original.nodeId) {
      const line = editMarkdownTaskLine(original.task.raw, {
        ...(titleChanged ? { title } : {}),
        ...(tagsChanged ? { tags } : {}),
        ...(statusChanged ? { status, completedAt: completedAt ?? null } : {}),
        ...(scheduleChanged ? { scheduledAt: scheduledAt ?? null } : {}),
      });
      append(
        markdownEdit(
          nodeId,
          original.blockId,
          original.markdown,
          replaceMarkdownTaskLine(original.markdown, original.task, line),
        ),
      );
      return result;
    }
    append(
      markdownEdit(
        original.nodeId,
        original.blockId,
        original.markdown,
        removeMarkdownTask(original.markdown, original.task),
      ),
    );
  }

  if (nodeId !== null) {
    const destination = getNodeNoteBlock(domain, nodeId);
    if (destination && original?.source === 'markdown' && destination.id === original.blockId) {
      throw new Error('两个节点引用同一笔记，请选择另一目标节点。');
    }
    const content =
      [
        original?.source === 'task' ? escapeTaskTitle(title) : title,
        ...tags.map((tag) => '#' + tag),
        scheduledAt && '📅 ' + scheduledAt,
        completedAt && '✅ ' + completedAt,
      ]
        .filter(Boolean)
        .join(' ') || '未命名 TODO';
    const markdown = appendMarkdownTask(
      destination?.markdown ?? '',
      '- ' + TASK_STATUS_CONFIG[status].marker + ' ' + content,
    );
    append(
      destination
        ? markdownEdit(nodeId, destination.id, destination.markdown, markdown)
        : setNodeNoteEntry(domain, nodeId, markdown),
    );
    if (original?.source === 'task') append(removeTaskEntry(original.task, original.index));
    return result;
  }

  const task: Task = {
    id: original?.source === 'task' ? original.task.id : makeId('tsk_'),
    title: original?.source === 'markdown' ? decodeTaskTitle(title) : title,
    nodeId,
    done: status === 'done',
    ...(status === 'pending' || status === 'discarded' || status === 'paused' ? { status } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(tags.length ? { tags } : {}),
  };
  append(original?.source === 'task' ? editTaskEntry(original.task, task) : addTaskEntry(task));
  return result;
}
