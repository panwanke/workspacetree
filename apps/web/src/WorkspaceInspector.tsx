import { makeId } from '@workspacetree/core';
import type { LayoutDirection } from '@workspacetree/layout';
import type { BranchFile, EdgeType, Node } from '@workspacetree/schema';
import { useEffect, useRef, useState } from 'react';
import type { EditorController } from './editor';
import {
  addEdgeEntry,
  addTaskEntry,
  clearPositionEntry,
  getNodeNote,
  removeEdgeEntry,
  renameNodeEntry,
  setBranchScaleEntry,
  setCollapsedEntry,
  setNodeNoteEntry,
  setNodeScaleEntry,
  setNodeSizeEntry,
  setNodeTagsEntry,
  setStartAtEntry,
  setTaskTagsEntry,
  toggleTaskEntry,
} from './history';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownEditor } from './markdown/MarkdownEditor';
import { TODO_STATUS } from './markdown-todos';
import { TagEditor } from './TagEditor';
import { TagList } from './TagList';
import { WorkspaceIcon } from './WorkspaceIcon';

const tabs = [
  ['overview', '概览'],
  ['layout', '布局'],
  ['relations', '关联'],
] as const;

const relationLabels = {
  hierarchy: '层级',
  dependency: '依赖',
  reference: '引用',
  custom: '自定义',
} satisfies Record<EdgeType, string>;

type Guard = (action: () => void | Promise<void>) => void;
export type ScaleKind = 'node' | 'branch';
type NodePanelProps = {
  file: BranchFile;
  node: Node;
  controller: EditorController;
  guard: Guard;
  direction?: LayoutDirection;
  onLocate?: (id: string) => void;
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
  onLocate: (id: string) => void;
  onScalePreview: (id: string, kind: ScaleKind, value: number | null) => void;
  onScaleApply: (id: string, kind: ScaleKind, value: number) => void;
  onDelete?: () => void;
  onEditOnCanvas?: (id: string) => void;
}

function NodeOverview({ file, node, controller, guard, onLocate }: NodePanelProps) {
  const note = getNodeNote(file.domain, node.id);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [noteDraft, setNoteDraft] = useState(note);
  const [editingNote, setEditingNote] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [editingTaskTags, setEditingTaskTags] = useState<string | null>(null);
  const tasks = file.domain.tasks.filter((task) => task.nodeId === node.id);
  const done = tasks.filter((task) => task.done).length;
  const title = titleDraft.trim();

  useEffect(() => setTitleDraft(node.title), [node.title]);
  useEffect(() => setNoteDraft(note), [note]);

  function saveNote() {
    if (noteDraft === note) {
      setEditingNote(false);
      return;
    }
    guard(async () => {
      await controller.run(setNodeNoteEntry(file.domain, node.id, noteDraft));
      if (!controller.getSnapshot().error) setEditingNote(false);
    });
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
              onChange={(val) => setNoteDraft(val)}
              onSave={saveNote}
              onCancel={() => {
                setNoteDraft(note);
                setEditingNote(false);
              }}
              autoFocus
              placeholder="例如 - [ ] 核对招募条件 #招募"
            />
            <div className="wst-section-actions">
              <button
                type="button"
                className="wst-tool"
                onClick={() => {
                  setNoteDraft(note);
                  setEditingNote(false);
                }}
              >
                取消
              </button>
              <button type="button" className="wst-tool is-accent" onClick={saveNote}>
                保存笔记
              </button>
            </div>
          </>
        ) : note.trim() ? (
          <MarkdownPreview markdown={note} className="wst-inspector-note" />
        ) : (
          <p className="wst-empty-line">暂无笔记</p>
        )}
      </section>

      <section className="wst-inspector-section" aria-label="节点任务">
        <div className="wst-section-heading">
          <h3>任务</h3>
          {tasks.length > 0 && (
            <span className="wst-count">
              {done} / {tasks.length} 完成
            </span>
          )}
        </div>
        {tasks.length > 0 && (
          <>
            <progress
              className="wst-task-progress"
              aria-label="任务完成度"
              max={tasks.length}
              value={done}
            />
            <ul className="wst-task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <div className="wst-task-line">
                    <label className={task.done ? 'is-done' : ''}>
                      <input
                        type="checkbox"
                        checked={task.done}
                        data-testid={`task-${task.id}`}
                        onChange={() =>
                          guard(() => controller.run(toggleTaskEntry(file.domain, task.id)))
                        }
                      />
                      <span>{task.title || '未命名 TODO'}</span>
                    </label>
                    {task.status && (
                      <span className="wst-muted">{TODO_STATUS[task.status].label}</span>
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
                      aria-expanded={editingTaskTags === task.id}
                      title="编辑 TODO 标签"
                      onClick={() =>
                        setEditingTaskTags(editingTaskTags === task.id ? null : task.id)
                      }
                    >
                      <WorkspaceIcon name="tag" size={15} />
                    </button>
                  </div>
                  {editingTaskTags === task.id ? (
                    <TagEditor
                      label="TODO 标签"
                      tags={task.tags}
                      onChange={async (tags) => {
                        await controller.run(
                          setTaskTagsEntry(controller.getSnapshot().file.domain, task.id, tags),
                        );
                        return !controller.getSnapshot().error;
                      }}
                    />
                  ) : task.tags?.length ? (
                    <div className="wst-task-tags">
                      <TagList tags={task.tags} label="TODO 标签" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          className="wst-input-action"
          onSubmit={(event) => {
            event.preventDefault();
            const taskTitle = taskDraft.trim();
            if (!taskTitle) return;
            guard(async () => {
              await controller.run(
                addTaskEntry({
                  id: makeId('tsk_'),
                  nodeId: node.id,
                  title: taskTitle,
                  done: false,
                }),
              );
              if (!controller.getSnapshot().error)
                setTaskDraft((current) => (current === taskDraft ? '' : current));
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
            disabled={!taskDraft.trim()}
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
}: NodePanelProps & Pick<InspectorProps, 'hiddenRelations' | 'visibleNodeIds' | 'onLocate'>) {
  const [edgeTarget, setEdgeTarget] = useState('');
  const [edgeType, setEdgeType] = useState<EdgeType>('dependency');
  const { edges, nodes } = file.domain;
  const names = new Map(nodes.map((item) => [item.id, item.title]));
  const relations = edges.filter(
    (edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id,
  );
  const target = names.has(edgeTarget) ? edgeTarget : '';

  return (
    <>
      <section className="wst-inspector-section">
        <div className="wst-section-heading">
          <h3>节点连线</h3>
          {hiddenRelations > 0 && <span className="wst-count">{hiddenRelations} 条未显示</span>}
        </div>
        {relations.length ? (
          <ul className="wst-relation-list">
            {relations.map((edge) => {
              const outgoing = edge.fromNodeId === node.id;
              const peer = outgoing ? edge.toNodeId : edge.fromNodeId;
              const label = names.get(peer) ?? peer;
              return (
                <li key={edge.id}>
                  <div className="wst-relation-peer">
                    <span className="wst-relation-kind">
                      {outgoing ? '出向' : '入向'} · {relationLabels[edge.type]}
                    </span>
                    {visibleNodeIds.has(peer) ? (
                      <button
                        type="button"
                        className="wst-text-button"
                        onClick={() => onLocate(peer)}
                        title={`定位 ${label}`}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="wst-muted" title="此节点位于折叠的分支中">
                        {label}
                      </span>
                    )}
                  </div>
                  {edge.type !== 'hierarchy' && (
                    <button
                      type="button"
                      className="wst-tool is-icon is-danger"
                      aria-label={`删除与 ${label} 的${relationLabels[edge.type]}连线`}
                      onClick={() =>
                        guard(() => controller.run(removeEdgeEntry(file.domain, edge.id)))
                      }
                    >
                      <WorkspaceIcon name="trash" size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="wst-empty-line">暂无连线</p>
        )}
      </section>
      <form
        className="wst-inspector-section"
        onSubmit={(event) => {
          event.preventDefault();
          if (!target) return;
          guard(async () => {
            await controller.run(
              addEdgeEntry({
                id: makeId('e_'),
                type: edgeType,
                fromNodeId: node.id,
                toNodeId: target,
              }),
            );
            if (!controller.getSnapshot().error)
              setEdgeTarget((current) => (current === target ? '' : current));
          });
        }}
      >
        <div className="wst-section-heading">
          <h3>新建关联</h3>
        </div>
        <label className="wst-field">
          目标节点
          <select value={target} onChange={(event) => setEdgeTarget(event.target.value)}>
            <option value="">选择目标节点</option>
            {nodes
              .filter((item) => item.id !== node.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || item.id}
                </option>
              ))}
          </select>
        </label>
        <label className="wst-field">
          关系类型
          <select
            value={edgeType}
            onChange={(event) => setEdgeType(event.target.value as EdgeType)}
          >
            <option value="dependency">依赖</option>
            <option value="reference">引用</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <button type="submit" className="wst-tool is-accent" disabled={!target}>
          <WorkspaceIcon name="plus" size={14} /> 添加连线
        </button>
      </form>
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
  };
  const parent = node && file.domain.nodes.find((item) => item.id === node.parentId);

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
                {id === 'overview' && <NodeOverview {...nodeProps} />}
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
