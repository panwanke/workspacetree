import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TODO_VIEW_STATE,
  loadTodoViewState,
  saveTodoViewState,
  type TodoViewStorage,
} from '../../apps/web/src/todo-view-state';

function memoryStorage(initial: Record<string, string> = {}): TodoViewStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('TODO 面板视图状态持久化', () => {
  it('没有存储内容时返回默认值', () => {
    expect(loadTodoViewState(memoryStorage())).toEqual(DEFAULT_TODO_VIEW_STATE);
  });

  it('保存后重新读取可恢复筛选、分组与标签', () => {
    const storage = memoryStorage();
    const state = {
      scope: 'inbox' as const,
      status: 'pending' as const,
      grouping: 'todoTag' as const,
      nodeTag: '实验',
      todoTag: '招募',
    };
    saveTodoViewState(state, storage);
    expect(loadTodoViewState(storage)).toEqual(state);
  });

  it('损坏的 JSON 与非法枚举值回退到默认值', () => {
    expect(loadTodoViewState(memoryStorage({ wst_project_todos_view: '{bad json' }))).toEqual(
      DEFAULT_TODO_VIEW_STATE,
    );
    expect(
      loadTodoViewState(
        memoryStorage({
          wst_project_todos_view: JSON.stringify({
            scope: 'bogus',
            status: 'unknown',
            grouping: 'bogus',
            nodeTag: 42,
            todoTag: null,
          }),
        }),
      ),
    ).toEqual(DEFAULT_TODO_VIEW_STATE);
  });

  it('缺少部分字段时保留默认值并接受合法值', () => {
    expect(
      loadTodoViewState(
        memoryStorage({ wst_project_todos_view: JSON.stringify({ scope: 'leaves' }) }),
      ),
    ).toEqual({ ...DEFAULT_TODO_VIEW_STATE, scope: 'leaves' });
  });
});
