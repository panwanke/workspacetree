import { useEffect, useMemo, useState } from 'react';
import { resolveEdgeStyle, type ResolvedEdgeStyle, type VisualEdge } from '@workspacetree/layout';
import type { BranchFile, Edge, EdgeStyle } from '@workspacetree/schema';
import { relationLabels } from './ConnectionDialog';
import {
  addRecentEdgeColor,
  EDGE_PRESET_COLORS,
  loadRecentEdgeColors,
  saveRecentEdgeColors,
} from './edge-colors';
import { WorkspaceIcon } from './WorkspaceIcon';

export interface EdgeInspectorProps {
  file: BranchFile;
  visual: VisualEdge;
  edges: readonly Edge[];
  focusEdgeId: string | null;
  readOnly: boolean;
  clipboard: ResolvedEdgeStyle | null;
  onLocateNode: (id: string) => void;
  onEditConnection: (edge: Edge) => void;
  onMoveBranch: (nodeId: string) => void;
  onDetach: (nodeId: string) => void;
  onDeleteEdge: (edge: Edge) => void;
  onRevealEdge: (edge: Edge) => void;
  onSetNote: (edge: Edge, note: string) => void;
  onApplyStyle: (edgeId: string, style: EdgeStyle | null) => void;
  onCopyStyle: (style: ResolvedEdgeStyle) => void;
  onOpenBatch: () => void;
  onDraftChange: (dirty: boolean) => void;
}

const lineStyleLabels = {
  solid: '实线',
  dashed: '虚线',
  dotted: '点线',
} as const;

const arrowLabels = {
  none: '无箭头',
  start: '起点箭头',
  end: '终点箭头',
  both: '两端箭头',
} as const;

function toEditableStyle(style: ResolvedEdgeStyle): EdgeStyle {
  return {
    color: style.color,
    width: style.width,
    lineStyle: style.lineStyle,
    arrow: style.arrow,
  };
}

function styleSignature(style: EdgeStyle): string {
  return JSON.stringify([
    style.color ?? null,
    style.width ?? null,
    style.lineStyle ?? null,
    style.arrow ?? null,
  ]);
}

export default function EdgeInspector(props: EdgeInspectorProps) {
  const { file, visual, edges, focusEdgeId, readOnly, clipboard } = props;
  const names = useMemo(
    () => new Map(file.domain.nodes.map((node) => [node.id, node.title || node.id])),
    [file.domain.nodes],
  );
  const byId = useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges]);
  const directEdge = edges.length === 1 && byId.has(edges[0]!.id) ? edges[0] : undefined;
  const target =
    (focusEdgeId ? byId.get(focusEdgeId) : undefined) ?? (visual.direct ? directEdge : undefined);
  const baseStyle = target
    ? resolveEdgeStyle(target.type, file.presentation.edgeStyles?.[target.id])
    : undefined;
  const initialStyle = baseStyle ?? resolveEdgeStyle(visual.type);
  const [draft, setDraft] = useState<EdgeStyle>(() => toEditableStyle(initialStyle));
  const [draftEdgeId, setDraftEdgeId] = useState<string | null>(target?.id ?? null);
  const [baseSignature, setBaseSignature] = useState(() =>
    baseStyle ? styleSignature(toEditableStyle(baseStyle)) : '',
  );
  const [conflict, setConflict] = useState(false);
  const [noteDraft, setNoteDraft] = useState(target?.note ?? '');
  const [recentColors, setRecentColors] = useState<string[]>(() => loadRecentEdgeColors());
  const dirty = Boolean(target && styleSignature(draft) !== baseSignature);

  const currentSignature = baseStyle ? styleSignature(toEditableStyle(baseStyle)) : '';
  useEffect(() => {
    if (!target || !baseStyle) {
      setDraftEdgeId(null);
      props.onDraftChange(false);
      return;
    }
    if (draftEdgeId !== target.id) {
      setDraft(toEditableStyle(baseStyle));
      setDraftEdgeId(target.id);
      setBaseSignature(currentSignature);
      setConflict(false);
      setNoteDraft(target.note ?? '');
      props.onDraftChange(false);
      return;
    }
    if (currentSignature !== baseSignature) {
      if (dirty) {
        setConflict(true);
        props.onDraftChange(true);
      } else {
        setDraft(toEditableStyle(baseStyle));
        setBaseSignature(currentSignature);
        setConflict(false);
        props.onDraftChange(false);
      }
      return;
    }
    props.onDraftChange(dirty);
  }, [target?.id, currentSignature, baseSignature, dirty, draftEdgeId, props.onDraftChange]);

  const preview = draft.color
    ? resolveEdgeStyle(target?.type ?? visual.type, draft)
    : resolveEdgeStyle(target?.type ?? visual.type);
  const currentColor = (draft.color ?? preview.color).toLowerCase();
  const selectColor = (color: string): void => {
    const normalized = color.toLowerCase();
    setDraft((previous) => ({ ...previous, color: normalized }));
    setRecentColors((previous) => {
      const next = addRecentEdgeColor(previous, normalized);
      saveRecentEdgeColors(next);
      return next;
    });
  };
  const markerId = `edge-preview-${visual.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const endpointButton = (id: string, label: string) => (
    <button
      type="button"
      className="wst-tool wst-edge-endpoint"
      onClick={() => props.onLocateNode(id)}
      title={id}
    >
      {names.get(id) ?? id} <span className="wst-muted">({label})</span>
    </button>
  );

  return (
    <div className="wst-inspector-scroll" data-testid="edge-inspector">
      <div className="wst-inspector-identity">
        <div className="wst-muted">连线属性</div>
        <div className="wst-node-heading">
          <h3>{relationLabels[visual.type]}</h3>
        </div>
        <div className="wst-muted">
          {visual.aggregatedCount > 1
            ? `聚合了 ${visual.aggregatedCount} 条原始关系`
            : visual.direct
              ? '直接连线'
              : '折叠重定向连线'}
        </div>
        {visual.mixedStyleFields.length > 0 && (
          <p className="wst-edge-mixed">混合样式：{visual.mixedStyleFields.join('、')}</p>
        )}
      </div>

      {!target && (
        <section className="wst-inspector-section">
          <h4>原始关系</h4>
          <p className="wst-muted">展开其中一条关系以查看和编辑属性。</p>
          {edges.map((edge) => (
            <div className="wst-edge-source-row" key={edge.id}>
              <div>
                <strong>{names.get(edge.fromNodeId) ?? edge.fromNodeId}</strong> →{' '}
                <strong>{names.get(edge.toNodeId) ?? edge.toNodeId}</strong>
                <div className="wst-muted">{edge.note || '无备注'}</div>
              </div>
              <button type="button" className="wst-tool" onClick={() => props.onRevealEdge(edge)}>
                展开并编辑
              </button>
            </div>
          ))}
        </section>
      )}

      {target && (
        <>
          <section className="wst-inspector-section">
            <h4>关系</h4>
            <div className="wst-edge-endpoints">
              {endpointButton(target.fromNodeId, target.type === 'hierarchy' ? '母节点' : '起点')}
              <span aria-hidden="true">→</span>
              {endpointButton(target.toNodeId, target.type === 'hierarchy' ? '子节点' : '终点')}
            </div>
            {target.role && <p className="wst-muted">层级角色：{target.role}</p>}
            <label className="wst-field">
              备注
              <input
                type="text"
                value={noteDraft}
                disabled={readOnly}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
            </label>
            {!readOnly && noteDraft !== (target.note ?? '') && (
              <button
                type="button"
                className="wst-tool is-accent"
                onClick={() => props.onSetNote(target, noteDraft)}
              >
                保存备注
              </button>
            )}
            <div className="wst-edge-actions">
              {!readOnly && target.type !== 'hierarchy' && (
                <button
                  type="button"
                  className="wst-tool"
                  onClick={() => props.onEditConnection(target)}
                >
                  编辑关系
                </button>
              )}
              {!readOnly && target.type === 'hierarchy' && (
                <>
                  <button
                    type="button"
                    className="wst-tool"
                    onClick={() => props.onMoveBranch(target.toNodeId)}
                  >
                    更换母节点
                  </button>
                  <button
                    type="button"
                    className="wst-tool"
                    onClick={() => props.onDetach(target.toNodeId)}
                  >
                    解除父子连接
                  </button>
                </>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="wst-tool is-danger"
                  onClick={() => props.onDeleteEdge(target)}
                >
                  {target.type === 'hierarchy' ? '解除父子连接' : '删除关联'}
                </button>
              )}
            </div>
            <code className="wst-edge-id" title={target.id}>
              {target.id}
            </code>
          </section>

          <section className="wst-inspector-section">
            <h4>外观</h4>
            <svg className="wst-edge-preview" viewBox="0 0 240 40" aria-label="连线样式预览">
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={preview.color} />
                </marker>
              </defs>
              <path
                d="M 16 20 C 80 20 160 20 224 20"
                stroke={preview.color}
                strokeWidth={preview.width}
                strokeDasharray={preview.dashArray}
                strokeLinecap={preview.lineStyle === 'dotted' ? 'round' : undefined}
                fill="none"
                markerStart={
                  preview.arrow === 'start' || preview.arrow === 'both'
                    ? `url(#${markerId})`
                    : undefined
                }
                markerEnd={
                  preview.arrow === 'end' || preview.arrow === 'both'
                    ? `url(#${markerId})`
                    : undefined
                }
              />
            </svg>
            <div className="wst-edge-color-section">
              <span className="wst-edge-color-label">颜色</span>
              <div className="wst-edge-color-presets" aria-label="常用颜色">
                {EDGE_PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`wst-edge-color-swatch${
                      currentColor === color.value ? ' is-selected' : ''
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                    aria-label={`使用${color.name} ${color.value}`}
                    aria-pressed={currentColor === color.value}
                    disabled={readOnly}
                    onClick={() => selectColor(color.value)}
                  />
                ))}
              </div>
              <span className="wst-edge-color-label">自定义 / 最近使用</span>
              <div className="wst-edge-color-presets" aria-label="自定义或最近使用的颜色">
                {recentColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`wst-edge-color-swatch${
                      currentColor === color ? ' is-selected' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`使用自定义颜色 ${color}`}
                    aria-pressed={currentColor === color}
                    disabled={readOnly}
                    onClick={() => selectColor(color)}
                  />
                ))}
                <label
                  className="wst-edge-color-add"
                  title="添加自定义颜色"
                  aria-label="添加自定义颜色"
                >
                  <input
                    type="color"
                    value={currentColor}
                    disabled={readOnly}
                    aria-label="添加自定义颜色"
                    onChange={(event) => selectColor(event.target.value)}
                  />
                  <span aria-hidden="true">+</span>
                </label>
              </div>
            </div>
            <div className="wst-edge-style-grid">
              <label className="wst-field">
                粗细
                <input
                  type="number"
                  min={0.5}
                  max={12}
                  step={0.5}
                  value={draft.width ?? preview.width}
                  disabled={readOnly}
                  onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })}
                />
              </label>
              <label className="wst-field">
                线型
                <select
                  value={draft.lineStyle ?? preview.lineStyle}
                  disabled={readOnly}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      lineStyle: event.target.value as EdgeStyle['lineStyle'],
                    })
                  }
                >
                  {Object.entries(lineStyleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wst-field">
                箭头
                <select
                  value={draft.arrow ?? preview.arrow}
                  disabled={readOnly}
                  onChange={(event) =>
                    setDraft({ ...draft, arrow: event.target.value as EdgeStyle['arrow'] })
                  }
                >
                  {Object.entries(arrowLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {conflict && (
              <p className="wst-modal-error" role="alert">
                样式已在外部更新，请载入最新或再次应用当前草稿。
              </p>
            )}
            {!readOnly && (
              <div className="wst-edge-actions">
                <button
                  type="button"
                  className="wst-tool is-accent"
                  disabled={!dirty}
                  onClick={() => {
                    props.onApplyStyle(target.id, draft);
                    setBaseSignature(styleSignature(draft));
                    setConflict(false);
                    props.onDraftChange(false);
                  }}
                >
                  应用样式
                </button>
                <button
                  type="button"
                  className="wst-tool"
                  disabled={!file.presentation.edgeStyles?.[target.id]}
                  onClick={() => {
                    props.onApplyStyle(target.id, null);
                    const fallback = resolveEdgeStyle(target.type);
                    setDraft(toEditableStyle(fallback));
                    setBaseSignature(styleSignature(toEditableStyle(fallback)));
                    setConflict(false);
                    props.onDraftChange(false);
                  }}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className="wst-tool"
                  onClick={() => props.onCopyStyle(toEditableStyle(preview) as ResolvedEdgeStyle)}
                >
                  复制样式
                </button>
                <button
                  type="button"
                  className="wst-tool"
                  disabled={!clipboard}
                  onClick={() => {
                    if (!clipboard) return;
                    const next = toEditableStyle(clipboard);
                    props.onApplyStyle(target.id, next);
                    setDraft(next);
                    setBaseSignature(styleSignature(next));
                    setConflict(false);
                    props.onDraftChange(false);
                  }}
                >
                  粘贴样式
                </button>
                <button type="button" className="wst-tool" onClick={props.onOpenBatch}>
                  批量应用
                </button>
              </div>
            )}
          </section>

          {edges.length > 1 && (
            <section className="wst-inspector-section">
              <h4>聚合来源（{edges.length}）</h4>
              {edges.map((edge) => (
                <div className="wst-edge-source-row" key={edge.id}>
                  <div>
                    <strong>{names.get(edge.fromNodeId) ?? edge.fromNodeId}</strong> →{' '}
                    <strong>{names.get(edge.toNodeId) ?? edge.toNodeId}</strong>
                    <div className="wst-muted">{edge.note || '无备注'}</div>
                  </div>
                  <div className="wst-edge-actions">
                    <button
                      type="button"
                      className="wst-tool"
                      onClick={() => props.onRevealEdge(edge)}
                    >
                      展开并编辑
                    </button>
                    {!readOnly && clipboard && (
                      <button
                        type="button"
                        className="wst-tool"
                        onClick={() => {
                          if (window.confirm('仅将样式应用到这条原始关系？')) {
                            props.onApplyStyle(edge.id, toEditableStyle(clipboard));
                          }
                        }}
                      >
                        应用到此条
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {readOnly && (
        <p className="wst-muted">
          <WorkspaceIcon name="tree" size={14} /> 只读项目：可查看、定位和复制样式。
        </p>
      )}
    </div>
  );
}
