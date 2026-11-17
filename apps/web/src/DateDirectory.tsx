import type { DomainState, Node } from '@workspacetree/schema';
import { countMarkdownCallouts, decodeTaskTitle, extractAllImages } from '@workspacetree/markdown';
import { useMemo, useRef, useState, useEffect } from 'react';
import { getNodeNote } from './history';
import { MarkdownPreview } from './MarkdownPreview';
import { TODO_STATUS } from './markdown-todos';
import { collectProjectTodos, type ProjectTodo } from './project-todos';
import { WorkspaceIcon } from './WorkspaceIcon';

const directoryViews = [
  ['dates', '时间'],
  ['images', '图片'],
  ['todos', 'TODO'],
  ['callouts', 'Callout'],
] as const;

export type DateDirectoryViewMode = (typeof directoryViews)[number][0];

export interface DateDirectoryProps {
  nodes: readonly Node[];
  domain?: DomainState;
  selectedId: string | null;
  compact: boolean;
  open: boolean;
  onClose: () => void;
  onLocate: (id: string) => void;
  onToggleTodo?: (todo: ProjectTodo, checked: boolean) => void;
}

interface ImageGalleryItem {
  id: string;
  nodeId: string;
  nodeTitle: string;
  nodeDate: string | null;
  src: string;
  alt: string;
}

export default function DateDirectory({
  nodes,
  domain,
  selectedId,
  compact,
  open,
  onClose,
  onLocate,
  onToggleTodo,
}: DateDirectoryProps) {
  const [viewMode, setViewMode] = useState<DateDirectoryViewMode>(() => {
    try {
      const saved = localStorage.getItem('wst_date_directory_view');
      return directoryViews.find(([id]) => id === saved)?.[0] ?? 'dates';
    } catch {}
    return 'dates';
  });

  const [todoFilter, setTodoFilter] = useState<'all' | ProjectTodo['status']>('all');

  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('wst_date_directory_width');
      if (saved) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n) && n >= 160 && n <= 600) return n;
      }
    } catch {}
    return 220;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  // 1. 日期分组数据
  const groups = useMemo(() => {
    const dated = nodes.filter((node) => node.startAt);
    dated.sort(
      (a, b) =>
        a.startAt!.localeCompare(b.startAt!) ||
        a.title.localeCompare(b.title, 'zh-CN') ||
        a.id.localeCompare(b.id),
    );
    const byDate = new Map<string, Node[]>();
    for (const node of dated) {
      const date = node.startAt!;
      const group = byDate.get(date);
      if (group) group.push(node);
      else byDate.set(date, [node]);
    }
    return [...byDate];
  }, [nodes]);

  // 2. 内嵌图片数据（跨全部节点扫描 Markdown 图像与本地 Assets）
  const images: ImageGalleryItem[] = useMemo(() => {
    if (!domain) return [];
    const list: ImageGalleryItem[] = [];
    const seen = new Set<string>();

    for (const node of domain.nodes) {
      const note = getNodeNote(domain, node.id);
      if (!note) continue;
      const metas = extractAllImages(note);

      metas.forEach((meta, idx) => {
        let src = meta.url;
        if (meta.isAsset && meta.assetId) {
          const asset = domain.assets?.[meta.assetId];
          if (asset?.base64) src = `data:${asset.mime};base64,${asset.base64}`;
        }
        const key = `${node.id}_${meta.url}_${idx}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            id: key,
            nodeId: node.id,
            nodeTitle: node.title || '未命名节点',
            nodeDate: node.startAt ?? null,
            src,
            alt: meta.alt || '内嵌图片',
          });
        }
      });
    }

    // 扫描 domain.assets 中尚未在笔记引用的独立资产
    if (domain.assets) {
      for (const [assetId, asset] of Object.entries(domain.assets)) {
        const key = `asset_${assetId}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            id: key,
            nodeId: domain.project.rootNodeId,
            nodeTitle: '项目资产',
            nodeDate: null,
            src: `data:${asset.mime};base64,${asset.base64}`,
            alt: assetId,
          });
        }
      }
    }

    return list;
  }, [domain]);

  // 3. 待办任务数据
  const allTodos: ProjectTodo[] = useMemo(() => {
    if (!domain) return [];
    const groups = collectProjectTodos(domain);
    return groups.flatMap((group) => group.items);
  }, [domain]);

  const calloutNotes = useMemo(() => {
    if (!domain || !open || viewMode !== 'callouts') return [];
    return nodes.flatMap((node) => {
      const markdown = getNodeNote(domain, node.id);
      return countMarkdownCallouts(markdown) ? [{ node, markdown }] : [];
    });
  }, [domain, nodes, open, viewMode]);

  const filteredTodos = useMemo(() => {
    if (todoFilter === 'all') return allTodos;
    return allTodos.filter((todo) => todo.status === todoFilter);
  }, [allTodos, todoFilter]);

  function switchView(mode: DateDirectoryViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem('wst_date_directory_view', mode);
    } catch {}
  }

  function jump(nodeId: string) {
    onLocate(nodeId);
    if (compact) onClose();
  }

  // 拖拽调整宽度逻辑
  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }

  useEffect(() => {
    if (!isResizing) return;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startXRef.current;
      const nextWidth = Math.max(160, Math.min(560, startWidthRef.current + delta));
      setWidth(nextWidth);
    }

    function onMouseUp(e: MouseEvent) {
      setIsResizing(false);
      const delta = e.clientX - startXRef.current;
      const finalWidth = Math.max(160, Math.min(560, startWidthRef.current + delta));
      try {
        localStorage.setItem('wst_date_directory_width', String(finalWidth));
      } catch {}
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizing]);

  return (
    <nav
      id="workspace-directory"
      className={`wst-date-directory${isResizing ? ' is-resizing' : ''}`}
      aria-label="侧边目录与多维资源"
      hidden={!open}
      style={{
        width: !compact && open ? `${width}px` : undefined,
        flexBasis: !compact && open ? `${width}px` : undefined,
      }}
    >
      <div className="wst-date-directory-header">
        <div className="wst-directory-panel-heading">
          <h2>{compact ? '目录' : '大纲'}</h2>
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label={compact ? '收起目录' : '隐藏大纲'}
            title={compact ? '收起目录' : '隐藏大纲'}
            onClick={onClose}
          >
            <WorkspaceIcon name="close" />
          </button>
        </div>

        {open && (
          <div className="wst-view-select wst-directory-view-select">
            <select
              aria-label="大纲视图"
              data-testid="directory-view"
              value={viewMode}
              onChange={(event) => switchView(event.target.value as DateDirectoryViewMode)}
            >
              {directoryViews.map(([id, label]) => {
                const count =
                  id === 'images' ? images.length : id === 'todos' ? allTodos.length : 0;
                return (
                  <option key={id} value={id}>
                    {label}
                    {count > 0 ? ` (${count})` : ''}
                  </option>
                );
              })}
            </select>
            <WorkspaceIcon name="chevron" size={12} />
          </div>
        )}
      </div>

      {open && (
        <div className="wst-date-directory-content">
          {/* 1. 日期视图 */}
          {viewMode === 'dates' && (
            <div className="wst-date-directory-list">
              {!groups.length && <p className="wst-muted">暂无带日期的节点</p>}
              {groups.map(([date, items]) =>
                items.length === 1 ? (
                  <button
                    key={date}
                    type="button"
                    className="wst-date-directory-entry"
                    aria-current={items[0].id === selectedId ? 'true' : undefined}
                    onClick={() => jump(items[0].id)}
                  >
                    <time dateTime={date}>{date}</time>
                    <span title={items[0].title}>{items[0].title || '未命名节点'}</span>
                  </button>
                ) : (
                  <details key={date} open>
                    <summary>
                      <time dateTime={date}>{date}</time> · {items.length}
                    </summary>
                    {items.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className="wst-date-directory-entry"
                        aria-current={node.id === selectedId ? 'true' : undefined}
                        onClick={() => jump(node.id)}
                      >
                        <span title={node.title}>{node.title || '未命名节点'}</span>
                      </button>
                    ))}
                  </details>
                ),
              )}
            </div>
          )}

          {/* 2. 内嵌图片视图 */}
          {viewMode === 'images' && (
            <div className="wst-date-gallery">
              {images.length === 0 ? (
                <div className="wst-date-empty">
                  <p>当前项目暂无内嵌图片</p>
                  <span className="wst-date-empty-tip">
                    可在卡片 Markdown 笔记中直接粘贴或拖入图片
                  </span>
                </div>
              ) : (
                <div className="wst-date-gallery-grid">
                  {images.map((item) => (
                    <div
                      key={item.id}
                      className={`wst-date-img-card${item.nodeId === selectedId ? ' is-selected' : ''}`}
                      onClick={() => jump(item.nodeId)}
                      title={`点击定位节点：${item.nodeTitle}`}
                    >
                      <div className="wst-date-img-thumb">
                        <img src={item.src} alt={item.alt} loading="lazy" />
                      </div>
                      <div className="wst-date-img-info">
                        <div className="wst-date-img-alt" title={item.alt}>
                          {item.alt}
                        </div>
                        <div className="wst-date-img-node-row">
                          <span className="wst-date-img-node-title" title={item.nodeTitle}>
                            {item.nodeTitle}
                          </span>
                          {item.nodeDate && (
                            <span className="wst-date-img-date-pill">{item.nodeDate}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. 待办任务视图 */}
          {viewMode === 'todos' && (
            <div className="wst-date-todo-panel">
              {/* 任务状态筛选器 */}
              <div className="wst-date-todo-filters">
                <button
                  type="button"
                  className={`wst-date-filter-pill${todoFilter === 'all' ? ' is-active' : ''}`}
                  onClick={() => setTodoFilter('all')}
                >
                  全部 ({allTodos.length})
                </button>
                {(Object.keys(TODO_STATUS) as ProjectTodo['status'][]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`wst-date-filter-pill${todoFilter === status ? ' is-active' : ''}`}
                    aria-pressed={todoFilter === status}
                    onClick={() => setTodoFilter(status)}
                  >
                    {TODO_STATUS[status].label}
                  </button>
                ))}
              </div>

              {/* 任务列表 */}
              <div className="wst-date-todo-list">
                {filteredTodos.length === 0 ? (
                  <div className="wst-date-empty">
                    <p>没有符合筛选条件的任务</p>
                  </div>
                ) : (
                  filteredTodos.map((todo) => {
                    const isSelected = todo.nodeId !== null && todo.nodeId === selectedId;
                    const title =
                      (todo.source === 'markdown' ? decodeTaskTitle(todo.title) : todo.title) ||
                      todo.todoTags.map((tag) => '#' + tag).join(' ') ||
                      '未命名 TODO';
                    const status = TODO_STATUS[todo.status];
                    return (
                      <div
                        key={todo.source + ':' + todo.id}
                        className={`wst-date-todo-item${isSelected ? ' is-selected' : ''}`}
                      >
                        <div className="wst-date-todo-header">
                          {onToggleTodo && (
                            <input
                              type="checkbox"
                              className="wst-todo-check"
                              checked={status.done}
                              aria-label={(status.done ? '取消完成 ' : '完成 ') + title}
                              onChange={(event) => onToggleTodo(todo, event.target.checked)}
                            />
                          )}
                          <span
                            className={`wst-todo-status-marker is-${todo.status}`}
                            title={status.label}
                          >
                            {status.marker}
                          </span>
                          {todo.nodeId ? (
                            <button
                              type="button"
                              className={`wst-date-todo-title${status.done ? ' is-done' : ''}`}
                              aria-label={`定位 ${title} 到 ${todo.nodeTitle}`}
                              onClick={() => jump(todo.nodeId!)}
                            >
                              {title}
                            </button>
                          ) : (
                            <span className={`wst-date-todo-title${status.done ? ' is-done' : ''}`}>
                              {title}
                            </span>
                          )}
                        </div>
                        <div className="wst-date-todo-sub">
                          <span className="wst-date-todo-node-name" title={todo.nodeTitle}>
                            {todo.nodeTitle}
                          </span>
                          {todo.scheduledAt && (
                            <time className="wst-date-todo-date" dateTime={todo.scheduledAt}>
                              计划 {todo.scheduledAt}
                            </time>
                          )}
                          {todo.completedAt && (
                            <time className="wst-date-todo-date" dateTime={todo.completedAt}>
                              完成 {todo.completedAt}
                            </time>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {viewMode === 'callouts' && (
            <div className="wst-directory-callouts">
              {calloutNotes.length === 0 && (
                <div className="wst-date-empty">
                  <p>当前项目暂无 Callout</p>
                </div>
              )}
              {calloutNotes.map(({ node, markdown }) => (
                <section key={node.id}>
                  <button
                    type="button"
                    className="wst-date-directory-entry"
                    aria-current={node.id === selectedId ? 'true' : undefined}
                    title={node.title}
                    onClick={() => jump(node.id)}
                  >
                    <span>{node.title || '未命名节点'}</span>
                  </button>
                  <MarkdownPreview markdown={markdown} assets={domain?.assets} onlyCallouts />
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 右侧宽度拖拽手柄 */}
      {open && !compact && (
        <div
          className={`wst-date-directory-resizer${isResizing ? ' is-dragging' : ''}`}
          onMouseDown={handleResizeStart}
          title="拖拽调整侧边栏宽度"
          aria-hidden="true"
        />
      )}
    </nav>
  );
}
