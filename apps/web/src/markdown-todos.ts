import {
  readMarkdownTasks,
  TASK_STATUS_CONFIG,
  type MarkdownTaskStatus,
} from '@workspacetree/markdown';

export type TodoStatus = MarkdownTaskStatus;

export const TODO_STATUS = TASK_STATUS_CONFIG;

export interface MarkdownTodo {
  lineIndex: number;
  status: TodoStatus;
  title: string;
  tags: string[];
  scheduledAt?: string;
  completedAt?: string;
}

export function readMarkdownTodos(markdown: string): MarkdownTodo[] {
  return readMarkdownTasks(markdown).map((item) => ({
    lineIndex: item.lineIndex,
    status: item.status,
    title: item.title,
    tags: item.tags,
    ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
  }));
}
