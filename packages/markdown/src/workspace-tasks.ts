import type { Block, Node, Task } from '@workspacetree/schema';
import { readMarkdownTasks, type MarkdownTaskItem, type MarkdownTaskStatus } from './tasks.js';

export type WorkspaceTask =
  | {
      source: 'task';
      status: MarkdownTaskStatus;
      task: Task;
    }
  | {
      source: 'markdown';
      blockId: string;
      markdown: string;
      task: MarkdownTaskItem;
    };

export function readMarkdownBlocks(blocks: readonly Block[] = []): Map<string, string> {
  const markdown = new Map<string, string>();
  for (const block of blocks) {
    if (block.kind !== 'text' && block.kind !== 'checklist') continue;
    const value = (block.payload as { markdown?: unknown } | null)?.markdown;
    if (typeof value === 'string') markdown.set(block.id, value);
  }
  return markdown;
}

export function selectNodeNote(node: Node, markdown: ReadonlyMap<string, string>) {
  const canonical = 'blk_note_' + node.id;
  const id =
    node.blockIds.includes(canonical) && markdown.has(canonical)
      ? canonical
      : node.blockIds.find((blockId) => markdown.has(blockId));
  return id === undefined ? undefined : { id, markdown: markdown.get(id)! };
}

export function indexWorkspaceTasks({
  nodes,
  tasks = [],
  blocks,
}: {
  nodes: readonly Node[];
  tasks?: readonly Task[];
  blocks?: readonly Block[];
}) {
  const byNode = new Map<string, WorkspaceTask[]>(nodes.map((node) => [node.id, []]));
  const inbox: (WorkspaceTask & { source: 'task' })[] = [];
  for (const task of tasks) {
    const status = task.status ?? (task.done ? 'done' : 'open');
    const item = { source: 'task', status, task } as const;
    if (task.nodeId === null) inbox.push(item);
    else byNode.get(task.nodeId)?.push(item);
  }

  const markdownByBlock = readMarkdownBlocks(blocks);
  const parsedBlocks = new Map<string, MarkdownTaskItem[]>();
  for (const node of nodes) {
    const items = byNode.get(node.id)!;
    for (const blockId of new Set(node.blockIds)) {
      const markdown = markdownByBlock.get(blockId);
      if (!markdown) continue;
      let parsed = parsedBlocks.get(blockId);
      if (!parsed) {
        parsed = readMarkdownTasks(markdown);
        parsedBlocks.set(blockId, parsed);
      }
      for (const task of parsed) {
        items.push({ source: 'markdown', blockId, markdown, task });
      }
    }
  }
  return { byNode, inbox, markdownByBlock };
}

export function workspaceTaskCounts(tasks: readonly WorkspaceTask[] = []) {
  return {
    total: tasks.length,
    done: tasks.filter(
      (item) => (item.source === 'task' ? item.status : item.task.status) === 'done',
    ).length,
  };
}
