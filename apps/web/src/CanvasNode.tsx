import { useEffect, useState, type CSSProperties } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  useViewport,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  markdownPreviewMinHeight,
  type LayoutDirection,
  type VisualLod,
} from '@workspacetree/layout';
import type { AssetRecord } from '@workspacetree/schema';
import { MarkdownPreview } from './MarkdownPreview';
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
  effectiveLayoutScale?: number;
  effectiveVisualScale?: number;
  layoutScale?: number;
  visualScale?: number;
  branchLayoutScale?: number;
  branchVisualScale?: number;
  layoutSize?: { width: number; height: number };
  visualSize?: { width: number; height: number };
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
  autoSaveEnabled?: boolean;
  autoSaveInterval?: number;
  onToggleCollapse?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onToggleTodo?: (lineIndex: number, checked: boolean) => void;
  onResizeBox?: (id: string, width: number, height: number) => void;
  onResizeScale?: (
    id: string,
    scale: number,
    kind: 'node' | 'branch' | 'node-visual' | 'branch-visual',
  ) => void;
}

export type CardNode = Node<CardNodeData, 'card'>;

/** 普通节点与折叠摘要共用卡片；支持双层缩放架构、动态标题字号补偿与独立编辑浮层交互。 */
export default function CanvasNode({ id, data, selected }: NodeProps<CardNode>) {
  const horizontal = data.direction === 'horizontal';
  const accent = data.accentColor ?? '#475569';
  const { zoom } = useViewport();
  const [modifierKeys, setModifierKeys] = useState<ResizeModifiers>({
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  });
  const [resizeTooltip, setResizeTooltip] = useState<string | null>(null);

  useEffect(() => {
    if (!selected || data.readOnly) {
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
  }, [selected, data.readOnly]);

  const effectiveResize = resolveEffectiveResizeMode(
    data.resizeMode ?? 'box',
    modifierKeys,
    data.dragResizeBindings,
  );

  // 缩小时自动补偿标题字号：无论是节点自身 scale < 1 还是画布缩小（zoom < 0.75），标题都保持清晰可读。
  const zoomBoost = zoom < 0.75 ? Math.min(2.6, 0.75 / Math.max(0.18, zoom)) : 1;
  const effLayout = data.effectiveLayoutScale ?? data.scale ?? 1;
  const effVisual = data.effectiveVisualScale ?? 1;
  const baseTitlePx = Math.max(13, 14 * Math.min(1.25, Math.max(0.95, effLayout)));
  const titleFontSize = `${Math.round(baseTitlePx * zoomBoost * 10) / 10}px`;
  const hasNote = data.lod === 'full' && Boolean(data.note?.trim());
  const note = hasNote && (selected || zoom >= 0.42) ? data.note : undefined;
  const verticalPadding = note ? Math.max(5, 6 * effLayout) : Math.max(7, 10 * effLayout);

  const cardStyle = {
    '--wst-card-accent': accent,
    fontSize: `${data.lod === 'summary' ? 0.9 : effLayout}em`,
    padding:
      data.lod === 'summary'
        ? '6px 10px'
        : `${verticalPadding}px ${Math.max(9, 12 * effLayout)}px`,
  } as CSSProperties;

  // 几何缩放应用：在非编辑状态下应用 transform 缩放，内部尺寸维持 layoutSize，长宽比与换行严格保持
  if (data.layoutSize && effVisual !== 1) {
    cardStyle.width = `${data.layoutSize.width}px`;
    cardStyle.height = `${data.layoutSize.height}px`;
    cardStyle.transform = `scale(${effVisual})`;
    cardStyle.transformOrigin = '0 0';
  }

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
        isVisible={Boolean(selected) && !data.readOnly}
        minWidth={effectiveResize.mode === 'branch' ? 22 : 77}
        maxWidth={560}
        minHeight={
          effectiveResize.mode === 'branch'
            ? 16
            : effectiveResize.mode === 'box' && hasNote
              ? markdownPreviewMinHeight(effLayout)
              : 36
        }
        maxHeight={380}
        keepAspectRatio={effectiveResize.isProportional}
        lineClassName="wst-resizer-line"
        handleClassName="wst-resizer-handle"
        onResize={(event, params) => {
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
      {data.startAt && (
        <span className="wst-card-border-date" title={`开始日期：${data.startAt}`}>
          {data.startAt}
        </span>
      )}
      {!data.readOnly &&
        Object.values(Position).flatMap((position) =>
          (['source', 'target'] as const).map((type) => {
            const isPrimary = type === 'source' && position === primaryPosition;
            return (
              <Handle
                key={`${type}-${position}`}
                id={`${type}-${position}`}
                type={type}
                position={position}
                isConnectable={!data.readOnly}
                isConnectableStart={!data.readOnly}
                isConnectableEnd={!data.readOnly}
                className={`wst-handle${isPrimary ? ' is-primary' : ''}`}
                title={isPrimary ? '拖拽连接到其他节点' : undefined}
              />
            );
          }),
        )}
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
      {note && (
        <MarkdownPreview
          markdown={note}
          assets={data.assets}
          className="wst-card-markdown nowheel"
          maxLines={8}
          onToggleTask={data.onToggleTodo}
        />
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
