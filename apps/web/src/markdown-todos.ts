import {
  readMarkdownTasks,
  V2_TASK_LINE_REGEX,
  type MarkdownTaskStatus,
} from '@workspacetree/markdown';

export type TodoStatus = MarkdownTaskStatus;

export const TODO_STATUS: Record<TodoStatus, { marker: string; label: string }> = {
  open: { marker: '[ ]', label: '未完成' },
  done: { marker: '[x]', label: '已完成' },
  discarded: { marker: '[-]', label: '已废弃' },
  paused: { marker: '[~]', label: '已停用' },
  pending: { marker: '[?]', label: '待定' },
};

export interface MarkdownTodo {
  lineIndex: number;
  status: TodoStatus;
  title: string;
  tags: string[];
  scheduledAt?: string;
}

export const TODO_LINE = V2_TASK_LINE_REGEX;

export function readMarkdownTodos(markdown: string): MarkdownTodo[] {
  return readMarkdownTasks(markdown).map((item) => ({
    lineIndex: item.lineIndex,
    status: item.status,
    title: item.title,
    tags: item.tags,
    ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
  }));
}
