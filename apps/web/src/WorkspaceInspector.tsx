import { buildHierarchy, type LayoutDirection } from '@workspacetree/layout';
import {
  appendMarkdownTask,
  indexWorkspaceTasks,
  localToday,
  workspaceTaskCounts,
  type WorkspaceTask,
} from '@workspacetree/markdown';
import type { AssetRecord, BranchFile, Node } from '@workspacetree/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { relationDescription, relationLabels, type ConnectionRequest } from './ConnectionDialog';
import type { EditorController } from './editor';
import {
  clearPositionEntry,
  getNodeNote,
  getNodeNoteBlock,
  removeEdgeEntry,
  renameNodeEntry,
  setBranchScaleEntry,
  setCollapsedEntry,
  setNodeNoteEntry,
  setNodeScaleEntry,
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
export type ScaleKind = 'node' | 'branch';
type NodePanelProps = {
  file: BranchFile;
  node: Node;
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
  selectedCount: number;
  hiddenRelations: number;
  direction: LayoutDirection;
  visibleNodeIds: ReadonlySet<string>;
  controller: EditorController;
  guard: Guard;
  onClose: () => void;
  onConnection: (request: ConnectionRequest) => void;
  onDetach: (id: string) => void;
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
                  const next = appendMarkdownTask(noteDraft, line);
                  await persistNote(next, draftAssets);
                  setNoteDraft((current) => {
                    if (current === next || current === noteDraft) return next;
                    return appendMarkdownTask(current, line);
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
  value,
  onPreview,
  onApply,
}: {
  kind: ScaleKind;
  value: number;
  onPreview: (value: number | null) => void;
  onApply: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const minimum = kind === 'node' ? 0.35 : 0.1;
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function preview(next: number) {
    pending.current = next;
    setDraft(next);
    onPreview(next);
  }

  function apply() {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next !== null) onApply(next);
  }

  function cancel() {
    clearTimeout(timer.current);
    pending.current = null;
    setDraft(value);
    onPreview(null);
  }

  useEffect(() => {
    const slider = input.current;
    if (!slider) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const current = pending.current ?? slider.valueAsNumber;
      const next = Number(
        Math.max(minimum, Math.min(2, current - Math.sign(event.deltaY) * 0.05)).toFixed(2),
      );
      if (next === current) return;
      preview(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(apply, 250);
    };
    slider.addEventListener('wheel', wheel, { passive: false });
    return () => slider.removeEventListener('wheel', wheel);
  });

  return (
    <label className="wst-field wst-scale-field">
      <span>
        {kind === 'node' ? '单节点缩放' : '分支整体缩放'} <output>{draft.toFixed(2)}×</output>
      </span>
      <input
        ref={input}
        type="range"
        min={minimum}
        max="2"
        step="0.01"
        value={draft}
        data-testid={`${kind}-scale`}
        title="拖动或滚动调整"
        onChange={(event) => preview(event.target.valueAsNumber)}
        onPointerDown={apply}
        onPointerUp={apply}
        onPointerCancel={cancel}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          cancel();
        }}
        onKeyUp={(event) => {
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowDown',
              'ArrowUp',
              'Home',
              'End',
              'PageDown',
              'PageUp',
            ].includes(event.key)
          ) {
            apply();
          }
        }}
      />
    </label>
  );
}

function NodeLayout({
  file,
  node,
  controller,
  guard,
  direction,
  onScalePreview,
  onScaleApply,
}: NodePanelProps & Pick<InspectorProps, 'direction' | 'onScalePreview' | 'onScaleApply'>) {
  const { presentation } = file;
  const collapsed = presentation.collapsedByDefault.includes(node.id);
  const hasChildren = file.domain.nodes.some((item) => item.parentId === node.id);

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
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>几何尺寸</h3>
        </div>
        <ScaleField
          kind="node"
          value={presentation.nodeScales?.[node.id] ?? 1}
          onPreview={(value) => onScalePreview(node.id, 'node', value)}
          onApply={(value) => onScaleApply(node.id, 'node', value)}
        />
        <ScaleField
          kind="branch"
          value={presentation.branchScales[node.id] ?? 1}
          onPreview={(value) => onScalePreview(node.id, 'branch', value)}
          onApply={(value) => onScaleApply(node.id, 'branch', value)}
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
            })
          }
        >
          恢复 100% / 默认方框
        </button>
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
                        controller.runFromLatest(({ domain }) => removeEdgeEntry(domain, edge.id)),
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
      {node && props.readOnly ? (
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
