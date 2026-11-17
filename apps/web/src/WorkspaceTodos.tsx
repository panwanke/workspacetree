import { buildHierarchy } from '@workspacetree/layout';
import { decodeTaskTitle } from '@workspacetree/markdown';
import type { DomainState } from '@workspacetree/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderInlineMarkdown } from './MarkdownPreview';
import { TODO_STATUS } from './markdown-todos';
import { TagList } from './TagList';
import { TodoEditor, TodoFieldEditor, type TodoEditField } from './TodoEditor';
import {
  collectProjectTodos,
  filterProjectTodos,
  projectTodoSections,
  projectTodoTags,
  type ProjectTodo,
  type TodoGrouping,
  type TodoScope,
  type TodoStatusFilter,
} from './project-todos';
import type { TodoDraft } from './todo-editing';
import { loadTodoViewState, saveTodoViewState, type TodoViewState } from './todo-view-state';
import { WorkspaceIcon } from './WorkspaceIcon';

const scopes = [
  ['all', '全部 TODO'],
  ['leaves', '末端节点'],
  ['inbox', '待分配'],
] as const;

type Editing = {
  groupId: string;
  groupTitle: string;
  source: ProjectTodo | null;
  field: TodoEditField;
};

export default function WorkspaceTodos({
  domain,
  hidden,
  readOnly,
  onLocate,
  onCreate,
  onUpdate,
  onDelete,
  undoDepth,
  redoDepth,
  onUndo,
  onRedo,
}: {
  domain: DomainState;
  hidden: boolean;
  readOnly: boolean;
  onLocate: (nodeId: string) => void;
  onCreate: (draft: TodoDraft) => Promise<void>;
  onUpdate: (source: ProjectTodo, changes: Partial<TodoDraft>) => Promise<void>;
  onDelete: (source: ProjectTodo) => Promise<void>;
  undoDepth: number;
  redoDepth: number;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [view, setView] = useState<TodoViewState>(loadTodoViewState);
  const { scope, status, grouping, nodeTag, todoTag } = view;
  useEffect(() => {
    saveTodoViewState(view);
  }, [view]);
  const setScope = (scope: TodoScope) => setView((current) => ({ ...current, scope }));
  const setStatus = (status: TodoStatusFilter) => setView((current) => ({ ...current, status }));
  const setGrouping = (grouping: TodoGrouping) => setView((current) => ({ ...current, grouping }));
  const setNodeTag = (nodeTag: string) => setView((current) => ({ ...current, nodeTag }));
  const setTodoTag = (todoTag: string) => setView((current) => ({ ...current, todoTag }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRows = useRef(new Set<string>());
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const editTrigger = useRef<{
    button: HTMLButtonElement;
    row: HTMLElement | null;
    field: TodoEditField;
  }>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const groups = useMemo(
    () => (hidden && !editing ? [] : collectProjectTodos(domain, { includeEmpty: true })),
    [domain, hidden, editing],
  );
  const nodeTags = useMemo(() => projectTodoTags(groups, 'nodeTag'), [groups]);
  const todoTags = useMemo(() => projectTodoTags(groups, 'todoTag'), [groups]);
  const matching = filterProjectTodos(groups, scope, status, { nodeTag, todoTag });
  const total = matching.reduce((count, group) => count + group.items.length, 0);
  const visibleGroups = projectTodoSections(groups, matching, scope, grouping);
  const branchView = grouping === 'branch' || scope === 'inbox';
  const editLocked = readOnly || !!editing || pending.size > 0;
  const activeSource = editing?.source;
  if (activeSource) {
    const index = visibleGroups.findIndex((group) => group.id === editing.groupId);
    const group = visibleGroups[index];
    if (!group) {
      visibleGroups.push({ id: editing.groupId, title: editing.groupTitle, items: [activeSource] });
    } else if (
      !group.items.some(
        (item) => item.source === activeSource.source && item.id === activeSource.id,
      )
    ) {
      visibleGroups[index] = { ...group, items: [...group.items, activeSource] };
    }
  }

  function beginEdit(next: Editing, trigger: HTMLButtonElement) {
    if (editLocked || pendingRows.current.size) return;
    editTrigger.current = { button: trigger, row: trigger.closest('li'), field: next.field };
    setEditing(next);
  }

  function closeEditor(restoreFocus = true) {
    setEditing(null);
    if (!restoreFocus) return;
    const trigger = editTrigger.current;
    requestAnimationFrame(() => {
      const button = trigger?.button.isConnected
        ? trigger.button
        : trigger?.row?.querySelector<HTMLButtonElement>(
            '[data-todo-field="' + trigger.field + '"]',
          );
      if (button?.isConnected && !button.disabled) button.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
    });
  }

  function announceUpdate(action: string, changes: Partial<TodoDraft>, source?: ProjectTodo) {
    const target = changes.target;
    const destination = target
      ? target.mode === 'existing'
        ? target.nodeId
        : null
      : (source?.nodeId ?? null);
    const unassigned = target
      ? target.mode === 'inbox'
      : source?.nodeId === null || source?.projectLevel === true;
    const isLeaf =
      target?.mode === 'new' ||
      (destination !== null &&
        (buildHierarchy(domain.nodes, domain.edges).children.get(destination)?.length ?? 0) === 0);
    const tags = changes.tags ?? source?.todoTags ?? [];
    const hiddenByFilter =
      (scope === 'inbox' && !unassigned) ||
      (scope === 'leaves' && !isLeaf) ||
      (status !== 'all' && (changes.status ?? source?.status) !== status) ||
      (todoTag && !tags.includes(todoTag)) ||
      (nodeTag && !domain.nodes.find((node) => node.id === destination)?.tags?.includes(nodeTag));
    setNotice({ message: hiddenByFilter ? action + '，当前筛选已隐藏该任务。' : action });
  }

  async function runRowAction(key: string, action: () => Promise<void>) {
    if (pendingRows.current.has(key)) return;
    pendingRows.current.add(key);
    setPending(new Set(pendingRows.current));
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setNotice({ message: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally {
      pendingRows.current.delete(key);
      setPending(new Set(pendingRows.current));
    }
  }

  function addEditor(groupId: string) {
    return (
      <TodoEditor
        domain={domain}
        initialNodeId={branchView ? groupId || null : null}
        initialTag={grouping === 'todoTag' && !branchView ? groupId || todoTag : todoTag}
        onClose={() => closeEditor()}
        onSave={async (draft) => {
          await onCreate(draft);
          announceUpdate('已添加', draft);
        }}
      />
    );
  }

  return (
    <main className="wst-todos" aria-labelledby="project-todos-heading" hidden={hidden}>
      <div className="wst-todos-content">
        <header className="wst-todos-header">
          <h2 id="project-todos-heading" ref={heading} tabIndex={-1}>
            项目 TODO
          </h2>
          <span className="wst-todos-count" aria-live="polite">
            {total} 项
          </span>
          <div className="wst-todos-actions">
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="撤销"
              title="撤销"
              disabled={readOnly || !undoDepth || !!editing || !!pending.size}
              onClick={() => {
                setNotice(null);
                onUndo();
              }}
            >
              <WorkspaceIcon name="undo" />
            </button>
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="重做"
              title="重做"
              disabled={readOnly || !redoDepth || !!editing || !!pending.size}
              onClick={() => {
                setNotice(null);
                onRedo();
              }}
            >
              <WorkspaceIcon name="redo" />
            </button>
            {!branchView && !readOnly && (
              <button
                type="button"
                className="wst-tool"
                disabled={editLocked}
                onClick={(event) => {
                  setScope('inbox');
                  beginEdit(
                    { groupId: '', groupTitle: '待分配', source: null, field: 'title' },
                    event.currentTarget,
                  );
                }}
              >
                <WorkspaceIcon name="plus" size={15} /> 添加到待分配
              </button>
            )}
          </div>
        </header>

        <fieldset className="wst-todos-filters" disabled={!!editing}>
          <div className="wst-project-view-switch" role="group" aria-label="TODO 节点范围">
            {scopes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="wst-todos-status-filter">
            状态
            <select
              aria-label="状态"
              value={status}
              onChange={(event) => setStatus(event.target.value as TodoStatusFilter)}
            >
              <option value="all">全部状态</option>
              {Object.entries(TODO_STATUS).map(([value, { marker, label }]) => (
                <option key={value} value={value}>
                  {marker} {label}
                </option>
              ))}
            </select>
          </label>
          <label className="wst-todos-status-filter">
            分组
            <select
              value={branchView ? 'branch' : grouping}
              onChange={(event) => {
                const next = event.target.value as TodoGrouping;
                setGrouping(next);
                if (scope === 'inbox' && next !== 'branch') setScope('all');
              }}
            >
              <option value="branch">按一级分支</option>
              <option value="nodeTag">按节点标签</option>
              <option value="todoTag">按 TODO 标签</option>
            </select>
          </label>
          <TagFilter label="节点标签" tags={nodeTags} value={nodeTag} onChange={setNodeTag} />
          <TagFilter label="TODO 标签" tags={todoTags} value={todoTag} onChange={setTodoTag} />
        </fieldset>

        {notice && (
          <p
            className={notice.error ? 'wst-todo-notice wst-error' : 'wst-todo-notice'}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.message}
          </p>
        )}
        {visibleGroups.map((group) => (
          <section key={group.id} className="wst-todo-group" aria-label={group.title}>
            <div className="wst-todo-group-heading">
              <WorkspaceIcon name={branchView ? (group.id ? 'tree' : 'folder') : 'tag'} size={16} />
              <h3>{group.title}</h3>
              <span>{group.items.length} 项</span>
            </div>
            {editing?.groupId === group.id && editing.source === null ? (
              <div className="wst-todo-inline-row">{addEditor(group.id)}</div>
            ) : (
              !readOnly &&
              (branchView || grouping === 'todoTag') && (
                <button
                  type="button"
                  className="wst-todo-add"
                  disabled={editLocked}
                  aria-label={'添加 TODO 到 ' + group.title}
                  onClick={(event) =>
                    beginEdit(
                      { groupId: group.id, groupTitle: group.title, source: null, field: 'title' },
                      event.currentTarget,
                    )
                  }
                >
                  <WorkspaceIcon name="plus" size={16} /> 添加 TODO
                </button>
              )
            )}
            {group.items.length > 0 && (
              <ul className="wst-todo-list">
                {group.items.map((row) => {
                  const current =
                    editing?.groupId === group.id &&
                    editing.source?.id === row.id &&
                    editing.source.source === row.source;
                  const item = current ? editing.source! : row;
                  const key = item.source + ':' + item.id;
                  const title =
                    (item.source === 'markdown' ? decodeTaskTitle(item.title) : item.title) ||
                    (item.source === 'markdown'
                      ? item.todoTags.map((tag) => '#' + tag).join(' ')
                      : '') ||
                    '未命名 TODO';
                  const nodeId = item.nodeId;
                  const busy = pending.has(key);
                  const edit = (field: TodoEditField, trigger: HTMLButtonElement) =>
                    beginEdit(
                      { groupId: group.id, groupTitle: group.title, source: item, field },
                      trigger,
                    );
                  const cell = (field: TodoEditField) =>
                    current &&
                    editing.field === field && (
                      <TodoFieldEditor
                        domain={domain}
                        item={editing.source!}
                        field={field}
                        onClose={closeEditor}
                        onUpdate={async (changes) => {
                          await onUpdate(editing.source!, changes);
                          announceUpdate('已更新', changes, item);
                        }}
                      />
                    );

                  return (
                    <li key={key} className="wst-todo-row" aria-busy={busy}>
                      <div className="wst-todo-status-cell">
                        <input
                          type="checkbox"
                          className="wst-todo-check"
                          checked={item.status === 'done'}
                          disabled={readOnly || busy || !!editing}
                          aria-label={(item.status === 'done' ? '取消完成 ' : '完成 ') + title}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            const changes = { status: checked ? 'done' : 'open' } as const;
                            void runRowAction(key, async () => {
                              await onUpdate(item, changes);
                              announceUpdate(checked ? '已完成' : '已取消完成', changes, item);
                              if (status !== 'all' && changes.status !== status)
                                heading.current?.focus({ preventScroll: true });
                            });
                          }}
                        />
                        {cell('status') || (
                          <button
                            type="button"
                            className={`wst-todo-status is-${item.status}`}
                            data-todo-field="status"
                            disabled={editLocked}
                            aria-label={'编辑状态 ' + title}
                            title={TODO_STATUS[item.status].label}
                            onClick={(event) => edit('status', event.currentTarget)}
                          >
                            <span>{TODO_STATUS[item.status].label}</span>
                          </button>
                        )}
                      </div>
                      {cell('title') || (
                        <button
                          type="button"
                          className={`wst-todo-cell wst-todo-title is-${item.status}`}
                          data-todo-field="title"
                          disabled={editLocked}
                          aria-label={'编辑 TODO ' + title}
                          onClick={(event) => edit('title', event.currentTarget)}
                        >
                          {item.source === 'markdown' && item.title
                            ? renderInlineMarkdown(item.title)
                            : title}
                        </button>
                      )}
                      <div className="wst-todo-dates">
                        {cell('date') || (
                          <button
                            type="button"
                            className="wst-todo-cell wst-todo-date-cell"
                            data-todo-field="date"
                            disabled={editLocked}
                            aria-label={'编辑计划日期 ' + title}
                            onClick={(event) => edit('date', event.currentTarget)}
                          >
                            {item.scheduledAt ? (
                              <time dateTime={item.scheduledAt}>计划 {item.scheduledAt}</time>
                            ) : (
                              <span className="wst-todo-placeholder">计划日期</span>
                            )}
                          </button>
                        )}
                        {item.completedAt && (
                          <time className="wst-todo-completed" dateTime={item.completedAt}>
                            完成 {item.completedAt}
                          </time>
                        )}
                      </div>
                      {cell('tags') || (
                        <button
                          type="button"
                          className="wst-todo-cell wst-todo-tag-cell"
                          data-todo-field="tags"
                          disabled={editLocked}
                          aria-label={'编辑标签 ' + title}
                          onClick={(event) => edit('tags', event.currentTarget)}
                        >
                          {item.todoTags.length ? (
                            <TagList tags={item.todoTags} label="TODO 标签" />
                          ) : (
                            <span className="wst-todo-placeholder">加标签</span>
                          )}
                        </button>
                      )}
                      <div className="wst-todo-origin">
                        {cell('target') || (
                          <div className="wst-todo-row-actions">
                            {nodeId !== null && !item.projectLevel && (
                              <button
                                type="button"
                                className="wst-todo-source"
                                disabled={!!editing}
                                aria-label={`定位节点 ${item.nodeTitle}（${item.source === 'markdown' ? 'Markdown 笔记' : '节点任务'}）`}
                                onClick={() => onLocate(nodeId)}
                              >
                                <span>{item.nodeTitle}</span>
                                <WorkspaceIcon name="arrow" size={14} />
                              </button>
                            )}
                            {!readOnly && (
                              <button
                                type="button"
                                className="wst-tool is-icon is-subtle"
                                data-todo-field="target"
                                title="修改归属"
                                disabled={editLocked}
                                aria-label={'修改归属 ' + title}
                                onClick={(event) => edit('target', event.currentTarget)}
                              >
                                <WorkspaceIcon name="route" size={15} />
                              </button>
                            )}
                            {!readOnly && (
                              <button
                                type="button"
                                className="wst-tool is-icon is-subtle wst-todo-delete"
                                title="删除 TODO"
                                aria-label={'删除 TODO ' + title}
                                disabled={busy || !!editing}
                                onClick={() =>
                                  void runRowAction(key, async () => {
                                    await onDelete(item);
                                    setNotice({ message: '已删除，可撤销。' });
                                    heading.current?.focus({ preventScroll: true });
                                  })
                                }
                              >
                                <WorkspaceIcon name="trash" size={15} />
                              </button>
                            )}
                          </div>
                        )}
                        <TagList tags={item.nodeTags} label="节点标签" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
        {total === 0 && groups.some((group) => group.items.length > 0) && (
          <p className="wst-todos-empty">当前筛选条件下没有 TODO。</p>
        )}
      </div>
    </main>
  );
}

function TagFilter({
  label,
  tags,
  value,
  onChange,
}: {
  label: string;
  tags: readonly string[];
  value: string;
  onChange: (tag: string) => void;
}) {
  return (
    <label className="wst-todos-status-filter">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">全部</option>
        {value && !tags.includes(value) && <option value={value}>#{value}</option>}
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            #{tag}
          </option>
        ))}
      </select>
    </label>
  );
}
