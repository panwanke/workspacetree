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
import type { AssetRecord } from '@workspacetree/schema';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownEditor } from './markdown/MarkdownEditor';
import {
  calculateResizeScale,
  resolveEffectiveResizeMode,
  type DragResizeBindings,
  type ResizeModifiers,
} from './node-resize';
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
  assets?: Record<string, AssetRecord>;
  isEditing?: boolean;
  readOnly?: boolean;
  isCut?: boolean;
  resizeMode?: 'box' | 'uniform' | 'branch';
  dragResizeBindings?: DragResizeBindings;
  hasChildren?: boolean;
  onToggleCollapse?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onCommitEdit?: (id: string, title: string, note: string, newAssets?: Record<string, AssetRecord>) => void;
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
  const [draftAssets, setDraftAssets] = useState<Record<string, AssetRecord>>({});
  const [modifierKeys, setModifierKeys] = useState<ResizeModifiers>({
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  });
  const [resizeTooltip, setResizeTooltip] = useState<string | null>(null);

  useEffect(() => {
    if (data.isEditing) {
      setTitleDraft(data.title);
      setNoteDraft(data.note ?? '');
    }
  }, [data.isEditing, data.title, data.note]);

  useEffect(() => {
    if (!selected || data.isEditing || data.readOnly) {
      setModifierKeys({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
      return;
    }
    const updateModifiers = (event: KeyboardEvent) => {
      setModifierKeys({
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
    };
    window.addEventListener('keydown', updateModifiers);
    window.addEventListener('keyup', updateModifiers);
    return () => {
      window.removeEventListener('keydown', updateModifiers);
      window.removeEventListener('keyup', updateModifiers);
    };
  }, [selected, data.isEditing, data.readOnly]);

  const effectiveResize = resolveEffectiveResizeMode(
    data.resizeMode ?? 'box',
    modifierKeys,
    data.dragResizeBindings,
  );

  // 缩小时自动补偿标题字号：无论是节点自身 scale < 1 还是画布缩小（zoom < 0.75），标题都保持清晰可读。
  const zoomBoost = zoom < 0.75 ? Math.min(2.6, 0.75 / Math.max(0.18, zoom)) : 1;
  const baseTitlePx = Math.max(13, 14 * Math.min(1.25, Math.max(0.95, data.scale)));
  const titleFontSize = `${Math.round(baseTitlePx * zoomBoost * 10) / 10}px`;

  const cardStyle = {
    '--wst-card-accent': accent,
    fontSize: data.isEditing ? '13px' : `${data.lod === 'summary' ? 0.9 : data.scale}em`,
    padding: data.isEditing
      ? '10px 12px'
      : data.lod === 'summary'
        ? '6px 10px'
        : `${Math.max(7, 10 * data.scale)}px ${Math.max(9, 12 * data.scale)}px`,
  } as CSSProperties;

  const primaryPosition = horizontal ? Position.Right : Position.Bottom;

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
        isVisible={Boolean(selected || data.isEditing) && !data.readOnly}
        minWidth={data.isEditing ? 360 : (effectiveResize.mode === 'branch' ? 22 : 77)}
        maxWidth={data.isEditing ? 1400 : 560}
        minHeight={data.isEditing ? 200 : (effectiveResize.mode === 'branch' ? 16 : 36)}
        maxHeight={data.isEditing ? 1000 : 380}
        keepAspectRatio={!data.isEditing && effectiveResize.isProportional}
        lineClassName="wst-resizer-line"
        handleClassName="wst-resizer-handle"
        onResize={(event, params) => {
          if (data.isEditing) {
            setResizeTooltip(
              `📐 编辑尺寸: ${Math.round(params.width)} × ${Math.round(params.height)}`,
            );
            return;
          }
          const mouse = event.sourceEvent as MouseEvent | undefined;
          const currentModifiers: Partial<ResizeModifiers> = mouse
            ? {
                shiftKey: mouse.shiftKey,
                altKey: mouse.altKey,
                ctrlKey: mouse.ctrlKey,
                metaKey: mouse.metaKey,
              }
            : modifierKeys;
          const current = resolveEffectiveResizeMode(
            data.resizeMode ?? 'box',
            currentModifiers,
            data.dragResizeBindings,
          );
          const branchKey = data.dragResizeBindings?.resizeBranch ?? 'Alt';
          const nodeKey = data.dragResizeBindings?.resizeNodeScale ?? 'Ctrl';
          const propKey = data.dragResizeBindings?.resizeProportional ?? 'Shift';

          if (current.mode === 'branch') {
            const scale = calculateResizeScale(params.width, 'branch', current.snap);
            setResizeTooltip(
              `🌱 分支缩放: ${scale}x (${branchKey})${current.snap ? ' [吸附]' : ''}`,
            );
          } else if (current.mode === 'uniform') {
            const scale = calculateResizeScale(params.width, 'node', current.snap);
            setResizeTooltip(`🔍 节点缩放: ${scale}x (${nodeKey})${current.snap ? ' [吸附]' : ''}`);
          } else if (current.isProportional) {
            setResizeTooltip(
              `📐 等比尺寸: ${Math.round(params.width)} × ${Math.round(params.height)} (${propKey})`,
            );
          } else {
            setResizeTooltip(
              `📐 方框尺寸: ${Math.round(params.width)} × ${Math.round(params.height)}`,
            );
          }
        }}
        onResizeEnd={(event, params) => {
          setResizeTooltip(null);
          if (data.isEditing) {
            data.onResizeBox?.(id, Math.round(params.width), Math.round(params.height));
            return;
          }
          const mouse = event.sourceEvent as MouseEvent | undefined;
          const endModifiers: Partial<ResizeModifiers> = mouse
            ? {
                shiftKey: mouse.shiftKey,
                altKey: mouse.altKey,
                ctrlKey: mouse.ctrlKey,
                metaKey: mouse.metaKey,
              }
            : modifierKeys;
          const final = resolveEffectiveResizeMode(
            data.resizeMode ?? 'box',
            endModifiers,
            data.dragResizeBindings,
          );
          if (final.mode === 'box') {
            data.onResizeBox?.(id, Math.round(params.width), Math.round(params.height));
            return;
          }
          const kind = final.mode === 'branch' ? 'branch' : 'node';
          const nextScale = calculateResizeScale(params.width, kind, final.snap);
          data.onResizeScale?.(id, nextScale, kind);
        }}
      />
      {resizeTooltip && <div className="wst-resize-tooltip nodrag nopan">{resizeTooltip}</div>}
      {!data.isEditing && data.startAt && (
        <span className="wst-card-border-date" title={`开始日期：${data.startAt}`}>
          {data.startAt}
        </span>
      )}
      {!data.isEditing &&
        Object.values(Position).flatMap((position) =>
          (['source', 'target'] as const).map((type) => {
            const isPrimary = type === 'source' && position === primaryPosition;
            return (
              <Handle
                key={`${type}-${position}`}
                id={`${type}-${position}`}
                type={type}
                position={position}
                isConnectable={!data.readOnly && !data.isEditing}
                isConnectableStart={!data.readOnly && !data.isEditing}
                isConnectableEnd={!data.readOnly && !data.isEditing}
                className={`wst-handle${isPrimary ? ' is-primary' : ''}`}
                title={isPrimary ? '拖拽连接到其他节点' : undefined}
              />
            );
          }),
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
                data.onCommitEdit?.(id, titleDraft.trim() || data.title, noteDraft, draftAssets);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                data.onCancelEdit?.();
              }
            }}
          />
          <MarkdownEditor
            value={noteDraft}
            assets={data.assets}
            onChange={(val) => setNoteDraft(val)}
            onAssetsChange={(assets) => setDraftAssets(assets)}
            onSave={(assets) =>
              data.onCommitEdit?.(
                id,
                titleDraft.trim() || data.title,
                noteDraft,
                assets ?? draftAssets,
              )
            }
            onCancel={() => data.onCancelEdit?.()}
            autoFocus={false}
            placeholder="例如 - [ ] 核对招募条件 #招募"
          />
          <div className="wst-card-edit-actions">
            <button
              type="button"
              className="wst-card-btn-cancel"
              onClick={() => data.onCancelEdit?.()}
            >
              取消
            </button>
            <button
              type="button"
              className="wst-card-btn-save"
              onClick={() =>
                data.onCommitEdit?.(
                  id,
                  titleDraft.trim() || data.title,
                  noteDraft,
                  draftAssets,
                )
              }
            >
              保存
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
            <MarkdownPreview
              markdown={data.note}
              assets={data.assets}
              className="wst-card-markdown"
              maxLines={8}
            />
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
