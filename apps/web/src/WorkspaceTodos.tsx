import { buildHierarchy } from '@workspacetree/layout';
import type { DomainState } from '@workspacetree/schema';
import { useMemo, useRef, useState } from 'react';
import { renderInlineMarkdown } from './MarkdownPreview';
import { TODO_STATUS } from './markdown-todos';
import { TagList } from './TagList';
import { TodoEditor, type TodoEditField } from './TodoEditor';
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
import { WorkspaceIcon } from './WorkspaceIcon';

const scopes = [
  ['all', '全部节点'],
  ['leaves', '末端节点'],
  ['inbox', '待分配'],
] as const;

type Editing = {
  groupId: string;
  source: ProjectTodo | null;
  field: TodoEditField;
};

export default function WorkspaceTodos({
  domain,
  hidden,
  readOnly,
  onLocate,
  onSave,
  undoDepth,
  redoDepth,
  onUndo,
  onRedo,
}: {
  domain: DomainState;
  hidden: boolean;
  readOnly: boolean;
  onLocate: (nodeId: string) => void;
  onSave: (source: ProjectTodo | null, draft: TodoDraft) => Promise<void>;
  undoDepth: number;
  redoDepth: number;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [scope, setScope] = useState<TodoScope>('all');
  const [status, setStatus] = useState<TodoStatusFilter>('all');
  const [grouping, setGrouping] = useState<TodoGrouping>('branch');
  const [nodeTag, setNodeTag] = useState('');
  const [todoTag, setTodoTag] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
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

  function beginEdit(next: Editing, trigger: HTMLButtonElement) {
    if (editing || readOnly) return;
    editTrigger.current = { button: trigger, row: trigger.closest('li'), field: next.field };
    setEditing(next);
  }

  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => {
      const trigger = editTrigger.current;
      const button = trigger?.button.isConnected
        ? trigger.button
        : trigger?.row?.querySelector<HTMLButtonElement>(
            '[data-todo-field="' + trigger.field + '"]',
          );
      if (button?.isConnected && !button.disabled) button.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
    });
  }

  function editor(groupId: string, source: ProjectTodo | null) {
    if (!editing) return null;
    return (
      <TodoEditor
        domain={domain}
        source={source}
        initialNodeId={source ? source.nodeId : branchView ? groupId || null : null}
        initialStatus={status === 'all' ? 'open' : status}
        initialTag={grouping === 'todoTag' && !branchView ? groupId || todoTag : todoTag}
        field={editing.field}
        onClose={closeEditor}
        onSave={async (draft) => {
          await onSave(source, draft);
          const destination = draft.target.mode === 'existing' ? draft.target.nodeId : null;
          const outsideLeafScope =
            scope === 'leaves' &&
            destination !== null &&
            (buildHierarchy(domain.nodes, domain.edges).children.get(destination)?.length ?? 0) > 0;
          if ((scope === 'inbox' && draft.target.mode !== 'inbox') || outsideLeafScope) {
            setScope('all');
          }
          if (status !== 'all' && draft.status !== status) setStatus('all');
          if (todoTag && !draft.tags.includes(todoTag)) setTodoTag('');
          if (
            nodeTag &&
            !domain.nodes.find((node) => node.id === destination)?.tags?.includes(nodeTag)
          ) {
            setNodeTag('');
          }
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
              disabled={!undoDepth || !!editing}
              onClick={onUndo}
            >
              <WorkspaceIcon name="undo" />
            </button>
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="重做"
              title="重做"
              disabled={!redoDepth || !!editing}
              onClick={onRedo}
            >
              <WorkspaceIcon name="redo" />
            </button>
            {!branchView && !readOnly && (
              <button
                type="button"
                className="wst-tool"
                disabled={!!editing}
                onClick={(event) => {
                  setGrouping('branch');
                  beginEdit({ groupId: '', source: null, field: 'title' }, event.currentTarget);
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

        {visibleGroups.map((group) => (
          <section key={group.id} className="wst-todo-group" aria-label={group.title}>
            <div className="wst-todo-group-heading">
              <WorkspaceIcon name={branchView ? (group.id ? 'tree' : 'folder') : 'tag'} size={16} />
              <h3>{group.title}</h3>
              <span>{group.items.length} 项</span>
            </div>
            {group.items.length > 0 && (
              <ul className="wst-todo-list">
                {group.items.map((item) => {
                  const key = item.source + ':' + item.id;
                  const current =
                    editing?.groupId === group.id &&
                    editing.source?.id === item.id &&
                    editing.source.source === item.source;
                  const title =
                    item.title ||
                    (item.source === 'markdown'
                      ? item.todoTags.map((tag) => '#' + tag).join(' ')
                      : '') ||
                    '未命名 TODO';
                  const nodeId = item.nodeId;
                  const edit = (field: TodoEditField, trigger: HTMLButtonElement) =>
                    beginEdit({ groupId: group.id, source: item, field }, trigger);

                  return (
                    <li key={key} className={current ? 'wst-todo-inline-row' : 'wst-todo-row'}>
                      {current ? (
                        editor(group.id, item)
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`wst-todo-status is-${item.status}`}
                            data-todo-field="status"
                            disabled={readOnly || !!editing}
                            aria-label={'编辑状态 ' + title}
                            title={TODO_STATUS[item.status].label}
                            onClick={(event) => edit('status', event.currentTarget)}
                          >
                            <code aria-hidden="true">{TODO_STATUS[item.status].marker}</code>
                            <span>{TODO_STATUS[item.status].label}</span>
                          </button>
                          <button
                            type="button"
                            className={`wst-todo-cell wst-todo-title is-${item.status}`}
                            data-todo-field="title"
                            disabled={readOnly || !!editing}
                            aria-label={'编辑 TODO ' + title}
                            onClick={(event) => edit('title', event.currentTarget)}
                          >
                            {item.source === 'markdown' && item.title
                              ? renderInlineMarkdown(item.title)
                              : item.title || '未命名 TODO'}
                          </button>
                          <button
                            type="button"
                            className="wst-todo-cell wst-todo-date-cell"
                            data-todo-field="date"
                            disabled={readOnly || !!editing}
                            aria-label={'编辑日期 ' + title}
                            onClick={(event) => edit('date', event.currentTarget)}
                          >
                            {item.scheduledAt ? (
                              <time dateTime={item.scheduledAt}>{item.scheduledAt}</time>
                            ) : (
                              <span className="wst-todo-placeholder">设日期</span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="wst-todo-cell wst-todo-tag-cell"
                            data-todo-field="tags"
                            disabled={readOnly || !!editing}
                            aria-label={'编辑标签 ' + title}
                            onClick={(event) => edit('tags', event.currentTarget)}
                          >
                            {item.todoTags.length ? (
                              <TagList tags={item.todoTags} label="TODO 标签" />
                            ) : (
                              <span className="wst-todo-placeholder">加标签</span>
                            )}
                          </button>
                          <div className="wst-todo-origin">
                            <div className="wst-todo-row-actions">
                              {nodeId !== null && (
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
                              <button
                                type="button"
                                className="wst-tool is-icon is-subtle"
                                data-todo-field="target"
                                title="修改归属"
                                disabled={readOnly || !!editing}
                                aria-label={'修改归属 ' + title}
                                onClick={(event) => edit('target', event.currentTarget)}
                              >
                                <WorkspaceIcon name="route" size={15} />
                              </button>
                            </div>
                            <TagList tags={item.nodeTags} label="节点标签" />
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {editing?.groupId === group.id && editing.source === null ? (
              <div className="wst-todo-inline-row">{editor(group.id, null)}</div>
            ) : (
              !readOnly &&
              (branchView || grouping === 'todoTag') && (
                <button
                  type="button"
                  className="wst-todo-add"
                  disabled={!!editing}
                  aria-label={'添加 TODO 到 ' + group.title}
                  onClick={(event) =>
                    beginEdit(
                      { groupId: group.id, source: null, field: 'title' },
                      event.currentTarget,
                    )
                  }
                >
                  <WorkspaceIcon name="plus" size={16} /> 添加 TODO
                </button>
              )
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
