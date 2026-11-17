import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveEdgeStyle, type ResolvedEdgeStyle, type VisualEdge } from '@workspacetree/layout';
import type { BranchFile } from '@workspacetree/schema';
import { relationLabels } from './ConnectionDialog';

interface BatchTarget {
  id: string;
  label: string;
  note: string;
  style: ResolvedEdgeStyle;
}

export default function EdgeStyleBatchDialog({
  file,
  graphEdges,
  initialEdgeId,
  clipboard,
  onClose,
  onApply,
}: {
  file: BranchFile;
  graphEdges: readonly VisualEdge[];
  initialEdgeId: string | null;
  clipboard: ResolvedEdgeStyle | null;
  onClose: () => void;
  onApply: (edgeIds: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialEdgeId ? new Set([initialEdgeId]) : new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const names = useMemo(
    () => new Map(file.domain.nodes.map((node) => [node.id, node.title || node.id])),
    [file.domain.nodes],
  );
  const targets = useMemo<BatchTarget[]>(() => {
    const directIds = new Set(
      graphEdges.filter((edge) => edge.direct).flatMap((edge) => edge.originalEdgeIds),
    );
    return file.domain.edges
      .filter((edge) => directIds.has(edge.id))
      .map((edge) => ({
        id: edge.id,
        label: `${relationLabels[edge.type]} · ${names.get(edge.fromNodeId) ?? edge.fromNodeId} → ${
          names.get(edge.toNodeId) ?? edge.toNodeId
        }`,
        note: edge.note ?? '',
        style: resolveEdgeStyle(edge.type, file.presentation.edgeStyles?.[edge.id]),
      }));
  }, [file, graphEdges, names]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? targets.filter((target) =>
        `${target.label} ${target.note}`.toLowerCase().includes(normalizedQuery),
      )
    : targets;

  function toggle(id: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <dialog
      ref={dialog}
      className="wst-settings-modal wst-edge-batch-dialog"
      aria-label="批量应用连线样式"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || selected.size === 0 || !clipboard) return;
          setSaving(true);
          setError('');
          try {
            await onApply([...selected]);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setSaving(false);
          }
        }}
      >
        <div className="wst-modal-header">
          <h2>批量应用连线样式</h2>
        </div>
        <div className="wst-modal-body">
          <p className="wst-muted">
            {clipboard
              ? `将复制的样式（${clipboard.color} / ${clipboard.width}px / ${
                  clipboard.lineStyle
                } / ${clipboard.arrow}）应用到选中的直接连线。`
              : '请先在边属性面板复制样式。'}
          </p>
          <label className="wst-field">
            筛选起点、终点或备注
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="wst-edge-batch-actions">
            <button
              type="button"
              className="wst-tool"
              disabled={filtered.length === 0}
              onClick={() => setSelected(new Set(filtered.map((target) => target.id)))}
            >
              全选当前筛选（{filtered.length}）
            </button>
            <button type="button" className="wst-tool" onClick={() => setSelected(new Set())}>
              清空选择
            </button>
            <span className="wst-muted">已选 {selected.size} 条</span>
          </div>
          <div className="wst-edge-batch-list">
            {filtered.map((target) => (
              <label className="wst-edge-batch-item" key={target.id}>
                <input
                  type="checkbox"
                  checked={selected.has(target.id)}
                  onChange={(event) => toggle(target.id, event.target.checked)}
                />
                <span>
                  <strong>{target.label}</strong>
                  <small>
                    {target.note || '无备注'} · 当前 {target.style.width}px /{' '}
                    {target.style.lineStyle}
                  </small>
                </span>
              </label>
            ))}
            {filtered.length === 0 && <p className="wst-muted">没有符合条件的直接连线。</p>}
          </div>
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
          <button
            className="wst-tool is-accent"
            type="submit"
            disabled={saving || selected.size === 0 || !clipboard}
          >
            应用样式
          </button>
        </div>
      </form>
    </dialog>
  );
}
