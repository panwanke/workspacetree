import type { LayoutDirection, LayoutStrategy, MultiSpineHighlight } from '@workspacetree/layout';
import type { BranchFile } from '@workspacetree/schema';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { WorkspaceIcon, type WorkspaceIconName } from './WorkspaceIcon';

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
  onToggleSpine: (id: string) => void;
  onClearSpines: () => void;
  onToggleInspector: () => void;
  onImport: () => void;
  onExportJson: () => void;
  onExportSvg: () => void;
  onResetDemo: () => void;
  onOpenSettings?: () => void;
  onOpenProjects?: () => void;
}

export default function WorkspaceToolbar(props: ToolbarProps) {
  const { domain, revisions } = props.file;
  const highlighted = props.highlight.paths.length;

  return (
    <header className="wst-header">
      <div className="wst-project-bar">
        <div className="wst-project-identity">
          <span className="wst-brand-mark">
            <WorkspaceIcon name="tree" size={21} />
          </span>
          <div className="wst-project-titles">
            <div className="wst-brand-name">WorkspaceTree</div>
            <h1 title={domain.project.title}>{domain.project.title}</h1>
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
          <span className="wst-prototype" title="开发原型，仅用于示例与测试数据">
            开发原型
          </span>
          <div className="wst-header-stats">
            <span data-testid="node-count">{domain.nodes.length} 个节点</span>
            <span data-testid="edge-count">{props.edgeCount} 条连线</span>
            <span data-testid="hidden-count">隐藏关联 {props.hiddenCount}</span>
          </div>
          <WorkspacePopover
            label="项目"
            icon="folder"
            testId="project-menu"
            className="wst-project-menu"
          >
            {(close) => (
              <>
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
                  <WorkspaceIcon name="upload" /> 导入 .branch.json
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
                  <WorkspaceIcon name="download" /> 保存 / 另存为...
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
                <hr />
                <button
                  type="button"
                  className="wst-menu-action is-danger"
                  data-testid="reset-demo"
                  disabled={props.readOnly}
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
        </div>
      </div>

      <nav className="wst-toolbar" aria-label="画布操作" hidden={props.projectView !== 'canvas'}>
        <div className="wst-toolbar-group">
          <button
            type="button"
            className="wst-tool is-primary"
            data-testid="add-node"
            disabled={props.readOnly}
            onClick={props.onAddNode}
            aria-label="新建节点"
            title="新建节点（画布内 Tab）"
          >
            <WorkspaceIcon name="plus" /> <span>新建节点</span>
          </button>
          <button
            type="button"
            className="wst-tool"
            data-testid="add-branch"
            disabled={props.readOnly}
            onClick={props.onAddBranch}
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
              onClick={props.onAddRandomBranch}
              aria-label="新建独立分支"
              title="在画布随机位置新建独立分支（快捷键 R）"
            >
              🎲 <span>新建独立分支</span>
            </button>
          )}
          <div className="wst-history-tools">
            <button
              type="button"
              className="wst-tool is-icon"
              aria-label="撤销"
              title="撤销（Ctrl / ⌘ + Z）"
              data-testid="undo"
              onClick={props.onUndo}
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
              onClick={props.onRedo}
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
            onClick={props.onFitView}
          >
            <WorkspaceIcon name="fit" />
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
            active={highlighted > 0}
          >
            {() => (
              <>
                <div className="wst-popover-heading">主干高亮</div>
                {domain.spines.length > 0 ? (
                  <div className="wst-spine-list" role="group" aria-label="同时高亮多个主干">
                    {domain.spines.map((spine) => (
                      <label key={spine.id} className="wst-spine-option">
                        <input
                          type="checkbox"
                          data-testid={`spine-${spine.id}`}
                          checked={props.highlightSpineIds.includes(spine.id)}
                          onChange={() => props.onToggleSpine(spine.id)}
                        />
                        <span>{spine.title}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="wst-muted">还没有主干。</p>
                )}
                {highlighted > 0 && (
                  <p className="wst-spine-summary" data-testid="spine-summary">
                    当前高亮 {highlighted} 条主干 · {props.highlight.nodeIds.length} 个节点 ·{' '}
                    {props.highlight.edgeIds.length} 条连线
                  </p>
                )}
                <div className="wst-menu-footer">
                  <button
                    type="button"
                    className="wst-tool"
                    data-testid="create-spine"
                    disabled={props.readOnly}
                    onClick={props.onCreateSpine}
                  >
                    <WorkspaceIcon name="plus" size={14} /> 创建主干
                  </button>
                  <button
                    type="button"
                    className="wst-tool"
                    data-testid="clear-spines"
                    disabled={!highlighted}
                    onClick={props.onClearSpines}
                  >
                    清除高亮
                  </button>
                </div>
              </>
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
                        props.onOpenSettings?.();
                      }}
                    >
                      ⌨️ 调整快捷键设置
                    </button>
                  </>
                )}
              </>
            )}
          </WorkspacePopover>
          {props.onOpenSettings && (
            <button
              type="button"
              className="wst-tool"
              aria-label="快捷键设置"
              title="调整画布快捷键"
              onClick={props.onOpenSettings}
            >
              ⌨️ <span className="wst-tool-label">快捷键</span>
            </button>
          )}
        </div>

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
      </nav>
    </header>
  );
}
