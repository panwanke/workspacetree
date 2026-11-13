import { useEffect, useState, type CSSProperties } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  useViewport,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { LayoutDirection, VisualLod } from '@workspacetree/layout';
import { MarkdownPreview } from './MarkdownPreview';
import { TagList } from './TagList';

export interface CardNodeData extends Record<string, unknown> {
  title: string;
  note?: string;
  tags?: readonly string[];
  taskTotal: number;
  taskDone: number;
  relationCount: number;
  highlighted: boolean;
  dimmed: boolean;
  archived: boolean;
  direction: LayoutDirection;
  scale: number;
  startAt: string | null;
  locked: boolean;
  collapsed: boolean;
  collapsedCount: number;
  externalConnectionCount: number;
  lod: VisualLod;
  accentColor?: string;
  isEditing?: boolean;
  readOnly?: boolean;
  isCut?: boolean;
  resizeMode?: 'box' | 'uniform' | 'branch';
  hasChildren?: boolean;
  onToggleCollapse?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onCommitEdit?: (id: string, title: string, note: string) => void;
  onCancelEdit?: () => void;
  onResizeBox?: (id: string, width: number, height: number) => void;
  onResizeScale?: (id: string, scale: number, kind: 'node' | 'branch') => void;
}

export type CardNode = Node<CardNodeData, 'card'>;

/** 普通节点与折叠摘要共用卡片；支持 Excalidraw/Canvas 双模式缩放、缩小时标题自动放大与行内 Markdown 编辑。 */
export default function CanvasNode({ id, data, selected }: NodeProps<CardNode>) {
  const horizontal = data.direction === 'horizontal';
  const accent = data.accentColor ?? '#475569';
  const { zoom } = useViewport();
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [noteDraft, setNoteDraft] = useState(data.note ?? '');

  useEffect(() => {
    if (data.isEditing) {
      setTitleDraft(data.title);
      setNoteDraft(data.note ?? '');
    }
  }, [data.isEditing, data.title, data.note]);

  // 缩小时自动补偿标题字号：无论是节点自身 scale < 1 还是画布缩小（zoom < 0.75），标题都保持清晰可读。
  const zoomBoost = zoom < 0.75 ? Math.min(2.6, 0.75 / Math.max(0.18, zoom)) : 1;
  const baseTitlePx = Math.max(13, 14 * Math.min(1.25, Math.max(0.95, data.scale)));
  const titleFontSize = `${Math.round(baseTitlePx * zoomBoost * 10) / 10}px`;

  const cardStyle = {
    '--wst-card-accent': accent,
    fontSize: `${data.lod === 'summary' ? 0.9 : data.scale}em`,
    padding:
      data.lod === 'summary'
        ? '6px 10px'
        : `${Math.max(7, 10 * data.scale)}px ${Math.max(9, 12 * data.scale)}px`,
  } as CSSProperties;

  return (
    <div
      className={`wst-card${selected ? ' is-selected' : ''}${data.highlighted ? ' is-highlighted' : ''}${data.dimmed ? ' is-dimmed' : ''}${data.archived ? ' is-archived' : ''}${data.collapsed ? ' is-collapsed' : ''}${data.lod === 'summary' ? ' is-lod-summary' : ''}${data.isEditing ? ' is-editing' : ''}${data.isCut ? ' is-cut' : ''}`}
      style={cardStyle}
      onDoubleClick={(event) => {
        event.stopPropagation();
        data.onStartEdit?.(id);
      }}
    >
      <NodeResizer
        isVisible={Boolean(selected) && !data.isEditing && !data.readOnly}
        minWidth={77}
        maxWidth={560}
        minHeight={36}
        maxHeight={380}
        keepAspectRatio={data.resizeMode !== 'box'}
        lineClassName="wst-resizer-line"
        handleClassName="wst-resizer-handle"
        onResizeEnd={(_, params) => {
          if (data.resizeMode === 'box') {
            data.onResizeBox?.(id, Math.round(params.width), Math.round(params.height));
            return;
          }
          const kind = data.resizeMode === 'branch' ? 'branch' : 'node';
          const minScale = kind === 'branch' ? 0.1 : 0.35;
          const nextScale = Math.min(
            2,
            Math.max(minScale, Number((params.width / 220).toFixed(2))),
          );
          data.onResizeScale?.(id, nextScale, kind);
        }}
      />
      {data.startAt && (
        <span className="wst-card-border-date" title={`开始日期：${data.startAt}`}>
          {data.startAt}
        </span>
      )}
      {Object.values(Position).flatMap((position) =>
        (['source', 'target'] as const).map((type) => (
          <Handle
            key={`${type}-${position}`}
            id={`${type}-${position}`}
            type={type}
            position={position}
            isConnectable={!data.readOnly}
            isConnectableStart={false}
            isConnectableEnd={!data.readOnly}
            className="wst-handle"
          />
        )),
      )}
      {data.isEditing ? (
        <div
          className="wst-card-editor nodrag nopan nowheel"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <input
            className="wst-card-edit-title"
            value={titleDraft}
            autoFocus
            placeholder="节点标题"
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                data.onCommitEdit?.(id, titleDraft.trim() || data.title, noteDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                data.onCancelEdit?.();
              }
            }}
          />
          <textarea
            className="wst-card-edit-note"
            value={noteDraft}
            rows={4}
            placeholder="例如 - [ ] 核对招募条件 #招募"
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                data.onCommitEdit?.(id, titleDraft.trim() || data.title, noteDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                data.onCancelEdit?.();
              }
            }}
          />
          <div className="wst-card-edit-actions">
            <button
              type="button"
              onClick={() => data.onCommitEdit?.(id, titleDraft.trim() || data.title, noteDraft)}
            >
              保存
            </button>
            <button type="button" onClick={() => data.onCancelEdit?.()}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`wst-card-title${zoomBoost > 1.15 ? ' is-zoom-boosted' : ''}`}
            style={{ fontSize: titleFontSize }}
            title={data.title}
          >
            {data.title}
          </div>
          {data.tags && (
            <TagList tags={data.tags} label="节点标签" limit={data.lod === 'summary' ? 1 : 2} />
          )}
          {data.note && data.lod === 'full' && zoom >= 0.42 && (
            <MarkdownPreview markdown={data.note} className="wst-card-markdown" maxLines={8} />
          )}
        </>
      )}
      {(data.collapsed || zoom >= 0.36) && (
        <div className="wst-card-meta">
          {data.collapsed ? (
            <>
              <span>折叠 {data.collapsedCount} 个节点</span>
              <span>
                任务 {data.taskDone}/{data.taskTotal}
              </span>
              <span>{data.externalConnectionCount} 条外部连接</span>
            </>
          ) : data.lod === 'summary' ? (
            <>
              <span className="wst-badge muted">LOD 摘要</span>
              <span>
                任务 {data.taskDone}/{data.taskTotal}
              </span>
            </>
          ) : (
            <>
              <span>
                任务 {data.taskDone}/{data.taskTotal}
              </span>
              {data.relationCount > 0 && (
                <span className="wst-badge" title="被隐藏的关联边数量">
                  +{data.relationCount} 关联
                </span>
              )}
              {data.locked && <span className="wst-badge muted">手动位置</span>}
              {data.archived && <span className="wst-badge muted">已归档</span>}
            </>
          )}
        </div>
      )}
      {data.hasChildren && !data.readOnly && (
        <button
          type="button"
          aria-label={
            data.collapsed ? `展开分支（已折叠 ${data.collapsedCount} 个节点）` : '折叠分支'
          }
          className={`wst-mindmap-collapse-btn ${data.collapsed ? 'is-collapsed' : 'is-expanded'} ${horizontal ? 'is-horizontal' : 'is-vertical'} nodrag nopan`}
          title={data.collapsed ? `展开分支（已折叠 ${data.collapsedCount} 个节点）` : '折叠分支'}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapse?.(id);
          }}
        >
          {data.collapsed ? (data.collapsedCount > 0 ? `+${data.collapsedCount}` : '+') : '−'}
        </button>
      )}
    </div>
  );
}
