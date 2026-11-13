import { buildHierarchy } from '@workspacetree/layout';
import { TagSchema, type DomainState } from '@workspacetree/schema';
import { useMemo, useState } from 'react';
import { TODO_STATUS, type TodoStatus } from './markdown-todos';
import type { ProjectTodo } from './project-todos';
import type { TodoDraft, TodoTarget } from './todo-editing';
import { WorkspaceIcon } from './WorkspaceIcon';

export type TodoEditField = 'title' | 'date' | 'status' | 'tags' | 'target';

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
  source,
  initialNodeId,
  initialStatus,
  initialTag,
  field,
  onSave,
  onClose,
}: {
  domain: DomainState;
  source: ProjectTodo | null;
  initialNodeId: string | null;
  initialStatus: TodoStatus;
  initialTag: string;
  field: TodoEditField;
  onSave: (draft: TodoDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(source?.title ?? '');
  const [status, setStatus] = useState<TodoStatus>(source?.status ?? initialStatus);
  const [scheduledAt, setScheduledAt] = useState(source?.scheduledAt ?? '');
  const [tags, setTags] = useState(
    source ? source.todoTags.map((tag) => '#' + tag).join(' ') : initialTag ? '#' + initialTag : '',
  );
  const [mode, setMode] = useState<TodoTarget['mode']>(initialNodeId ? 'existing' : 'inbox');
  const [destination, setDestination] = useState(initialNodeId ?? '');
  const [assigning, setAssigning] = useState(field === 'target');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(() => (assigning ? destinations(domain) : []), [domain, assigning]);
  const destinationName = domain.nodes.find((node) => node.id === destination)?.title;

  return (
    <form
      className="wst-todo-inline"
      aria-label={source ? '编辑 TODO' : '添加 TODO'}
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
        const parsed = tags
          .split(/[\s,，、]+/)
          .filter(Boolean)
          .map((tag) => tag.replace(/^#/, ''));
        if (parsed.some((tag) => !TagSchema.safeParse(tag).success)) {
          setError('标签可用文字、数字、下划线和连字符。');
          return;
        }
        const target: TodoTarget =
          mode === 'existing'
            ? { mode, nodeId: destination }
            : mode === 'new'
              ? { mode, parentId: destination }
              : { mode };
        setSaving(true);
        setError('');
        try {
          await onSave({ title, status, scheduledAt: scheduledAt || null, tags: parsed, target });
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
            autoFocus={field === 'title'}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="未命名 TODO"
          />
        </label>
        <label className="wst-field">
          日期
          <input
            autoFocus={field === 'date'}
            type="date"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>
        <label className="wst-field">
          TODO 标签
          <input
            autoFocus={field === 'tags'}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="#实验 #招募"
          />
        </label>
        <label className="wst-field">
          状态
          <select
            autoFocus={field === 'status'}
            value={status}
            onChange={(event) => setStatus(event.target.value as TodoStatus)}
          >
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
            {saving ? '正在保存…' : source ? '保存' : '添加'}
          </button>
        </div>
      </div>
      {assigning && (
        <fieldset className="wst-todo-assignment-fields" disabled={saving}>
          <label className="wst-field">
            分配方式
            <select
              autoFocus={field === 'target'}
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
          {mode === 'inbox' && source?.source === 'markdown' && (
            <p className="wst-todo-form-note">保存后，此事项将从原笔记移到待分配区。</p>
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
