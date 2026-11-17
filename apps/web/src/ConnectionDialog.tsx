import { useEffect, useMemo, useRef, useState } from 'react';
import { buildHierarchy } from '@workspacetree/layout';
import type { DomainState, EdgeType } from '@workspacetree/schema';
import { subtreeIds } from './branch-editing';

export type ConnectionRequest =
  | { kind: 'move'; nodeId: string }
  | { kind: 'adopt'; nodeId: string }
  | {
      kind: 'relation';
      fromNodeId: string;
      toNodeId: string;
      edgeId?: string;
      allowHierarchy?: boolean;
    };

export const relationLabels = {
  hierarchy: '父子归属',
  dependency: '依赖',
  reference: '引用',
  custom: '自定义',
} satisfies Record<EdgeType, string>;

export function relationDescription(type: EdgeType, source: string, target: string): string {
  switch (type) {
    case 'hierarchy':
      return `把 ${target} 挂到 ${source}`;
    case 'dependency':
      return `${target} 依赖 ${source}`;
    case 'reference':
      return `${target} 引用 ${source}`;
    case 'custom':
      return `${source} → ${target}`;
  }
}

interface NodeOption {
  id: string;
  path: string;
}

function NodePicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: NodeOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const matches = options.filter(
    ({ id, path }) => id === value || path.toLowerCase().includes(search),
  );
  return (
    <div className="wst-connection-picker">
      <label className="wst-field">
        {label}
        <input
          type="search"
          aria-label={`搜索${label}`}
          placeholder="搜索名称或路径"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery('');
        }}
      >
        <option value="">{matches.length ? `选择${label}` : '没有匹配的节点'}</option>
        {matches.map(({ id, path }) => (
          <option key={id} value={id}>
            {path}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ConnectionDialog({
  domain,
  request,
  onClose,
  onSave,
}: {
  domain: DomainState;
  request: ConnectionRequest;
  onClose: () => void;
  onSave: (values: {
    fromNodeId: string;
    toNodeId: string;
    type: EdgeType;
    note: string;
    keepPosition: boolean;
  }) => Promise<void>;
}) {
  const original =
    request.kind === 'relation' && domain.edges.find(({ id }) => id === request.edgeId);
  const [source, setSource] = useState(
    request.kind === 'move' ? '' : request.kind === 'adopt' ? request.nodeId : request.fromNodeId,
  );
  const [target, setTarget] = useState(
    request.kind === 'adopt' ? '' : request.kind === 'move' ? request.nodeId : request.toNodeId,
  );
  const [type, setType] = useState<EdgeType>(
    request.kind === 'relation' ? (original ? original.type : 'dependency') : 'hierarchy',
  );
  const [note, setNote] = useState(original ? (original.note ?? '') : '');
  const [keepPosition, setKeepPosition] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const { parents, children, options, names } = useMemo(() => {
    const tree = buildHierarchy(domain.nodes, domain.edges);
    const names = new Map(domain.nodes.map(({ id, title }) => [id, title || id]));
    const options = domain.nodes.map(({ id }) => {
      const path = [];
      for (
        let cursor: string | null = id;
        cursor !== null;
        cursor = tree.parents.get(cursor) ?? null
      ) {
        path.push(names.get(cursor));
      }
      return { id, path: path.reverse().join(' / ') };
    });
    return { ...tree, options, names };
  }, [domain]);

  const hierarchy = type === 'hierarchy';
  const subtree = useMemo(
    () => (hierarchy && target ? subtreeIds(children, target) : []),
    [children, hierarchy, target],
  );
  const excludedParents = new Set(subtree);
  const sources = options.filter(({ id }) => id !== target && !excludedParents.has(id));
  const targets = options.filter(({ id }) => {
    if (id === source) return false;
    if (!hierarchy) return true;
    if (id === domain.project.rootNodeId || parents.get(id) === source) return false;
    for (let cursor = parents.get(source); cursor; cursor = parents.get(cursor)) {
      if (cursor === id) return false;
    }
    return true;
  });
  const valid = Boolean(
    source &&
    target &&
    sources.some(({ id }) => id === source) &&
    targets.some(({ id }) => id === target),
  );
  const title =
    request.kind === 'move'
      ? '挂到母节点'
      : request.kind === 'adopt'
        ? '接入已有分支'
        : original
          ? '编辑关联'
          : '新建连线';
  const branchParent = target && parents.get(target);

  return (
    <dialog
      ref={dialog}
      className="wst-settings-modal wst-connection-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          setError('');
          try {
            await onSave({ fromNodeId: source, toNodeId: target, type, note, keepPosition });
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setSaving(false);
          }
        }}
      >
        <div className="wst-modal-header">
          <h2>{title}</h2>
        </div>
        <div className="wst-modal-body">
          {request.kind === 'relation' && (
            <label className="wst-field">
              关系类型
              <select value={type} onChange={(event) => setType(event.target.value as EdgeType)}>
                {Object.entries(relationLabels)
                  .filter(([type]) => type !== 'hierarchy' || request.allowHierarchy)
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {request.kind !== 'adopt' && (
            <NodePicker
              label={hierarchy ? '母节点' : '起点'}
              options={sources}
              value={source}
              onChange={setSource}
            />
          )}
          {request.kind !== 'move' && (
            <NodePicker
              label={hierarchy ? '要接入的节点或分支' : '终点'}
              options={targets}
              value={target}
              onChange={setTarget}
            />
          )}
          {request.kind === 'relation' && source && target && (
            <button
              type="button"
              className="wst-tool"
              onClick={() => {
                setSource(target);
                setTarget(source);
              }}
            >
              交换两端
            </button>
          )}
          {hierarchy ? (
            <label className="wst-connection-position">
              <input
                type="checkbox"
                checked={keepPosition}
                onChange={(event) => setKeepPosition(event.target.checked)}
              />{' '}
              原位挂接
            </label>
          ) : (
            <label className="wst-field">
              备注
              <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
          {valid && (
            <p className="wst-connection-preview">
              {relationDescription(type, names.get(source)!, names.get(target)!)}
              {hierarchy &&
                `（共 ${subtree.length} 个节点${branchParent ? `，原母节点为 ${names.get(branchParent)}` : '，当前为独立分支'}）`}
            </p>
          )}
          {error && (
            <p className="wst-modal-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="wst-modal-footer">
          <button className="wst-tool" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="wst-tool is-accent" type="submit" disabled={!valid || saving}>
            {hierarchy ? '挂接' : '保存连线'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
