import { canonicalize, makeId, newNodeId } from '@workspacetree/core';
import { StartAtSchema, type BranchFile, type Command, type Task } from '@workspacetree/schema';
import {
  addTaskEntry,
  createNodeEntry,
  editTaskEntry,
  getNodeNoteBlock,
  setNodeNoteEntry,
  type HistoryEntry,
} from './history';
import { readMarkdownTodos, TODO_LINE, TODO_STATUS, type TodoStatus } from './markdown-todos';
import type { ProjectTodo } from './project-todos';

export type TodoTarget =
  { mode: 'inbox' } | { mode: 'existing'; nodeId: string } | { mode: 'new'; parentId: string };

export interface TodoDraft {
  title: string;
  status: TodoStatus;
  tags: readonly string[];
  scheduledAt: string | null;
  target: TodoTarget;
}

export function saveTodoEntry(
  file: BranchFile,
  source: ProjectTodo | null,
  draft: TodoDraft,
): HistoryEntry {
  const { domain } = file;
  const { target } = draft;
  const title = draft.title.trim();
  if (/[\r\n]/.test(title)) throw new Error('TODO 标题须在一行内。');
  const scheduledAt =
    draft.scheduledAt === null ? undefined : StartAtSchema.parse(draft.scheduledAt);
  const tags = [...new Set(draft.tags)];
  const newId = target.mode === 'new' ? newNodeId() : null;
  const nodeId = target.mode === 'existing' ? target.nodeId : newId;
  const forward: Command[] = [];
  const inverse: Command[] = [];
  function append(entry: HistoryEntry) {
    forward.push(...entry.forward);
    inverse.unshift(...entry.inverse);
  }

  function changeMarkdown(id: string, blockId: string, before: string, after: string) {
    const payload = { id, blockId };
    forward.push({ type: 'node.editMarkdownBlock', payload: { ...payload, markdown: after } });
    inverse.unshift({ type: 'node.editMarkdownBlock', payload: { ...payload, markdown: before } });
  }

  if (target.mode === 'new' && newId) {
    const creation = createNodeEntry(newId, title || '未命名 TODO', target.parentId, makeId('e_'));
    if (scheduledAt) {
      creation.forward.push({
        type: 'node.setStartAt',
        payload: { id: newId, startAt: scheduledAt },
      });
    }
    append(creation);
  }

  if (source?.source === 'markdown') {
    const block = domain.blocks.find((item) => item.id === source.blockId);
    const node = domain.nodes.find((item) => item.id === source.nodeId);
    const markdown = (block?.payload as { markdown?: unknown } | null)?.markdown;
    if (!node?.blockIds.includes(source.blockId) || markdown !== source.markdown) {
      throw new Error('原笔记已变化，请重新打开这条 TODO。');
    }

    const parts = source.markdown.split(/(\r?\n)/);
    const index = source.lineIndex * 2;
    const prefix = TODO_LINE.exec(parts[index])?.[1];
    if (!prefix) throw new Error('找不到原 TODO。');

    const content =
      [title, ...tags.map((tag) => '#' + tag), scheduledAt && '📅 ' + scheduledAt]
        .filter(Boolean)
        .join(' ') || '未命名 TODO';
    const line = TODO_STATUS[draft.status].marker + ' ' + content;
    if (nodeId === source.nodeId) {
      parts[index] = prefix + line;
    } else {
      parts.splice(index === parts.length - 1 && index > 0 ? index - 1 : index, 2);
    }
    changeMarkdown(source.nodeId, source.blockId, markdown, parts.join(''));

    if (nodeId !== null) {
      if (nodeId !== source.nodeId) {
        const destination = getNodeNoteBlock(domain, nodeId);
        const before = destination?.markdown ?? '';
        const newline = before.includes('\r\n') ? '\r\n' : '\n';
        const separator = before && !before.endsWith('\n') ? newline : '';
        const appended = before + separator + '- ' + line;
        const lastIndex = appended.split(/\r?\n/).length - 1;
        const next = readMarkdownTodos(appended).some((item) => item.lineIndex === lastIndex)
          ? appended
          : '- ' + line + newline + newline + before;
        if (destination) {
          changeMarkdown(nodeId, destination.id, before, next);
        } else {
          append(setNodeNoteEntry(domain, nodeId, next));
        }
      }
      return { label: '编辑 TODO', stateClass: 'domain', actorKind: 'human', forward, inverse };
    }
  }

  const task: Task = {
    id: source?.source === 'task' ? source.id : makeId('tsk_'),
    title,
    nodeId,
    done: draft.status === 'done',
    ...(draft.status === 'pending' || draft.status === 'discarded' ? { status: draft.status } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(tags.length ? { tags } : {}),
  };
  if (source?.source === 'task') {
    const before = domain.tasks.find((item) => item.id === source.id);
    if (!before || canonicalize(before) !== canonicalize(source.task)) {
      throw new Error('原 TODO 已变化，请重新打开后再编辑。');
    }
    append(editTaskEntry(before, task));
  } else {
    append(addTaskEntry(task));
  }
  return {
    label: source ? '编辑 TODO' : '新建 TODO',
    stateClass: 'domain',
    actorKind: 'human',
    forward,
    inverse,
  };
}
