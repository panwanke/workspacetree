import type { LayoutDirection, LayoutStrategy, MultiSpineHighlight } from '@workspacetree/layout';
import type { BranchFile } from '@workspacetree/schema';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import BranchManager from './BranchManager';
import { WorkspaceIcon, type WorkspaceIconName } from './WorkspaceIcon';
import appLogo from './assets/logo.svg';

export type ResizeMode = 'box' | 'uniform' | 'branch';
export type ViewMode = '2d' | '3d';
export type ProjectView = 'canvas' | 'todos';

export function WorkspacePopover({
  label,
  icon,
  testId,
  align,
  className = '',
  active = false,
  children,
}: {
  label: string;
  icon: WorkspaceIconName;
  testId?: string;
  align?: 'start' | 'end';
  className?: string;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className={`wst-popover ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`wst-tool${open || active ? ' is-active' : ''}`}
        data-testid={testId}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <WorkspaceIcon name={icon} />
        <span className="wst-tool-label">{label}</span>
        <WorkspaceIcon name="chevron" size={12} />
      </button>
      <div id={id} className={`wst-popover-content is-${align ?? 'end'}`} hidden={!open}>
        {children(close)}
      </div>
    </div>
  );
}

interface ToolbarProps {
  file: BranchFile;
  compact: boolean;
  accountControl?: ReactNode;
  readOnly: boolean;
  projectView: ProjectView;
  edgeCount: number;
  hiddenCount: number;
  undoDepth: number;
  redoDepth: number;
  viewMode: ViewMode;
  resizeMode: ResizeMode;
  layoutDirection: LayoutDirection;
  layoutStrategy: LayoutStrategy;
  showRelations: boolean;
  highlight: MultiSpineHighlight;
  highlightSpineIds: string[];
  inspectorOpen: boolean;
  inspectorToggleRef: RefObject<HTMLButtonElement | null>;
  directoryOpen: boolean;
  directoryToggleRef: RefObject<HTMLButtonElement | null>;
  canDeleteNode: boolean;
  onAddNode: () => void;
  onAddBranch: () => void;
  onAddRandomBranch?: () => void;
  onDeleteNode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onProjectView: (view: ProjectView) => void;
  onViewMode: (mode: ViewMode) => void;
  onResizeMode: (mode: ResizeMode) => void;
  onLayoutDirection: (direction: LayoutDirection) => void;
  onLayoutStrategy: (strategy: LayoutStrategy) => void;
  onToggleRelations: () => void;
  onResetLayout: () => void;
  onFitView: () => void;
  onCreateSpine: () => void;
  onRenameSpine?: (id: string, title: string) => void;
  onRemoveSpine?: (id: string) => void;
  onLocateNode?: (id: string) => void;
  onCreateSpineForLeaf?: (leafNodeId: string, title: string) => void;
  onToggleSpine: (id: string) => void;
  onClearSpines: () => void;
  onToggleInspector: () => void;
  onToggleDirectory: () => void;
  onImport: () => void;
  syncImport?: boolean;
  linkedFile?: boolean;
  onExportJson: () => void;
  onExportSvg: () => void;
  onResetDemo: () => void;
  onOpenSettings?: () => void;
  onOpenProjects?: () => void;
  onNewProjectTab?: () => void;
  onOpenSearch?: () => void;
  searchShortcut?: string;
  onRenameProject?: (title: string) => void;
}

function CanvasToolOverflow({
  compact,
  children,
}: {
  compact: boolean;
  children: (close?: () => void) => ReactNode;
}) {
  if (!compact) return children();
  return (
    <WorkspacePopover label="更多" icon="more" className="wst-toolbar-overflow">
      {children}
    </WorkspacePopover>
  );
}

export default function WorkspaceToolbar(props: ToolbarProps) {
  const { domain, revisions } = props.file;
  const { compact } = props;
  const sourceUrl = 'https://github.com/panwanke/workspacetree';
  const highlighted = props.highlight.paths.length;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(domain.project.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(domain.project.title);
    }
  }, [domain.project.title, isEditingTitle]);

  function commitProjectTitle() {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== domain.project.title) {
      props.onRenameProject?.(trimmed);
    } else {
      setTitleDraft(domain.project.title);
    }
  }

  const addNode = (
    <button
      type="button"
      className="wst-tool is-primary"
      data-testid="add-node"
      disabled={props.readOnly}
      onClick={props.onAddNode}
      aria-label="新建节点"
      title={compact ? '新建节点' : '新建节点（画布内 Tab）'}
    >
      <WorkspaceIcon name="plus" /> <span>{compact ? '新建' : '新建节点'}</span>
    </button>
  );

  const search = props.onOpenSearch && (
    <button
      type="button"
      className="wst-tool"
      aria-label="搜索节点"
      title={compact ? '搜索节点' : `搜索节点 (${props.searchShortcut || 'Ctrl+F'})`}
      data-testid="toolbar-search-btn"
      onClick={props.onOpenSearch}
    >
      <WorkspaceIcon name="search" size={15} /> <span className="wst-tool-label">搜索</span>
    </button>
  );

  const inspector = (
    <button
      ref={props.inspectorToggleRef}
      type="button"
      className={`wst-tool wst-inspector-toggle${props.inspectorOpen ? ' is-active' : ''}`}
      aria-label="属性面板"
      aria-controls="workspace-inspector"
      aria-expanded={props.inspectorOpen}
      data-testid="toggle-inspector"
      title="属性面板"
      onClick={props.onToggleInspector}
    >
      <WorkspaceIcon name="panel" /> <span className="wst-tool-label">属性</span>
    </button>
  );

  const directory = (
    <button
      ref={props.directoryToggleRef}
      type="button"
      className={`wst-tool${props.directoryOpen ? ' is-active' : ''}`}
      aria-expanded={props.directoryOpen}
      aria-controls="workspace-directory"
      onClick={props.onToggleDirectory}
    >
      <WorkspaceIcon name="tree" />{' '}
      <span className="wst-tool-label">{compact ? '目录' : '大纲'}</span>
    </button>
  );

  const header = (
    <header className="wst-header">
      <div className="wst-project-bar">
        <div className="wst-project-identity">
          <span className="wst-brand-mark" title="WorkspaceTree">
            <img
              src={appLogo}
              alt="WorkspaceTree Logo"
              className="wst-brand-logo"
              width={28}
              height={28}
            />
          </span>
          <div className="wst-project-titles">
            <div className="wst-brand-name">WorkspaceTree</div>
            {isEditingTitle ? (
              <form
                className="wst-project-title-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  commitProjectTitle();
                }}
              >
                <input
                  ref={titleInputRef}
                  className="wst-project-title-input"
                  value={titleDraft}
                  autoFocus
                  placeholder="项目名称"
                  aria-label="项目名称"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitProjectTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsEditingTitle(false);
                      setTitleDraft(domain.project.title);
                    }
                  }}
                />
              </form>
            ) : (
              <h1
                title={
                  props.readOnly
                    ? domain.project.title
                    : `${domain.project.title} (点击重命名项目分支)`
                }
                className={!props.readOnly && props.onRenameProject ? 'is-editable' : ''}
                onClick={() => {
                  if (!props.readOnly && props.onRenameProject) {
                    setIsEditingTitle(true);
                  }
                }}
              >
                <span>{domain.project.title}</span>
                {!props.readOnly && props.onRenameProject && (
                  <span className="wst-project-title-edit-hint" aria-hidden="true">
                    <WorkspaceIcon name="pencil" size={13} />
                  </span>
                )}
              </h1>
            )}
          </div>
        </div>
        <div className="wst-project-meta">
          <nav className="wst-project-view-switch" aria-label="项目视图">
            <button
              type="button"
              aria-pressed={props.projectView === 'canvas'}
              onClick={() => props.onProjectView('canvas')}
            >
              画布
            </button>
            <button
              type="button"
              aria-pressed={props.projectView === 'todos'}
              onClick={() => props.onProjectView('todos')}
            >
              TODO
            </button>
          </nav>
          {compact && props.readOnly && <span className="wst-tab-branch-badge">只读预览</span>}
          {!compact && (
            <span className="wst-prototype" title="开发原型，仅用于示例与测试数据">
              开发原型
            </span>
          )}
          <div className="wst-header-stats">
            <span data-testid="node-count">{domain.nodes.length} 个节点</span>
            <span data-testid="edge-count">{props.edgeCount} 条连线</span>
            <span data-testid="hidden-count">隐藏关联 {props.hiddenCount}</span>
          </div>
          {!compact && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="wst-github-star-badge"
              title="在 GitHub 上查看源码并点亮 Star 支持我们 ⭐"
              aria-label="GitHub 仓库与 Star"
            >
              <WorkspaceIcon name="github" size={15} />
              <span className="wst-github-text">GitHub</span>
              <span className="wst-github-star-tag">⭐ Star</span>
            </a>
          )}
          <WorkspacePopover
            label="项目"
            icon="folder"
            testId="project-menu"
            className="wst-project-menu"
          >
            {(close) => (
              <>
                {compact && props.onNewProjectTab && (
                  <button
                    type="button"
                    className="wst-menu-action"
                    onClick={() => {
                      close();
                      props.onNewProjectTab?.();
                    }}
                  >
                    <WorkspaceIcon name="plus" /> 新建分支文件
                  </button>
                )}
                {props.onOpenProjects && (
                  <button
                    type="button"
                    className="wst-menu-action"
                    data-testid="open-projects"
                    onClick={() => {
                      close();
                      props.onOpenProjects?.();
                    }}
                  >
                    <WorkspaceIcon name="folder" /> 全部项目...
                  </button>
                )}
                <button
                  type="button"
                  className="wst-menu-action"
                  onClick={() => {
                    close();
                    props.onImport();
                  }}
                >
                  <WorkspaceIcon name="upload" />
                  {props.syncImport ? ' 导入并同步 .branch.json' : ' 导入 .branch.json'}
                </button>
                <button
                  type="button"
                  className="wst-menu-action"
                  data-testid="export-json"
                  onClick={() => {
                    close();
                    props.onExportJson();
                  }}
                >
                  <WorkspaceIcon name="download" /> 另存为...
                </button>
                <button
                  type="button"
                  className="wst-menu-action"
                  data-testid="export-svg"
                  onClick={() => {
                    close();
                    props.onExportSvg();
                  }}
                >
                  <WorkspaceIcon name="download" /> 导出 SVG
                </button>
                {compact && (
                  <a
                    className="wst-menu-action"
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <WorkspaceIcon name="github" /> GitHub 源码
                  </a>
                )}
                <hr />
                <button
                  type="button"
                  className="wst-menu-action is-danger"
                  data-testid="reset-demo"
                  disabled={props.readOnly || props.linkedFile}
                  onClick={() => {
                    close();
                    props.onResetDemo();
                  }}
                >
                  <WorkspaceIcon name="reset" /> 重置示例
                </button>
                <details className="wst-diagnostics">
                  <summary>版本信息</summary>
                  <div data-testid="semantic-revision">语义修订 {revisions.semanticRevision}</div>
                  <div data-testid="presentation-revision">
                    呈现修订 {revisions.presentationRevision}
                  </div>
                  <div data-testid="semantic-hash">
                    语义哈希 {revisions.semanticHash.slice(0, 10)}
                  </div>
                </details>
              </>
            )}
          </WorkspacePopover>
          {!compact && props.accountControl}
        </div>
        {compact && props.accountControl}
      </div>
    </header>
  );

  function renderToolGroups(closeTools?: () => void) {
    return (
      <>
        <div className="wst-toolbar-group">
          {!compact && addNode}
          <button
            type="button"
            className="wst-tool"
            data-testid="add-branch"
            disabled={props.readOnly}
            onClick={() => {
              closeTools?.();
              props.onAddBranch();
            }}
            aria-label="新建分支"
            title="新建分支"
          >
            <WorkspaceIcon name="branch" /> <span>新建分支</span>
          </button>
          {props.onAddRandomBranch && (
            <button
              type="button"
              className="wst-tool"
              data-testid="add-random-branch"
              disabled={props.readOnly}
              onClick={() => {
                closeTools?.();
                props.onAddRandomBranch?.();
              }}
              aria-label="新建独立节点"
              title="在当前画布新建独立节点"
            >
              <WorkspaceIcon name="plus" size={15} /> <span>新建独立节点</span>
            </button>
          )}
          <div className="wst-history-tools">
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="撤销"
              title="撤销（Ctrl / ⌘ + Z）"
              data-testid="undo"
              onClick={() => {
                closeTools?.();
                props.onUndo();
              }}
              disabled={props.undoDepth === 0}
            >
              <WorkspaceIcon name="undo" />
            </button>
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="重做"
              title="重做（Ctrl + Y 或 ⌘ + Shift + Z）"
              data-testid="redo"
              onClick={() => {
                closeTools?.();
                props.onRedo();
              }}
              disabled={props.redoDepth === 0}
            >
              <WorkspaceIcon name="redo" />
            </button>
          </div>
          <button
            type="button"
            className="wst-tool is-icon is-danger wst-toolbar-delete"
            data-testid="delete-node"
            aria-label="删除子树"
            title="删除子树"
            onClick={props.onDeleteNode}
            disabled={!props.canDeleteNode}
          >
            <WorkspaceIcon name="trash" />
          </button>
        </div>

        <div className="wst-toolbar-group wst-view-tools">
          <div className="wst-view-select">
            <select
              aria-label="布局方式"
              data-testid="layout-strategy"
              value={props.layoutStrategy}
              onChange={(event) => props.onLayoutStrategy(event.target.value as LayoutStrategy)}
            >
              <option value="date-constrained">时间树</option>
              <option value="date-priority">日期优先</option>
            </select>
            <WorkspaceIcon name="chevron" size={12} />
          </div>
          <div className="wst-view-select">
            <select
              aria-label="画布视图"
              data-testid="view-mode"
              value={props.viewMode}
              onChange={(event) => props.onViewMode(event.target.value as ViewMode)}
            >
              <option value="2d">2D</option>
              <option value="3d">3D</option>
            </select>
            <WorkspaceIcon name="chevron" size={12} />
          </div>
          <button
            type="button"
            className="wst-tool is-icon"
            data-testid="fit-view"
            aria-label="自适应视图"
            title="自适应视图（F）"
            onClick={() => {
              closeTools?.();
              props.onFitView();
            }}
          >
            <WorkspaceIcon name="fit" />
            {compact && <span>适应视图</span>}
          </button>
          <button
            type="button"
            className={`wst-tool wst-relation-tool${props.showRelations ? ' is-active' : ''}`}
            data-testid="toggle-relations"
            aria-pressed={props.showRelations}
            title="关系图层"
            aria-label="关系图层"
            onClick={props.onToggleRelations}
          >
            <WorkspaceIcon name="layers" /> <span className="wst-tool-label">关系</span>
          </button>
          <WorkspacePopover
            label={highlighted ? `主干 · ${highlighted}` : '主干'}
            icon="route"
            testId="spine-menu"
            className="wst-branch-popover"
            active={highlighted > 0}
          >
            {(close) => (
              <BranchManager
                domain={domain}
                readOnly={props.readOnly}
                highlightSpineIds={props.highlightSpineIds}
                highlight={props.highlight}
                onToggleSpine={props.onToggleSpine}
                onClearSpines={props.onClearSpines}
                onCreateSpine={props.onCreateSpine}
                onRenameSpine={props.onRenameSpine ?? (() => {})}
                onRemoveSpine={props.onRemoveSpine ?? (() => {})}
                onLocateNode={(id) => {
                  props.onLocateNode?.(id);
                }}
                onCreateSpineForLeaf={props.onCreateSpineForLeaf ?? (() => {})}
                onClose={close}
              />
            )}
          </WorkspacePopover>
          <WorkspacePopover label="画布设置" icon="sliders" testId="view-settings">
            {(close) => (
              <>
                <div className="wst-popover-heading">画布设置</div>
                <label className="wst-field">
                  布局方向
                  <select
                    data-testid="layout-direction"
                    disabled={props.readOnly}
                    value={props.layoutDirection}
                    onChange={(event) =>
                      props.onLayoutDirection(event.target.value as LayoutDirection)
                    }
                  >
                    <option value="vertical">从上到下</option>
                    <option value="horizontal">从左到右</option>
                  </select>
                </label>
                <label
                  className="wst-field"
                  title="拖拽节点四角时：可随时按住 Shift 保持等比、Alt 分支联动、Ctrl 节点等比吸附"
                >
                  拖拽缩放方式
                  <select
                    data-testid="resize-mode"
                    value={props.resizeMode}
                    onChange={(event) => props.onResizeMode(event.target.value as ResizeMode)}
                  >
                    <option value="box">调整方框</option>
                    <option value="uniform">等比缩放单节点</option>
                    <option value="branch">等比缩放分支</option>
                  </select>
                </label>
                <hr />
                <button
                  type="button"
                  className="wst-menu-action"
                  data-testid="auto-layout"
                  disabled={props.readOnly}
                  onClick={() => {
                    close();
                    closeTools?.();
                    props.onResetLayout();
                  }}
                >
                  <WorkspaceIcon name="reset" /> 全部恢复时间布局
                </button>
                {props.onOpenSettings && (
                  <>
                    <hr />
                    <button
                      type="button"
                      className="wst-menu-action"
                      data-testid="open-keybindings"
                      onClick={() => {
                        close();
                        closeTools?.();
                        props.onOpenSettings?.();
                      }}
                    >
                      <WorkspaceIcon name="sliders" size={15} /> 设置与快捷键
                    </button>
                  </>
                )}
              </>
            )}
          </WorkspacePopover>
          {!compact && search}
          {props.onOpenSettings && (
            <button
              type="button"
              className="wst-tool"
              aria-label="设置与快捷键"
              title="偏好设置与画布快捷键"
              data-testid="toolbar-settings-btn"
              onClick={() => {
                closeTools?.();
                props.onOpenSettings?.();
              }}
            >
              <WorkspaceIcon name="sliders" size={15} />{' '}
              <span className="wst-tool-label">设置</span>
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      <nav className="wst-toolbar" aria-label="画布操作" hidden={props.projectView !== 'canvas'}>
        {compact && (
          <>
            {addNode}
            {directory}
            {search}
            {inspector}
          </>
        )}
        <CanvasToolOverflow compact={compact}>{renderToolGroups}</CanvasToolOverflow>
        {!compact && (
          <>
            {directory}
            {inspector}
          </>
        )}
      </nav>
    </>
  );
}
