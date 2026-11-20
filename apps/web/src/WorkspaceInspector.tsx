import {
  buildHierarchy,
  scaleFromSlider,
  sliderFromScale,
  type LayoutDirection,
  type ResolvedEdgeStyle,
  type VisualEdge,
  type VisualNode,
} from '@workspacetree/layout';
import {
  prependMarkdownTask,
  indexWorkspaceTasks,
  localToday,
  workspaceTaskCounts,
  type WorkspaceTask,
} from '@workspacetree/markdown';
import type { AssetRecord, BranchFile, Edge, EdgeStyle, Node } from '@workspacetree/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { relationDescription, relationLabels, type ConnectionRequest } from './ConnectionDialog';
import type { EditorController } from './editor';
import EdgeInspector from './EdgeInspector';
import {
  clearPositionEntry,
  getNodeNote,
  getNodeNoteBlock,
  removeEdgeEntry,
  renameNodeEntry,
  setBranchScaleEntry,
  setBranchVisualScaleEntry,
  setCollapsedEntry,
  setNodeNoteEntry,
  setNodeScaleEntry,
  setNodeVisualScaleEntry,
  setNodeSizeEntry,
  setNodeTagsEntry,
  setStartAtEntry,
} from './history';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownEditor } from './markdown/MarkdownEditor';
import { TODO_STATUS } from './markdown-todos';
import { TagEditor } from './TagEditor';
import { TagList } from './TagList';
import { saveTodoEntry, updateTodoEntry, type TodoDraft, type TodoSource } from './todo-editing';
import { WorkspaceIcon } from './WorkspaceIcon';

const tabs = [
  ['overview', '概览'],
  ['layout', '布局'],
  ['relations', '关联'],
] as const;

type Guard = (action: () => void | Promise<void>) => void;
export type ScaleKind = 'node' | 'branch' | 'node-visual' | 'branch-visual';
type NodePanelProps = {
  file: BranchFile;
  node: Node;
  visualNode?: VisualNode | null;
  controller: EditorController;
  guard: Guard;
  direction?: LayoutDirection;
  onLocate?: (id: string) => void;
  autoSave?: boolean;
};

interface InspectorProps {
  open: boolean;
  readOnly: boolean;
  inert: boolean;
  file: BranchFile;
  node: Node | null;
  visualNode?: VisualNode | null;
  visualEdge: VisualEdge | null;
  selectedEdges: readonly Edge[];
  focusEdgeId: string | null;
  edgeClipboard: ResolvedEdgeStyle | null;
  selectedCount: number;
  hiddenRelations: number;
  direction: LayoutDirection;
  visibleNodeIds: ReadonlySet<string>;
  controller: EditorController;
  guard: Guard;
  onClose: () => void;
  onConnection: (request: ConnectionRequest) => void;
  onDetach: (id: string) => void;
  onMoveBranch: (id: string) => void;
  onDeleteEdge: (edge: Edge) => void;
  onRevealEdge: (edge: Edge) => void;
  onSetEdgeNote: (edge: Edge, note: string) => void;
  onApplyEdgeStyle: (edgeId: string, style: EdgeStyle | null) => void;
  onCopyEdgeStyle: (style: ResolvedEdgeStyle) => void;
  onOpenEdgeBatch: () => void;
  onEdgeDraftChange: (dirty: boolean) => void;
  onLocate: (id: string) => void;
  onScalePreview: (id: string, kind: ScaleKind, value: number | null) => void;
  onScaleApply: (id: string, kind: ScaleKind, value: number) => void;
  onDelete?: () => void;
  onEditOnCanvas?: (id: string) => void;
  autoSave?: boolean;
}

function NodeOverview({ file, node, controller, guard, onLocate, autoSave }: NodePanelProps) {
  const noteBlock = getNodeNoteBlock(file.domain, node.id);
  const note = noteBlock?.markdown ?? '';
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [noteDraft, setNoteDraft] = useState(note);
  const [editingNote, setEditingNote] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [editingTaskTags, setEditingTaskTags] = useState<string | null>(null);
  const [draftAssets, setDraftAssets] = useState<Record<string, AssetRecord>>({});
  const noteBase = useRef(note);
  const noteWrites = useRef(Promise.resolve());
  const draftVersion = useRef(0);
  const tasks = useMemo(
    () => indexWorkspaceTasks(file.domain).byNode.get(node.id) ?? [],
    [file.domain, node.id],
  );
  const { total, done } = workspaceTaskCounts(tasks);
  const otherTasks = tasks.filter(
    (item) => item.source === 'task' || item.blockId !== noteBlock?.id,
  );
  const title = titleDraft.trim();

  useEffect(() => setTitleDraft(node.title), [node.title]);
  useEffect(() => {
    if (editingNote && noteDraft !== noteBase.current) return;
    noteBase.current = note;
    setNoteDraft(note);
  }, [note, editingNote, noteDraft]);

  function persistNote(markdown: string, assets: Record<string, AssetRecord>) {
    const write = noteWrites.current.then(async () => {
      const base = noteBase.current;
      await controller.runFromLatest(({ domain }) => {
        const latest = getNodeNote(domain, node.id);
        if (latest !== base && latest !== markdown) {
          throw new Error('笔记已变化，编辑内容仍在草稿中。');
        }
        if (latest === markdown && !Object.keys(assets).length) return;
        return setNodeNoteEntry(domain, node.id, markdown, assets);
      });
      noteBase.current = markdown;
      setDraftAssets((current) => (current === assets ? {} : current));
    });
    noteWrites.current = write.catch(() => {});
    return write;
  }

  useEffect(() => {
    if (!editingNote || !autoSave || savingNote || addingTask) return;
    const timer = setInterval(() => {
      if (noteDraft !== note || Object.keys(draftAssets).length > 0) {
        guard(async () => {
          await persistNote(noteDraft, draftAssets);
        });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [
    editingNote,
    autoSave,
    savingNote,
    addingTask,
    noteDraft,
    note,
    draftAssets,
    file.domain,
    node.id,
    controller,
    guard,
  ]);

  function saveNote(assets?: Record<string, AssetRecord>) {
    if (savingNote || addingTask) return;
    const assetsToCommit = assets ?? draftAssets;
    if (noteDraft === note && Object.keys(assetsToCommit).length === 0) {
      setEditingNote(false);
      return;
    }
    const version = draftVersion.current;
    setSavingNote(true);
    guard(async () => {
      try {
        await persistNote(noteDraft, assetsToCommit);
        if (version === draftVersion.current) setEditingNote(false);
      } finally {
        setSavingNote(false);
      }
    });
  }

  function cancelNote() {
    if (savingNote || addingTask) return;
    setNoteDraft(note);
    setDraftAssets({});
    setEditingNote(false);
  }

  function sourceFor(item: WorkspaceTask): TodoSource {
    return item.source === 'task'
      ? { source: 'task', id: item.task.id, task: item.task }
      : {
          source: 'markdown',
          nodeId: node.id,
          blockId: item.blockId,
          lineIndex: item.task.lineIndex,
          markdown: item.markdown,
        };
  }

  function updateTask(source: TodoSource, changes: Partial<TodoDraft>) {
    const day = localToday();
    return controller.runFromLatest((latest) => updateTodoEntry(latest, source, changes, day));
  }

  return (
    <>
      <section className="wst-inspector-section" aria-label="基本信息">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title && title !== node.title) {
              guard(() => controller.run(renameNodeEntry(file.domain, node.id, title)));
            }
          }}
        >
          <div className="wst-field">
            <label htmlFor="inspector-node-title">节点名称</label>
            <div className="wst-input-action">
              <input
                id="inspector-node-title"
                data-testid="node-title"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (autoSave && title && title !== node.title) {
                    guard(() => controller.run(renameNodeEntry(file.domain, node.id, title)));
                  }
                }}
              />
              {title && title !== node.title && (
                <button className="wst-tool is-accent" type="submit">
                  保存
                </button>
              )}
            </div>
          </div>
        </form>
        <label className="wst-field">
          开始日期
          <input
            type="date"
            data-testid="node-start-at"
            title="用于自动布局中的日期顺序与定位"
            value={node.startAt ?? ''}
            onChange={(event) => {
              const date = event.target.value || null;
              guard(async () => {
                const current = controller.getSnapshot().file;
                await controller.run(setStartAtEntry(current.domain, node.id, date));
                if (!controller.getSnapshot().error) onLocate?.(node.id);
              });
            }}
          />
        </label>
      </section>

      <section className="wst-inspector-section" aria-label="节点标签">
        <div className="wst-section-heading">
          <h3>节点标签</h3>
        </div>
        <TagEditor
          label="节点标签"
          tags={node.tags}
          onChange={async (tags) => {
            await controller.run(
              setNodeTagsEntry(controller.getSnapshot().file.domain, node.id, tags),
            );
            return !controller.getSnapshot().error;
          }}
        />
      </section>

      <section className="wst-inspector-section" aria-label="Markdown 笔记">
        <div className="wst-section-heading">
          <h3>笔记</h3>
          {total > 0 && (
            <span className="wst-count">
              {done} / {total} 完成
            </span>
          )}
          {!editingNote && (
            <button
              type="button"
              className="wst-tool is-subtle"
              onClick={() => setEditingNote(true)}
            >
              <WorkspaceIcon name={note ? 'pencil' : 'plus'} size={14} /> {note ? '编辑' : '添加'}
            </button>
          )}
        </div>
        {editingNote ? (
          <>
            <MarkdownEditor
              value={noteDraft}
              assets={file.domain.assets}
              onChange={(val) => {
                draftVersion.current++;
                setNoteDraft(val);
              }}
              onAssetsChange={(assets) => {
                draftVersion.current++;
                setDraftAssets(assets);
              }}
              onSave={saveNote}
              onCancel={cancelNote}
              autoFocus
              placeholder="例如 - [ ] 核对招募条件 #招募"
            />
            <div className="wst-section-actions">
              <button
                type="button"
                className="wst-tool"
                disabled={savingNote || addingTask}
                onClick={cancelNote}
              >
                取消
              </button>
              <button
                type="button"
                className="wst-tool is-accent"
                disabled={savingNote || addingTask}
                onClick={() => saveNote()}
              >
                保存笔记
              </button>
            </div>
          </>
        ) : note.trim() ? (
          <MarkdownPreview
            markdown={note}
            assets={file.domain.assets}
            className="wst-inspector-note"
            onToggleTask={
              noteBlock
                ? (lineIndex, checked) =>
                    guard(() =>
                      updateTask(
                        {
                          source: 'markdown',
                          nodeId: node.id,
                          blockId: noteBlock.id,
                          lineIndex,
                          markdown: note,
                        },
                        { status: checked ? 'done' : 'open' },
                      ),
                    )
                : undefined
            }
          />
        ) : (
          <p className="wst-empty-line">暂无笔记</p>
        )}
        {total > 0 && (
          <progress
            className="wst-task-progress"
            aria-label="任务完成度"
            max={total}
            value={done}
          />
        )}
        {otherTasks.length > 0 && (
          <ul className="wst-task-list">
            {otherTasks.map((item) => {
              const { task } = item;
              const status = item.source === 'task' ? item.status : item.task.status;
              const id =
                item.source === 'task'
                  ? item.task.id
                  : JSON.stringify([item.blockId, item.task.lineIndex]);
              return (
                <li key={id}>
                  <div className="wst-task-line">
                    <label className={status === 'done' ? 'is-done' : ''}>
                      <input
                        type="checkbox"
                        checked={status === 'done'}
                        data-testid={`task-${id}`}
                        onChange={(event) => {
                          const next = event.target.checked ? 'done' : 'open';
                          guard(() => updateTask(sourceFor(item), { status: next }));
                        }}
                      />
                      <span>{task.title || '未命名 TODO'}</span>
                    </label>
                    {status !== 'open' && (
                      <span className="wst-muted">{TODO_STATUS[status].label}</span>
                    )}
                    {task.completedAt && status === 'done' && (
                      <time className="wst-todo-date" dateTime={task.completedAt}>
                        完成 {task.completedAt}
                      </time>
                    )}
                    {task.scheduledAt && (
                      <time className="wst-todo-date" dateTime={task.scheduledAt}>
                        {task.scheduledAt}
                      </time>
                    )}
                    <button
                      type="button"
                      className="wst-tool is-icon is-subtle"
                      aria-label={'编辑 TODO 标签 ' + task.title}
                      aria-expanded={editingTaskTags === id}
                      title="编辑 TODO 标签"
                      onClick={() => setEditingTaskTags(editingTaskTags === id ? null : id)}
                    >
                      <WorkspaceIcon name="tag" size={15} />
                    </button>
                  </div>
                  {editingTaskTags === id ? (
                    <TagEditor
                      label="TODO 标签"
                      tags={task.tags}
                      onChange={async (tags) => {
                        try {
                          await updateTask(sourceFor(item), { tags });
                          return true;
                        } catch {
                          return false;
                        }
                      }}
                    />
                  ) : task.tags?.length ? (
                    <div className="wst-task-tags">
                      <TagList tags={task.tags} label="TODO 标签" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="wst-input-action"
          onSubmit={(event) => {
            event.preventDefault();
            const taskTitle = taskDraft.trim();
            if (!taskTitle || addingTask || savingNote) return;
            setAddingTask(true);
            guard(async () => {
              try {
                if (editingNote) {
                  const line = '- [ ] ' + taskTitle;
                  const next = prependMarkdownTask(noteDraft, line);
                  await persistNote(next, draftAssets);
                  setNoteDraft((current) => {
                    if (current === next || current === noteDraft) return next;
                    return prependMarkdownTask(current, line);
                  });
                } else {
                  await controller.runFromLatest((latest) =>
                    saveTodoEntry(latest, null, {
                      title: taskTitle,
                      status: 'open',
                      tags: [],
                      scheduledAt: null,
                      target: { mode: 'existing', nodeId: node.id },
                    }),
                  );
                }
                setTaskDraft((current) => (current === taskDraft ? '' : current));
              } finally {
                setAddingTask(false);
              }
            });
          }}
        >
          <input
            aria-label="新任务名称"
            placeholder="新增任务…"
            value={taskDraft}
            onChange={(event) => setTaskDraft(event.target.value)}
          />
          <button
            type="submit"
            className="wst-tool is-icon"
            aria-label="新增任务"
            title="新增任务"
            disabled={!taskDraft.trim() || addingTask || savingNote}
          >
            <WorkspaceIcon name="plus" />
          </button>
        </form>
      </section>
    </>
  );
}

function ScaleField({
  kind,
  label,
  description,
  value,
  min = 0.5,
  max = 2.0,
  onPreview,
  onApply,
}: {
  kind: ScaleKind;
  label?: string;
  description?: string;
  value: number;
  min?: number;
  max?: number;
  onPreview: (value: number | null) => void;
  onApply: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editingInput, setEditingInput] = useState(false);
  const [textInput, setTextInput] = useState(`${Math.round(value * 100)}%`);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (pending.current === null) {
      setDraft(value);
      if (!editingInput) {
        setTextInput(`${Math.round(value * 100)}%`);
      }
    }
  }, [value, editingInput]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function preview(next: number) {
    const clamped = Math.max(min, Math.min(max, next));
    pending.current = clamped;
    setDraft(clamped);
    setTextInput(`${Math.round(clamped * 100)}%`);
    onPreview(clamped);
  }

  function apply(explicitVal?: number) {
    clearTimeout(timer.current);
    const next = explicitVal !== undefined ? explicitVal : pending.current;
    pending.current = null;
    if (next !== null && Number.isFinite(next)) {
      const clamped = Math.max(min, Math.min(max, next));
      setDraft(clamped);
      setTextInput(`${Math.round(clamped * 100)}%`);
      onApply(clamped);
    }
  }

  function cancel() {
    clearTimeout(timer.current);
    pending.current = null;
    setDraft(value);
    setTextInput(`${Math.round(value * 100)}%`);
    onPreview(null);
  }

  // 非对称对数映射：100% 对应轨道 75%
  const sliderPos = sliderFromScale(draft, min, max, 0.75);

  const displayLabel =
    label ??
    (kind === 'node'
      ? '单节点排版修正 (U)'
      : kind === 'branch'
        ? '分支排版缩放 (B^L)'
        : kind === 'node-visual'
          ? '单节点等比几何缩放 (V)'
          : '分支整体等比几何缩放 (B^V)');

  return (
    <div className="wst-field wst-scale-field">
      <div className="wst-scale-field-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="wst-scale-title">{displayLabel}</span>
        <div className="wst-scale-numeric-wrap">
          <input
            type="text"
            className="wst-scale-number-input"
            style={{ width: 68, textAlign: 'right', padding: '2px 4px', fontSize: 12 }}
            value={textInput}
            onFocus={() => setEditingInput(true)}
            onChange={(e) => setTextInput(e.target.value)}
            onBlur={() => {
              setEditingInput(false);
              const clean = textInput.replace('%', '').trim();
              const parsed = Number(clean);
              if (Number.isFinite(parsed) && parsed > 0) {
                const ratio = clean.includes('%') || parsed > 10 ? parsed / 100 : parsed;
                preview(ratio);
                apply(ratio);
              } else {
                setTextInput(`${Math.round(draft * 100)}%`);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setEditingInput(false);
                setTextInput(`${Math.round(draft * 100)}%`);
              }
            }}
          />
        </div>
      </div>
      {description && <span className="wst-field-desc" style={{ fontSize: 11, color: '#64748b', display: 'block', margin: '2px 0 6px' }}>{description}</span>}
      <div className="wst-slider-track-wrap" style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
        <input
          ref={input}
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={sliderPos}
          data-testid={`${kind}-scale`}
          className="wst-scale-range-slider"
          style={{ width: '100%' }}
          title="拖动调整（100% 位于 75% 刻度处）"
          onChange={(event) => {
            const pos = event.target.valueAsNumber;
            const nextScale = scaleFromSlider(pos, min, max, 0.75);
            preview(Number(nextScale.toFixed(4)));
          }}
          onDoubleClick={() => {
            preview(1.0);
            apply(1.0);
          }}
          onPointerDown={() => apply()}
          onPointerUp={() => apply()}
          onPointerCancel={cancel}
          onBlur={() => apply()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancel();
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              const next = Number((draft - 0.05).toFixed(2));
              preview(next);
              apply(next);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = Number((draft + 0.05).toFixed(2));
              preview(next);
              apply(next);
            }
          }}
        />
        <div
          className="wst-slider-anchor-mark"
          style={{
            position: 'absolute',
            left: '75%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 2,
            height: 10,
            background: 'var(--accent, #3b82f6)',
            pointerEvents: 'none',
            opacity: 0.6,
          }}
          title="100% 原始大小基准"
        />
      </div>
      <div className="wst-scale-presets">
        {[0.5, 0.75, 1.0, 1.25, 1.5].map((preset) => {
          if (preset < min || preset > max) return null;
          const isActive = Math.abs(draft - preset) < 0.02;
          return (
            <button
              key={preset}
              type="button"
              className={`wst-scale-preset-btn${isActive ? ' is-active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                preview(preset);
                apply(preset);
              }}
            >
              {Math.round(preset * 100)}%
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NodeLayout({
  file,
  node,
  visualNode,
  controller,
  guard,
  direction,
  onScalePreview,
  onScaleApply,
}: NodePanelProps & Pick<InspectorProps, 'direction' | 'onScalePreview' | 'onScaleApply'>) {
  const { presentation } = file;
  const collapsed = presentation.collapsedByDefault.includes(node.id);
  const hasChildren = file.domain.nodes.some((item) => item.parentId === node.id);

  const metrics = visualNode?.scaleMetrics;
  const growthEnabled = Boolean(presentation.scaleSettings?.growth?.enabled);
  const depth = metrics?.depth ?? 0;
  const depthRatio = metrics?.depthRatio ?? 1.0;
  const topologyRatio = metrics?.topologyRatio ?? 1.0;
  const autoRatio = metrics?.autoLayoutRatio ?? 1.0;
  const effLayout = visualNode?.effectiveLayoutScale ?? metrics?.effectiveLayoutRatio ?? 1.0;
  const effVisual = visualNode?.effectiveVisualScale ?? metrics?.effectiveVisualRatio ?? 1.0;

  return (
    <>
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>位置与显示</h3>
        </div>
        <button
          type="button"
          className="wst-menu-action"
          data-testid="reset-node-position"
          onClick={() => guard(() => controller.run(clearPositionEntry(file, node.id, direction)))}
        >
          <WorkspaceIcon name="reset" /> 恢复节点自动位置
        </button>
        <button
          type="button"
          className="wst-menu-action"
          data-testid="toggle-collapse"
          disabled={!hasChildren && !collapsed}
          onClick={() => guard(() => controller.run(setCollapsedEntry(file, node.id, !collapsed)))}
        >
          <WorkspaceIcon name="tree" /> {collapsed ? '展开分支' : '折叠分支'}
        </button>
      </section>

      {/* A. 自动尺寸 (Auto Size, 只读) */}
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>层级拓扑自动尺寸</h3>
          {growthEnabled ? (
            <span className="wst-badge is-success">已启用生长</span>
          ) : (
            <span className="wst-badge">未启用生长 (旧模式)</span>
          )}
        </div>
        <div className="wst-auto-scale-metrics">
          <div className="wst-metric-row">
            <span className="wst-metric-label">语义结构深度</span>
            <span className="wst-metric-val">第 {depth} 层</span>
          </div>
          {growthEnabled && (
            <>
              <div className="wst-metric-row">
                <span className="wst-metric-label">深度衰减 (G)</span>
                <span className="wst-metric-val">{(depthRatio * 100).toFixed(1)}%</span>
              </div>
              <div className="wst-metric-row">
                <span className="wst-metric-label">拓扑修正 (T)</span>
                <span className="wst-metric-val">
                  {topologyRatio >= 1 ? `+${((topologyRatio - 1) * 100).toFixed(1)}%` : `${((topologyRatio - 1) * 100).toFixed(1)}%`} ({topologyRatio.toFixed(2)}×)
                </span>
              </div>
            </>
          )}
          <div className="wst-metric-row is-highlight">
            <span className="wst-metric-label">自动排版基准 (G×T)</span>
            <span className="wst-metric-val">{(autoRatio * 100).toFixed(1)}%</span>
          </div>
        </div>
      </section>

      {/* B. 手动排版修正 (Layout Override, 可调) */}
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>手动排版修正 (Layout Scale)</h3>
        </div>
        <ScaleField
          kind="node"
          label="单节点排版修正 (U)"
          description="基于自动基准微调；重新自适应换行，默认 100%"
          value={presentation.nodeScales?.[node.id] ?? 1}
          min={0.5}
          max={2.0}
          onPreview={(value) => onScalePreview(node.id, 'node', value)}
          onApply={(value) => onScaleApply(node.id, 'node', value)}
        />
        <ScaleField
          kind="branch"
          label="分支排版缩放 (B^L)"
          description="作用于当前整条子树的排版基准，默认 100%"
          value={presentation.branchScales[node.id] ?? 1}
          min={0.5}
          max={2.0}
          onPreview={(value) => onScalePreview(node.id, 'branch', value)}
          onApply={(value) => onScaleApply(node.id, 'branch', value)}
        />
        <button
          type="button"
          className="wst-tool is-small"
          onClick={() =>
            guard(async () => {
              if (presentation.nodeScales?.[node.id] !== undefined) {
                await controller.run(setNodeScaleEntry(controller.getSnapshot().file, node.id, 1));
              }
            })
          }
        >
          恢复单节点 100% 自动基准 (U=1)
        </button>
      </section>

      {/* C. 等比几何缩放 (Visual Scale, 可调) */}
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>等比几何缩放 (Visual Scale)</h3>
        </div>
        <ScaleField
          kind="node-visual"
          label="单节点等比几何缩放 (V)"
          description="整体等比放大/缩小，锁死卡片内部排版，默认 100%"
          value={presentation.nodeVisualScales?.[node.id] ?? 1}
          min={0.25}
          max={5.0}
          onPreview={(value) => onScalePreview(node.id, 'node-visual', value)}
          onApply={(value) => onScaleApply(node.id, 'node-visual', value)}
        />
        <ScaleField
          kind="branch-visual"
          label="分支整体等比几何缩放 (B^V)"
          description="子树作为一个图形组整体等比几何缩放，默认 100%"
          value={presentation.branchVisualScales?.[node.id] ?? 1}
          min={0.25}
          max={5.0}
          onPreview={(value) => onScalePreview(node.id, 'branch-visual', value)}
          onApply={(value) => onScaleApply(node.id, 'branch-visual', value)}
        />
        <button
          type="button"
          className="wst-tool"
          onClick={() =>
            guard(async () => {
              if (presentation.nodeSizes?.[node.id] !== undefined) {
                await controller.run(
                  setNodeSizeEntry(controller.getSnapshot().file, node.id, null),
                );
              }
              if (presentation.nodeScales?.[node.id] !== undefined) {
                await controller.run(setNodeScaleEntry(controller.getSnapshot().file, node.id, 1));
              }
              if (presentation.branchScales[node.id] !== undefined) {
                await controller.run(
                  setBranchScaleEntry(controller.getSnapshot().file, node.id, 1),
                );
              }
              if (presentation.nodeVisualScales?.[node.id] !== undefined) {
                await controller.run(
                  setNodeVisualScaleEntry(controller.getSnapshot().file, node.id, 1),
                );
              }
              if (presentation.branchVisualScales?.[node.id] !== undefined) {
                await controller.run(
                  setBranchVisualScaleEntry(controller.getSnapshot().file, node.id, 1),
                );
              }
            })
          }
        >
          恢复全部 100% / 默认方框
        </button>
      </section>

      {/* D. 最终实际尺寸 (Final Effective Dimensions, 只读可折叠) */}
      <section className="wst-inspector-section">
        <details className="wst-dimensions-details" open>
          <summary className="wst-section-heading" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <h3>最终合成尺寸与字号</h3>
          </summary>
          <div className="wst-auto-scale-metrics" style={{ marginTop: 8 }}>
            <div className="wst-metric-row">
              <span className="wst-metric-label">有效排版比例 (G×T×U×ΠB^L)</span>
              <span className="wst-metric-val">{(effLayout * 100).toFixed(1)}%</span>
            </div>
            <div className="wst-metric-row">
              <span className="wst-metric-label">有效几何倍率 (V×ΠB^V)</span>
              <span className="wst-metric-val">{(effVisual * 100).toFixed(1)}% ({effVisual.toFixed(2)}×)</span>
            </div>
            <div className="wst-metric-row">
              <span className="wst-metric-label">参考排版字号 (标题 / 正文)</span>
              <span className="wst-metric-val">
                {(18 * effLayout).toFixed(0)}px / {(14 * effLayout).toFixed(0)}px
              </span>
            </div>
            <div className="wst-metric-row">
              <span className="wst-metric-label">视觉等效字号 (排版×几何)</span>
              <span className="wst-metric-val">
                {(18 * effLayout * effVisual).toFixed(0)}px / {(14 * effLayout * effVisual).toFixed(0)}px
              </span>
            </div>
            <div className="wst-metric-row">
              <span className="wst-metric-label">物理占位边界 (宽×高)</span>
              <span className="wst-metric-val">
                {visualNode?.visualSize ? `${visualNode.visualSize.width} × ${visualNode.visualSize.height} px` : '测量中…'}
              </span>
            </div>
          </div>
        </details>
      </section>
    </>
  );
}

function NodeRelations({
  file,
  node,
  controller,
  guard,
  hiddenRelations,
  visibleNodeIds,
  onLocate,
  onConnection,
  onDetach,
  tree,
}: NodePanelProps &
  Pick<
    InspectorProps,
    'hiddenRelations' | 'visibleNodeIds' | 'onLocate' | 'onConnection' | 'onDetach'
  > & {
    tree: ReturnType<typeof buildHierarchy>;
  }) {
  const { edges, nodes, project } = file.domain;
  const names = new Map(nodes.map(({ id, title }) => [id, title || id]));
  const name = (id: string) => names.get(id) ?? id;
  const parentId = tree.parents.get(node.id);
  const children = tree.children.get(node.id) ?? [];
  const relations = edges.filter(
    (edge) =>
      edge.type !== 'hierarchy' && (edge.fromNodeId === node.id || edge.toNodeId === node.id),
  );
  const locateButton = (id: string) => (
    <button
      type="button"
      className="wst-text-button"
      onClick={() => onLocate(id)}
      title={`定位 ${name(id)}`}
    >
      {name(id)}
    </button>
  );

  return (
    <>
      <section className="wst-inspector-section" aria-label="父子归属">
        <div className="wst-section-heading">
          <h3>父子归属</h3>
        </div>
        <p>
          母节点{' '}
          {parentId
            ? locateButton(parentId)
            : node.id === project.rootNodeId
              ? '项目根节点'
              : '独立分支'}
        </p>
        <div className="wst-connection-actions">
          {node.id !== project.rootNodeId && (
            <button
              className="wst-tool"
              type="button"
              onClick={() => onConnection({ kind: 'move', nodeId: node.id })}
            >
              {parentId ? '更换母节点' : '挂到…'}
            </button>
          )}
          {parentId && node.id !== project.rootNodeId && (
            <button className="wst-tool" type="button" onClick={() => onDetach(node.id)}>
              转为独立分支
            </button>
          )}
          <button
            className="wst-tool"
            type="button"
            onClick={() => onConnection({ kind: 'adopt', nodeId: node.id })}
          >
            接入已有分支
          </button>
        </div>
        {children.length > 0 && (
          <ul className="wst-relation-list" aria-label="子节点">
            {children.map((id) => (
              <li key={id}>
                {locateButton(id)}
                <button
                  className="wst-tool"
                  type="button"
                  onClick={() => onConnection({ kind: 'move', nodeId: id })}
                >
                  改挂
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>关联连线</h3>
          {hiddenRelations > 0 && <span className="wst-count">{hiddenRelations} 条未显示</span>}
        </div>
        {relations.length ? (
          <ul className="wst-relation-list">
            {relations.map((edge) => {
              const peer = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
              return (
                <li key={edge.id}>
                  <div className="wst-relation-peer">
                    <span className="wst-relation-kind">{relationLabels[edge.type]}</span>
                    <button
                      type="button"
                      className="wst-text-button"
                      disabled={!visibleNodeIds.has(peer)}
                      onClick={() => onLocate(peer)}
                    >
                      {relationDescription(edge.type, name(edge.fromNodeId), name(edge.toNodeId))}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="wst-tool is-icon"
                    aria-label={`编辑与 ${name(peer)} 的连线`}
                    onClick={() =>
                      onConnection({
                        kind: 'relation',
                        edgeId: edge.id,
                        fromNodeId: edge.fromNodeId,
                        toNodeId: edge.toNodeId,
                      })
                    }
                  >
                    <WorkspaceIcon name="pencil" size={15} />
                  </button>
                  <button
                    type="button"
                    className="wst-tool is-icon is-danger"
                    aria-label={`删除与 ${name(peer)} 的${relationLabels[edge.type]}连线`}
                    onClick={() =>
                      guard(() =>
                        controller.runFromLatest((latest) => removeEdgeEntry(latest, edge.id)),
                      )
                    }
                  >
                    <WorkspaceIcon name="trash" size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="wst-empty-line">暂无关联连线</p>
        )}
        <button
          className="wst-tool is-accent"
          type="button"
          onClick={() => onConnection({ kind: 'relation', fromNodeId: node.id, toNodeId: '' })}
        >
          <WorkspaceIcon name="plus" size={14} /> 新建关联
        </button>
      </section>
    </>
  );
}

export default function WorkspaceInspector(props: InspectorProps) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('overview');
  const scrollArea = useRef<HTMLDivElement>(null);
  const { node, file } = props;
  const nodeProps = node && {
    file,
    node,
    controller: props.controller,
    guard: props.guard,
    direction: props.direction,
    onLocate: props.onLocate,
    autoSave: props.autoSave,
  };
  const { nodes, edges } = file.domain;
  const tree = useMemo(() => buildHierarchy(nodes, edges), [nodes, edges]);
  const parent = node && nodes.find((item) => item.id === tree.parents.get(node.id));

  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [tab, node?.id]);

  return (
    <aside
      id="workspace-inspector"
      aria-label="属性面板"
      className="wst-inspector"
      hidden={!props.open}
      inert={props.inert}
    >
      <div className="wst-inspector-bar">
        <h2>
          <WorkspaceIcon name="panel" /> 属性面板
        </h2>
        <button
          type="button"
          className="wst-tool is-icon"
          aria-label="收起属性面板"
          title="收起属性面板"
          onClick={props.onClose}
        >
          <WorkspaceIcon name="close" />
        </button>
      </div>
      {props.visualEdge ? (
        <EdgeInspector
          file={file}
          visual={props.visualEdge}
          edges={props.selectedEdges}
          focusEdgeId={props.focusEdgeId}
          readOnly={props.readOnly}
          clipboard={props.edgeClipboard}
          onLocateNode={props.onLocate}
          onEditConnection={(edge) =>
            props.onConnection({
              kind: 'relation',
              edgeId: edge.id,
              fromNodeId: edge.fromNodeId,
              toNodeId: edge.toNodeId,
            })
          }
          onMoveBranch={props.onMoveBranch}
          onDetach={props.onDetach}
          onDeleteEdge={props.onDeleteEdge}
          onRevealEdge={props.onRevealEdge}
          onSetNote={props.onSetEdgeNote}
          onApplyStyle={props.onApplyEdgeStyle}
          onCopyStyle={props.onCopyEdgeStyle}
          onOpenBatch={props.onOpenEdgeBatch}
          onDraftChange={props.onEdgeDraftChange}
        />
      ) : node && props.readOnly ? (
        <div className="wst-inspector-scroll">
          <h3>{node.title || '未命名节点'}</h3>
          {node.startAt && <p>{node.startAt}</p>}
          <TagList tags={node.tags ?? []} label="节点标签" />
          <MarkdownPreview
            markdown={getNodeNote(file.domain, node.id)}
            assets={file.domain.assets}
            className="wst-inspector-markdown"
          />
        </div>
      ) : node && nodeProps ? (
        <>
          <div className="wst-inspector-identity">
            {parent && (
              <div className="wst-node-parent" title={parent.title}>
                {parent.title} <span aria-hidden="true">/</span>
              </div>
            )}
            <div className="wst-node-heading">
              <h3 title={node.title}>{node.title || '未命名节点'}</h3>
              {props.onEditOnCanvas && (
                <button
                  type="button"
                  className="wst-tool is-icon"
                  aria-label="在卡片上编辑"
                  title="在卡片上编辑"
                  onClick={() => props.onEditOnCanvas?.(node.id)}
                >
                  <WorkspaceIcon name="pencil" size={15} />
                </button>
              )}
            </div>
            {props.selectedCount > 1 && (
              <div className="wst-muted">已选 {props.selectedCount} 个节点 · 正在编辑当前节点</div>
            )}
          </div>
          <div className="wst-tabs" role="tablist" aria-label="节点属性分类">
            {tabs.map(([id, label], index) => (
              <button
                key={id}
                id={`inspector-tab-${id}`}
                role="tab"
                type="button"
                aria-selected={tab === id}
                aria-controls={`inspector-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  const destinations: Record<string, number> = {
                    ArrowLeft: (index + tabs.length - 1) % tabs.length,
                    ArrowRight: (index + 1) % tabs.length,
                    Home: 0,
                    End: tabs.length - 1,
                  };
                  const destination = destinations[event.key];
                  if (destination === undefined) return;
                  event.preventDefault();
                  setTab(tabs[destination][0]);
                  event.currentTarget.parentElement
                    ?.querySelectorAll('button')
                    [destination]?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="wst-inspector-scroll" ref={scrollArea}>
            {tabs.map(([id]) => (
              <div
                key={`${node.id}-${id}`}
                id={`inspector-panel-${id}`}
                role="tabpanel"
                aria-labelledby={`inspector-tab-${id}`}
                hidden={tab !== id}
              >
                {id === 'overview' && <NodeOverview key={node.id} {...nodeProps} />}
                {id === 'layout' && (
                  <NodeLayout
                    {...nodeProps}
                    visualNode={props.visualNode}
                    direction={props.direction}
                    onScalePreview={props.onScalePreview}
                    onScaleApply={props.onScaleApply}
                  />
                )}
                {id === 'layout' && props.onDelete && (
                  <section className="wst-inspector-section wst-inspector-delete">
                    <button
                      type="button"
                      className="wst-menu-action is-danger"
                      onClick={props.onDelete}
                    >
                      <WorkspaceIcon name="trash" /> 删除子树
                    </button>
                  </section>
                )}
                {id === 'relations' && (
                  <NodeRelations
                    {...nodeProps}
                    tree={tree}
                    onConnection={props.onConnection}
                    onDetach={props.onDetach}
                    hiddenRelations={props.hiddenRelations}
                    visibleNodeIds={props.visibleNodeIds}
                    onLocate={props.onLocate}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="wst-inspector-footer">
            <code title={node.id}>{node.id}</code>
            {node.archived && <span>已归档</span>}
          </div>
        </>
      ) : (
        <div className="wst-inspector-scroll wst-inspector-empty">
          <span className="wst-empty-icon">
            <WorkspaceIcon name="tree" size={25} />
          </span>
          <h3>选择一个节点</h3>
          <p>在画布上点击节点，查看它的笔记、任务和连线。</p>
          <button
            type="button"
            className="wst-tool"
            onClick={() => props.onLocate(file.domain.project.rootNodeId)}
          >
            定位根节点 <WorkspaceIcon name="arrow" size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
