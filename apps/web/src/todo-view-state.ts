import { TODO_STATUS, type TodoStatus } from './markdown-todos';
import type { TodoGrouping, TodoScope, TodoStatusFilter } from './project-todos';

export interface TodoViewState {
  scope: TodoScope;
  status: TodoStatusFilter;
  grouping: TodoGrouping;
  nodeTag: string;
  todoTag: string;
}

export const DEFAULT_TODO_VIEW_STATE: TodoViewState = {
  scope: 'all',
  status: 'all',
  grouping: 'branch',
  nodeTag: '',
  todoTag: '',
};

const STORAGE_KEY = 'wst_project_todos_view';
const SCOPES: readonly TodoScope[] = ['all', 'leaves', 'inbox'];
const GROUPINGS: readonly TodoGrouping[] = ['branch', 'nodeTag', 'todoTag'];
const STATUSES: readonly TodoStatusFilter[] = [
  'all',
  ...(Object.keys(TODO_STATUS) as TodoStatus[]),
];

export interface TodoViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function activeStorage(storage?: TodoViewStorage): TodoViewStorage | null {
  if (storage) return storage;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function loadTodoViewState(storage?: TodoViewStorage): TodoViewState {
  const result: TodoViewState = { ...DEFAULT_TODO_VIEW_STATE };
  const store = activeStorage(storage);
  if (!store) return result;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return result;
    const saved = parsed as Partial<TodoViewState>;
    result.scope = oneOf(saved.scope, SCOPES, result.scope);
    result.status = oneOf(saved.status, STATUSES, result.status);
    result.grouping = oneOf(saved.grouping, GROUPINGS, result.grouping);
    result.nodeTag = typeof saved.nodeTag === 'string' ? saved.nodeTag : '';
    result.todoTag = typeof saved.todoTag === 'string' ? saved.todoTag : '';
  } catch {
    // 持久化数据损坏或隐私模式下不可读时回退到默认值
  }
  return result;
}

export function saveTodoViewState(state: TodoViewState, storage?: TodoViewStorage): void {
  const store = activeStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 忽略存储配额或隐私模式写入失败
  }
}
