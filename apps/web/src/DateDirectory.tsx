import type { DomainState, Node } from '@workspacetree/schema';
import { extractAllImages } from '@workspacetree/markdown';
import { useMemo, useRef, useState, useEffect } from 'react';
import { getNodeNote } from './history';
import { collectProjectTodos, type ProjectTodo } from './project-todos';
import { WorkspaceIcon } from './WorkspaceIcon';

export type DateDirectoryViewMode = 'dates' | 'images' | 'todos';

export interface DateDirectoryProps {
  nodes: readonly Node[];
  domain?: DomainState;
  selectedId: string | null;
  compact: boolean;
  onLocate: (id: string) => void;
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
  onLocate,
}: DateDirectoryProps) {
  const [open, setOpen] = useState(!compact);
  const [viewMode, setViewMode] = useState<DateDirectoryViewMode>(() => {
    try {
      const saved = localStorage.getItem('wst_date_directory_view');
      if (saved === 'images' || saved === 'todos' || saved === 'dates') return saved;
    } catch {}
    return 'dates';
  });

  const [todoFilter, setTodoFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('all');

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

  const filteredTodos = useMemo(() => {
    if (todoFilter === 'all') return allTodos;
    if (todoFilter === 'open') return allTodos.filter((t) => t.status === 'open');
    if (todoFilter === 'in_progress') return allTodos.filter((t) => t.status === 'paused'); // markdown-todos paused is [~]
    if (todoFilter === 'done') return allTodos.filter((t) => t.status === 'done');
    return allTodos;
  }, [allTodos, todoFilter]);

  function switchView(mode: DateDirectoryViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem('wst_date_directory_view', mode);
    } catch {}
  }

  function jump(nodeId: string) {
    onLocate(nodeId);
    if (compact) setOpen(false);
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

  const renderTodoStatusMarker = (status: ProjectTodo['status']) => {
    switch (status) {
      case 'done':
        return (
          <span className="wst-todo-status-marker is-done" title="已完成">
            [x]
          </span>
        );
      case 'paused':
        return (
          <span className="wst-todo-status-marker is-progress" title="推进中">
            [~]
          </span>
        );
      case 'pending':
        return (
          <span className="wst-todo-status-marker is-pending" title="待确定">
            [?]
          </span>
        );
      case 'discarded':
        return (
          <span className="wst-todo-status-marker is-discarded" title="已废弃">
            [-]
          </span>
        );
      default:
        return (
          <span className="wst-todo-status-marker is-open" title="待处理">
            [ ]
          </span>
        );
    }
  };

  return (
    <nav
      className={`wst-date-directory${isResizing ? ' is-resizing' : ''}`}
      aria-label="侧边目录与多维资源"
      data-open={open}
      style={{
        width: open ? `${width}px` : undefined,
        flexBasis: open ? `${width}px` : undefined,
      }}
    >
      {/* 头部面板与视图切换按钮 */}
      <div className="wst-date-directory-header">
        <button
          type="button"
          className="wst-tool wst-date-directory-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={open ? '收起侧边面板' : '展开侧边面板'}
        >
          <WorkspaceIcon name="tree" size={14} />
          {open ? '侧边面板' : ''}
        </button>

        {open && (
          <div className="wst-date-view-tabs" role="tablist" aria-label="侧边栏视图切换">
            <button
              type="button"
              className={`wst-date-view-tab${viewMode === 'dates' ? ' is-active' : ''}`}
              title="按日期查看时间树节点"
              onClick={() => switchView('dates')}
            >
              <WorkspaceIcon name="calendar" size={13} />
              <span>时间</span>
            </button>
            <button
              type="button"
              className={`wst-date-view-tab${viewMode === 'images' ? ' is-active' : ''}`}
              title={`查看全部内嵌图片 (${images.length})`}
              onClick={() => switchView('images')}
            >
              <WorkspaceIcon name="image" size={13} />
              <span>图片{images.length > 0 ? ` (${images.length})` : ''}</span>
            </button>
            <button
              type="button"
              className={`wst-date-view-tab${viewMode === 'todos' ? ' is-active' : ''}`}
              title={`查看项目待办清单 (${allTodos.length})`}
              onClick={() => switchView('todos')}
            >
              <WorkspaceIcon name="checkSquare" size={13} />
              <span>TODO{allTodos.length > 0 ? ` (${allTodos.length})` : ''}</span>
            </button>
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
                <button
                  type="button"
                  className={`wst-date-filter-pill${todoFilter === 'open' ? ' is-active' : ''}`}
                  onClick={() => setTodoFilter('open')}
                >
                  待办
                </button>
                <button
                  type="button"
                  className={`wst-date-filter-pill${todoFilter === 'in_progress' ? ' is-active' : ''}`}
                  onClick={() => setTodoFilter('in_progress')}
                >
                  进行中
                </button>
                <button
                  type="button"
                  className={`wst-date-filter-pill${todoFilter === 'done' ? ' is-active' : ''}`}
                  onClick={() => setTodoFilter('done')}
                >
                  已完成
                </button>
              </div>

              {/* 任务列表 */}
              <div className="wst-date-todo-list">
                {filteredTodos.length === 0 ? (
                  <div className="wst-date-empty">
                    <p>没有符合筛选条件的任务</p>
                  </div>
                ) : (
                  filteredTodos.map((todo) => {
                    const isSelected = todo.nodeId === selectedId;
                    return (
                      <div
                        key={todo.id}
                        className={`wst-date-todo-item${isSelected ? ' is-selected' : ''}`}
                        onClick={() => {
                          if (todo.nodeId) jump(todo.nodeId);
                        }}
                        title={todo.nodeId ? `点击定位到节点：${todo.nodeTitle}` : undefined}
                      >
                        <div className="wst-date-todo-header">
                          {renderTodoStatusMarker(todo.status)}
                          <span
                            className={`wst-date-todo-title${todo.status === 'done' ? ' is-done' : ''}`}
                          >
                            {todo.title}
                          </span>
                        </div>
                        <div className="wst-date-todo-sub">
                          <span className="wst-date-todo-node-name" title={todo.nodeTitle}>
                            {todo.nodeTitle}
                          </span>
                          {todo.scheduledAt && (
                            <span className="wst-date-todo-date">{todo.scheduledAt}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 右侧宽度拖拽手柄 */}
      {open && (
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
