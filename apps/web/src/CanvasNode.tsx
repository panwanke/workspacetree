import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { MarkdownEditor } from './markdown/MarkdownEditor';
import {
  calculateResizeScale,
  resolveEffectiveResizeMode,
  type DragResizeBindings,
  type ResizeModifiers,
} from './node-resize';
import { TagList } from './TagList';

type SaveDraft = (
  id: string,
  title: string,
  note: string,
  baseNote: string,
  assets?: Record<string, AssetRecord>,
) => Promise<boolean>;

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
  onSaveDraft?: SaveDraft;
  onFinishEdit?: (id: string) => void;
  onCancelEdit?: () => void;
  onResizeBox?: (id: string, width: number, height: number) => void;
  onResizeScale?: (
    id: string,
    scale: number,
    kind: 'node' | 'branch' | 'node-visual' | 'branch-visual',
  ) => void;
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

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isCancellingRef = useRef(false);
  const committingRef = useRef(false);
  const autoSaveRef = useRef<Promise<void> | null>(null);
  const wasEditingRef = useRef(false);
  const titleDraftRef = useRef(titleDraft);
  const noteDraftRef = useRef(noteDraft);
  const draftAssetsRef = useRef(draftAssets);
  const lastSavedSnapshotRef = useRef<{
    title: string;
    note: string;
    assets: Record<string, AssetRecord>;
  }>({
    title: data.title,
    note: data.note ?? '',
    assets: {},
  });

  titleDraftRef.current = titleDraft;
  noteDraftRef.current = noteDraft;
  draftAssetsRef.current = draftAssets;

  useEffect(() => {
    if (data.isEditing && !wasEditingRef.current) {
      setTitleDraft(data.title);
      setNoteDraft(data.note ?? '');
      setDraftAssets({});
      titleDraftRef.current = data.title;
      noteDraftRef.current = data.note ?? '';
      draftAssetsRef.current = {};
      lastSavedSnapshotRef.current = {
        title: data.title,
        note: data.note ?? '',
        assets: {},
      };
      isCancellingRef.current = false;
    }
    wasEditingRef.current = Boolean(data.isEditing);
  }, [data.isEditing, data.title, data.note]);

  // 提交并保存当前草稿
  const commitCurrentDraft = useCallback(() => {
    if (isCancellingRef.current || committingRef.current) return;
    committingRef.current = true;
    void (async () => {
      try {
        if (autoSaveRef.current) await autoSaveRef.current;
        if (isCancellingRef.current) return;
        const title = titleDraftRef.current.trim() || data.title;
        const note = noteDraftRef.current;
        const assets = draftAssetsRef.current;
        const saved = await data.onSaveDraft?.(
          id,
          title,
          note,
          lastSavedSnapshotRef.current.note,
          assets,
        );
        if (!saved) return;
        lastSavedSnapshotRef.current = { title, note, assets };
        if (
          (titleDraftRef.current.trim() || data.title) === title &&
          noteDraftRef.current === note &&
          draftAssetsRef.current === assets
        ) {
          data.onFinishEdit?.(id);
        }
      } finally {
        committingRef.current = false;
      }
    })();
  }, [data, id]);

  // 离开节点自动保存：在编辑状态下，点击编辑器外部时自动保存并退出编辑
  useEffect(() => {
    if (!data.isEditing || !data.autoSaveEnabled) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (isCancellingRef.current) return;
      const container = editorContainerRef.current;
      if (!container) return;

      if (event.target && !container.contains(event.target as unknown as globalThis.Node)) {
        commitCurrentDraft();
      }
    };

    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [data.isEditing, data.autoSaveEnabled, commitCurrentDraft]);

  // 每 5s 自动保存：在编辑过程中持续保存草稿到项目中，且不退出编辑状态
  useEffect(() => {
    if (!data.isEditing || !data.autoSaveEnabled || !data.onSaveDraft) return;

    const intervalMs = data.autoSaveInterval ?? 5000;
    const save = data.onSaveDraft;
    const timer = setInterval(() => {
      if (isCancellingRef.current || committingRef.current || autoSaveRef.current) return;
      const currentTitle = titleDraftRef.current.trim() || data.title;
      const currentNote = noteDraftRef.current;
      const currentAssets = draftAssetsRef.current;
      const last = lastSavedSnapshotRef.current;

      const hasChanged =
        currentTitle !== last.title ||
        currentNote !== last.note ||
        JSON.stringify(currentAssets) !== JSON.stringify(last.assets);

      if (hasChanged) {
        autoSaveRef.current = save(id, currentTitle, currentNote, last.note, currentAssets)
          .then((saved) => {
            if (saved) {
              lastSavedSnapshotRef.current = {
                title: currentTitle,
                note: currentNote,
                assets: { ...currentAssets },
              };
            }
          })
          .finally(() => {
            autoSaveRef.current = null;
          });
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [
    data.isEditing,
    data.autoSaveEnabled,
    data.autoSaveInterval,
    id,
    data.title,
    data.onSaveDraft,
  ]);

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
  const effLayout = data.effectiveLayoutScale ?? data.scale ?? 1;
  const effVisual = data.effectiveVisualScale ?? 1;
  const baseTitlePx = Math.max(13, 14 * Math.min(1.25, Math.max(0.95, effLayout)));
  const titleFontSize = `${Math.round(baseTitlePx * zoomBoost * 10) / 10}px`;
  const hasNote = data.lod === 'full' && Boolean(data.note?.trim());
  const note = hasNote && (selected || zoom >= 0.42) ? data.note : undefined;
  const verticalPadding = note ? Math.max(5, 6 * effLayout) : Math.max(7, 10 * effLayout);

  const cardStyle = {
    '--wst-card-accent': accent,
    fontSize: data.isEditing ? '13px' : `${data.lod === 'summary' ? 0.9 : effLayout}em`,
    padding: data.isEditing
      ? '10px 12px'
      : data.lod === 'summary'
        ? '6px 10px'
        : `${verticalPadding}px ${Math.max(9, 12 * effLayout)}px`,
  } as CSSProperties;

  if (!data.isEditing && data.layoutSize && effVisual !== 1) {
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
        isVisible={Boolean(selected || data.isEditing) && !data.readOnly}
        minWidth={data.isEditing ? 360 : effectiveResize.mode === 'branch' ? 22 : 77}
        maxWidth={data.isEditing ? 1400 : 560}
        minHeight={
          data.isEditing
            ? 200
            : effectiveResize.mode === 'branch'
              ? 16
              : effectiveResize.mode === 'box' && hasNote
                ? markdownPreviewMinHeight(effLayout)
                : 36
        }
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
          ref={editorContainerRef}
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
              if (
                (event.key === 'Enter' && !event.shiftKey) ||
                ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
              ) {
                event.preventDefault();
                commitCurrentDraft();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                isCancellingRef.current = true;
                data.onCancelEdit?.();
              }
            }}
          />
          <MarkdownEditor
            value={noteDraft}
            assets={data.assets}
            onChange={(val) => setNoteDraft(val)}
            onAssetsChange={(assets) => setDraftAssets(assets)}
            onSave={(assets) => {
              if (assets) {
                draftAssetsRef.current = assets;
                setDraftAssets(assets);
              }
              commitCurrentDraft();
            }}
            onCancel={() => {
              isCancellingRef.current = true;
              data.onCancelEdit?.();
            }}
            autoFocus={false}
            placeholder="例如 - [ ] 核对招募条件 #招募"
          />
          <div className="wst-card-edit-actions">
            {data.autoSaveEnabled && (
              <div
                className="wst-card-autosave-tip"
                title="离开节点自动保存；持续编辑期间每5秒自动保存"
              >
                <span className="wst-card-autosave-dot" /> 自动保存已开启
              </div>
            )}
            <button
              type="button"
              className="wst-card-btn-cancel"
              onPointerDown={() => {
                isCancellingRef.current = true;
              }}
              onClick={() => {
                isCancellingRef.current = true;
                data.onCancelEdit?.();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="wst-card-btn-save"
              onClick={() => commitCurrentDraft()}
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
          {note && (
            <MarkdownPreview
              markdown={note}
              assets={data.assets}
              className="wst-card-markdown nowheel"
              maxLines={8}
              onToggleTask={data.onToggleTodo}
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
