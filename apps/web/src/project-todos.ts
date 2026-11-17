import { buildHierarchy } from '@workspacetree/layout';
import { indexWorkspaceTasks } from '@workspacetree/markdown';
import type { DomainState, Task } from '@workspacetree/schema';
import type { TodoStatus } from './markdown-todos';

export type TodoScope = 'leaves' | 'all' | 'inbox';
export type TodoStatusFilter = TodoStatus | 'all';
export type TodoTagKind = 'nodeTag' | 'todoTag';
export type TodoGrouping = 'branch' | TodoTagKind;

interface TodoFields {
  id: string;
  nodeTitle: string;
  title: string;
  status: TodoStatus;
  isLeaf: boolean;
  nodeTags: readonly string[];
  todoTags: readonly string[];
  scheduledAt?: string;
  completedAt?: string;
}

export type ProjectTodo = TodoFields &
  (
    | { source: 'task'; nodeId: string | null; task: Task }
    | { source: 'markdown'; nodeId: string; blockId: string; lineIndex: number; markdown: string }
  );

interface TodoGroup {
  id: string;
  title: string;
  items: ProjectTodo[];
}

function taskTodo(
  task: Task,
  nodeTitle: string,
  nodeTags: readonly string[],
  isLeaf: boolean,
): ProjectTodo {
  return {
    id: task.id,
    nodeId: task.nodeId,
    nodeTitle,
    title: task.title,
    status: task.status ?? (task.done ? 'done' : 'open'),
    source: 'task',
    isLeaf,
    nodeTags,
    todoTags: task.tags ?? [],
    scheduledAt: task.scheduledAt,
    completedAt: task.done ? task.completedAt : undefined,
    task,
  };
}

export function collectProjectTodos(
  domain: DomainState,
  { includeEmpty = false }: { includeEmpty?: boolean } = {},
): TodoGroup[] {
  const { rootNodeId } = domain.project;
  const { children, roots } = buildHierarchy(domain.nodes, domain.edges);
  const nodes = new Map(domain.nodes.map((node) => [node.id, node]));
  const { byNode, inbox } = indexWorkspaceTasks(domain);

  function collectNode(nodeId: string): ProjectTodo[] {
    const node = nodes.get(nodeId);
    if (!node) return [];
    const context = {
      nodeId,
      nodeTitle: node.title || '未命名节点',
      isLeaf: children.get(nodeId)?.length === 0,
      nodeTags: node.tags ?? [],
    };
    return (byNode.get(nodeId) ?? []).map((item) => {
      if (item.source === 'task') {
        return taskTodo(item.task, context.nodeTitle, context.nodeTags, context.isLeaf);
      }
      const { task, blockId, markdown } = item;
      return {
        ...context,
        id: JSON.stringify([nodeId, blockId, task.lineIndex]),
        source: 'markdown',
        title: task.title,
        status: task.status,
        todoTags: task.tags,
        scheduledAt: task.scheduledAt,
        completedAt: task.completedAt,
        blockId,
        lineIndex: task.lineIndex,
        markdown,
      };
    });
  }

  const topics = [...(children.get(rootNodeId) ?? []), ...roots.filter((id) => id !== rootNodeId)];
  const groups = [{ id: rootNodeId, title: '项目级', items: collectNode(rootNodeId) }];
  for (const topicId of topics) {
    const items: ProjectTodo[] = [];
    const remaining = [topicId];
    while (remaining.length > 0) {
      const nodeId = remaining.pop()!;
      items.push(...collectNode(nodeId));
      const childIds = children.get(nodeId) ?? [];
      for (let index = childIds.length - 1; index >= 0; index--) {
        if (childIds[index] !== rootNodeId) remaining.push(childIds[index]);
      }
    }
    groups.push({ id: topicId, title: nodes.get(topicId)?.title || '未命名分支', items });
  }
  groups.unshift({
    id: '',
    title: '待分配',
    items: inbox.map(({ task }) => taskTodo(task, '待分配', [], false)),
  });
  return includeEmpty ? groups : groups.filter((group) => group.items.length > 0);
}

export function projectTodoSections(
  branches: TodoGroup[],
  matching: TodoGroup[],
  scope: TodoScope,
  grouping: TodoGrouping,
): TodoGroup[] {
  if (scope !== 'inbox' && grouping !== 'branch') return groupProjectTodos(matching, grouping);
  const byId = new Map(matching.map((group) => [group.id, group]));
  const sections = branches.filter(
    (branch) => scope === 'all' || (scope === 'inbox' ? branch.id === '' : branch.id !== ''),
  );
  return sections.map((branch) => byId.get(branch.id) ?? { ...branch, items: [] });
}

export function filterProjectTodos(
  groups: TodoGroup[],
  scope: TodoScope,
  status: TodoStatusFilter,
  tags: Partial<Record<TodoTagKind, string>> = {},
): TodoGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (scope === 'all' || (scope === 'inbox' ? item.nodeId === null : item.isLeaf)) &&
          (status === 'all' || item.status === status) &&
          (!tags.nodeTag || item.nodeTags.includes(tags.nodeTag)) &&
          (!tags.todoTag || item.todoTags.includes(tags.todoTag)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function tagsFor(item: ProjectTodo, kind: TodoTagKind): readonly string[] {
  return kind === 'nodeTag' ? item.nodeTags : item.todoTags;
}

export function projectTodoTags(groups: readonly TodoGroup[], kind: TodoTagKind): string[] {
  const tags = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      for (const tag of tagsFor(item, kind)) tags.add(tag);
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export function groupProjectTodos(groups: TodoGroup[], grouping: TodoGrouping): TodoGroup[] {
  if (grouping === 'branch') return groups;
  const byTag = new Map<string, TodoGroup>();
  const untagged: TodoGroup = {
    id: '',
    title: grouping === 'nodeTag' ? '无节点标签' : '无 TODO 标签',
    items: [],
  };
  for (const group of groups) {
    for (const item of group.items) {
      const tags = new Set(tagsFor(item, grouping));
      if (tags.size === 0) untagged.items.push(item);
      for (const tag of tags) {
        const tagged = byTag.get(tag) ?? { id: tag, title: '#' + tag, items: [] };
        tagged.items.push(item);
        byTag.set(tag, tagged);
      }
    }
  }
  const ordered = [...byTag.values()].sort((left, right) =>
    left.id.localeCompare(right.id, 'zh-CN'),
  );
  if (untagged.items.length > 0) ordered.push(untagged);
  return ordered;
}
