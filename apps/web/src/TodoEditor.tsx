import { buildHierarchy } from '@workspacetree/layout';
import { TagSchema, type DomainState } from '@workspacetree/schema';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { TODO_STATUS, type TodoStatus } from './markdown-todos';
import type { ProjectTodo } from './project-todos';
import type { TodoDraft, TodoTarget } from './todo-editing';
import { WorkspaceIcon } from './WorkspaceIcon';

export type TodoEditField = 'title' | 'date' | 'status' | 'tags' | 'target';

function parseTags(value: string): string[] {
  const tags = value
    .split(/[\s,，、]+/)
    .filter(Boolean)
    .map((tag) => tag.replace(/^#/, ''));
  if (tags.some((tag) => !TagSchema.safeParse(tag).success)) {
    throw new Error('标签可用文字、数字、下划线和连字符。');
  }
  return [...new Set(tags)];
}

function destinations(domain: DomainState) {
  const nodes = new Map(domain.nodes.map((node) => [node.id, node]));
  const { children, roots } = buildHierarchy(domain.nodes, domain.edges);
  const rootId = domain.project.rootNodeId;
  const branchIds = [...(children.get(rootId) ?? []), ...roots.filter((id) => id !== rootId)];
  const label = (id: string) => nodes.get(id)?.title || '未命名节点';
  return [
    { id: rootId, label: '项目级', options: [{ id: rootId, label: label(rootId) }] },
    ...branchIds.map((id) => {
      const options: { id: string; label: string }[] = [];
      const pending = [{ id, label: label(id) }];
      while (pending.length > 0) {
        const current = pending.pop()!;
        options.push(current);
        const childIds = children.get(current.id) ?? [];
        for (const childId of [...childIds].reverse()) {
          if (childId !== rootId) {
            pending.push({ id: childId, label: current.label + ' / ' + label(childId) });
          }
        }
      }
      return { id, label: label(id), options };
    }),
  ];
}

export function TodoEditor({
  domain,
  initialNodeId,
  initialTag,
  onSave,
  onClose,
}: {
  domain: DomainState;
  initialNodeId: string | null;
  initialTag: string;
  onSave: (draft: TodoDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TodoStatus>('open');
  const [scheduledAt, setScheduledAt] = useState('');
  const [tags, setTags] = useState(initialTag ? '#' + initialTag : '');
  const [mode, setMode] = useState<TodoTarget['mode']>(initialNodeId ? 'existing' : 'inbox');
  const [destination, setDestination] = useState(initialNodeId ?? '');
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(() => (assigning ? destinations(domain) : []), [domain, assigning]);
  const destinationName = domain.nodes.find((node) => node.id === destination)?.title;

  return (
    <form
      className="wst-todo-inline"
      aria-label="添加 TODO"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        const target: TodoTarget =
          mode === 'existing'
            ? { mode, nodeId: destination }
            : mode === 'new'
              ? { mode, parentId: destination }
              : { mode };
        setSaving(true);
        setError('');
        try {
          await onSave({
            title,
            status,
            scheduledAt: scheduledAt || null,
            tags: parseTags(tags),
            target,
          });
          onClose();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset className="wst-todo-inline-fields" disabled={saving}>
        <label className="wst-field wst-todo-edit-title">
          标题
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="未命名 TODO"
          />
        </label>
        <label className="wst-field">
          计划日期
          <input
            type="date"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>
        <label className="wst-field">
          TODO 标签
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="#实验 #招募"
          />
        </label>
        <label className="wst-field">
          状态
          <select value={status} onChange={(event) => setStatus(event.target.value as TodoStatus)}>
            {Object.entries(TODO_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="wst-todo-inline-footer">
        <button
          className="wst-tool is-subtle wst-todo-assignment"
          type="button"
          aria-expanded={assigning}
          disabled={saving}
          onClick={() => setAssigning(!assigning)}
        >
          <WorkspaceIcon name="route" size={15} />
          <span>
            归属 ·{' '}
            {mode === 'inbox'
              ? '待分配'
              : (mode === 'new' ? '新建于 ' : '') + (destinationName || '选择节点')}
          </span>
          <WorkspaceIcon name="chevron" size={12} />
        </button>
        <div className="wst-todo-inline-buttons">
          <button type="button" className="wst-tool" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="wst-tool is-primary"
            disabled={saving || (mode !== 'inbox' && !destination)}
          >
            {saving ? '正在添加…' : '添加'}
          </button>
        </div>
      </div>
      {assigning && (
        <fieldset className="wst-todo-assignment-fields" disabled={saving}>
          <label className="wst-field">
            分配方式
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as TodoTarget['mode'])}
            >
              <option value="inbox">留在待分配</option>
              <option value="existing">挂到已有节点</option>
              <option value="new">根据 TODO 新建节点</option>
            </select>
          </label>
          {mode !== 'inbox' && (
            <label className="wst-field">
              {mode === 'new' ? '新节点的父节点' : '目标节点'}
              <select
                required
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="" disabled>
                  选择分支下的节点
                </option>
                {groups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          {mode === 'new' && scheduledAt && (
            <p className="wst-todo-form-note">新节点也会使用此日期。</p>
          )}
        </fieldset>
      )}
      {error && (
        <p className="wst-error wst-todo-form-note" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function TodoFieldEditor({
  domain,
  item,
  field,
  onUpdate,
  onClose,
}: {
  domain: DomainState;
  item: ProjectTodo;
  field: TodoEditField;
  onUpdate: (changes: Partial<TodoDraft>) => Promise<void>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const [value, setValue] = useState(
    field === 'title'
      ? item.title
      : field === 'date'
        ? (item.scheduledAt ?? '')
        : item.todoTags.map((tag) => '#' + tag).join(' '),
  );
  const [mode, setMode] = useState<TodoTarget['mode']>(item.nodeId ? 'existing' : 'inbox');
  const [destination, setDestination] = useState(item.nodeId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const closed = useRef(false);
  const groups = useMemo(() => (field === 'target' ? destinations(domain) : []), [domain, field]);

  function close(restoreFocus: boolean) {
    closed.current = true;
    onClose(restoreFocus);
  }

  async function commit(changes: () => Partial<TodoDraft>, restoreFocus: boolean) {
    if (pending.current || closed.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const update = changes();
      if (
        (update.title !== undefined && update.title === item.title) ||
        (update.scheduledAt !== undefined && update.scheduledAt === (item.scheduledAt ?? null)) ||
        (update.tags &&
          update.tags.length === item.todoTags.length &&
          update.tags.every((tag, index) => tag === item.todoTags[index]))
      ) {
        close(restoreFocus);
        return;
      }
      await onUpdate(update);
      close(restoreFocus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function commitInput(input: HTMLInputElement, restoreFocus: boolean) {
    void commit(() => {
      if (!input.validity.valid) throw new Error('请输入有效的日期。');
      if (field === 'title') return { title: value.trim() };
      if (field === 'tags') return { tags: parseTags(value) };
      return { scheduledAt: value || null };
    }, restoreFocus);
  }

  function onEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (!pending.current) close(true);
  }

  const label = field === 'title' ? '标题' : field === 'tags' ? 'TODO 标签' : '计划日期';
  return (
    <div
      className={'wst-todo-cell-editor is-' + field}
      onKeyDown={onEscape}
      onBlur={(event) => {
        if (field !== 'status' && field !== 'target') return;
        if (!pending.current && !error && !event.currentTarget.contains(event.relatedTarget))
          close(false);
      }}
      aria-busy={saving}
    >
      {field === 'target' ? (
        <>
          <select
            autoFocus
            aria-label="分配方式"
            disabled={saving}
            value={mode}
            onChange={(event) => {
              const next = event.target.value as TodoTarget['mode'];
              setMode(next);
              setDestination('');
              if (next === 'inbox') void commit(() => ({ target: { mode: 'inbox' } }), true);
            }}
          >
            <option value="inbox">待分配</option>
            <option value="existing">挂到已有节点</option>
            <option value="new">根据 TODO 新建节点</option>
          </select>
          {mode !== 'inbox' && (
            <select
              aria-label={mode === 'new' ? '新节点的父节点' : '目标节点'}
              disabled={saving}
              value={destination}
              onChange={(event) => {
                const id = event.target.value;
                setDestination(id);
                void commit(
                  () => ({
                    target: mode === 'new' ? { mode, parentId: id } : { mode, nodeId: id },
                  }),
                  true,
                );
              }}
            >
              <option value="" disabled>
                选择节点
              </option>
              {groups.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.options.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </>
      ) : field === 'status' ? (
        <select
          autoFocus
          aria-label="TODO 状态"
          disabled={saving}
          value={item.status}
          onChange={(event) => {
            const status = event.target.value as TodoStatus;
            void commit(() => ({ status }), true);
          }}
        >
          {Object.entries(TODO_STATUS).map(([status, { label: statusLabel }]) => (
            <option key={status} value={status}>
              {statusLabel}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          aria-label={label}
          type={field === 'date' ? 'date' : 'text'}
          readOnly={saving}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={(event) => commitInput(event.currentTarget, false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commitInput(event.currentTarget, true);
            }
          }}
        />
      )}
      {error && (
        <span className="wst-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
