import { useMemo, useState } from 'react';
import type { MultiSpineHighlight } from '@workspacetree/layout';
import type { DomainState } from '@workspacetree/schema';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  extractProjectStructure,
  type BranchSummaryItem,
  type ReferenceSummaryItem,
  type SpineSummaryItem,
} from './project-branches';

export interface BranchManagerProps {
  domain: DomainState;
  readOnly: boolean;
  highlightSpineIds: string[];
  highlight: MultiSpineHighlight;
  onToggleSpine: (id: string) => void;
  onClearSpines: () => void;
  onCreateSpine: () => void;
  onRenameSpine: (id: string, title: string) => void;
  onRemoveSpine: (id: string) => void;
  onLocateNode: (id: string) => void;
  onCreateSpineForLeaf: (leafNodeId: string, title: string) => void;
  onClose?: () => void;
}

export default function BranchManager({
  domain,
  readOnly,
  highlightSpineIds,
  highlight,
  onToggleSpine,
  onClearSpines,
  onCreateSpine,
  onRenameSpine,
  onRemoveSpine,
  onLocateNode,
  onCreateSpineForLeaf,
}: BranchManagerProps) {
  const [tab, setTab] = useState<'spines' | 'branches' | 'references'>('spines');
  const [editingSpineId, setEditingSpineId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const structure = useMemo(() => extractProjectStructure(domain), [domain]);
  const highlightedCount = highlight.paths.length;

  function startRename(spine: SpineSummaryItem) {
    if (readOnly) return;
    setEditingSpineId(spine.id);
    setEditingTitle(spine.title);
  }

  function commitRename(spineId: string) {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      onRenameSpine(spineId, trimmed);
    }
    setEditingSpineId(null);
  }

  function handleKeyDown(event: React.KeyboardEvent, spineId: string) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename(spineId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditingSpineId(null);
    }
  }

  return (
    <div className="wst-branch-manager" data-testid="branch-manager">
      <div className="wst-popover-heading">主线与分支管理</div>

      {/* 选项卡导航 */}
      <div className="wst-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'spines'}
          className={`wst-tab-btn${tab === 'spines' ? ' is-active' : ''}`}
          data-testid="tab-spines"
          onClick={() => setTab('spines')}
        >
          <WorkspaceIcon name="route" size={13} />
          主线 ({structure.spines.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'branches'}
          className={`wst-tab-btn${tab === 'branches' ? ' is-active' : ''}`}
          data-testid="tab-branches"
          onClick={() => setTab('branches')}
        >
          <WorkspaceIcon name="branch" size={13} />
          分支 ({structure.branches.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'references'}
          className={`wst-tab-btn${tab === 'references' ? ' is-active' : ''}`}
          data-testid="tab-references"
          onClick={() => setTab('references')}
        >
          <WorkspaceIcon name="layers" size={13} />
          引用 ({structure.references.length})
        </button>
      </div>

      {/* 主线列表 */}
      {tab === 'spines' && (
        <div className="wst-tab-panel" role="tabpanel" data-testid="panel-spines">
          {structure.spines.length > 0 ? (
            <div className="wst-branch-list" role="group" aria-label="主干列表">
              {structure.spines.map((spine) => {
                const isEditing = editingSpineId === spine.id;
                const isChecked = highlightSpineIds.includes(spine.id);

                return (
                  <div
                    key={spine.id}
                    className="wst-branch-item"
                    data-testid={`spine-item-${spine.id}`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`spine-${spine.id}`}
                      checked={isChecked}
                      aria-label={`高亮主干 ${spine.title}`}
                      onChange={() => onToggleSpine(spine.id)}
                    />
                    <div className="wst-branch-item-main">
                      {isEditing ? (
                        <input
                          type="text"
                          className="wst-inline-input"
                          data-testid={`spine-rename-input-${spine.id}`}
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, spine.id)}
                          onBlur={() => commitRename(spine.id)}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="wst-branch-item-title"
                          title="双击重命名"
                          onDoubleClick={() => startRename(spine)}
                        >
                          {spine.title}
                        </div>
                      )}
                      <div className="wst-branch-item-sub">
                        {spine.nodeCount} 节点 · {spine.startTitle} → {spine.endTitle}
                      </div>
                    </div>

                    <div className="wst-branch-actions">
                      <button
                        type="button"
                        className="wst-branch-icon-btn"
                        title="在画布中定位终点"
                        aria-label={`定位主干 ${spine.title}`}
                        data-testid={`spine-locate-${spine.id}`}
                        onClick={() => onLocateNode(spine.leafNodeId)}
                      >
                        <WorkspaceIcon name="fit" size={13} />
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            className="wst-branch-icon-btn"
                            title="重命名主干"
                            aria-label={`重命名主干 ${spine.title}`}
                            data-testid={`spine-rename-${spine.id}`}
                            onClick={() => startRename(spine)}
                          >
                            <WorkspaceIcon name="pencil" size={13} />
                          </button>
                          <button
                            type="button"
                            className="wst-branch-icon-btn is-danger"
                            title="删除主干"
                            aria-label={`删除主干 ${spine.title}`}
                            data-testid={`spine-delete-${spine.id}`}
                            onClick={() => onRemoveSpine(spine.id)}
                          >
                            <WorkspaceIcon name="trash" size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="wst-muted">
              还没有主线。选中节点点击「创建主干」可将从根到该节点的路径保存为主干。
            </p>
          )}

          {highlightedCount > 0 && (
            <p className="wst-spine-summary" data-testid="spine-summary">
              当前高亮 {highlightedCount} 条主干 · {highlight.nodeIds.length} 个节点 ·{' '}
              {highlight.edgeIds.length} 条连线
            </p>
          )}

          <div className="wst-menu-footer">
            <button
              type="button"
              className="wst-tool"
              data-testid="create-spine"
              disabled={readOnly}
              onClick={onCreateSpine}
            >
              <WorkspaceIcon name="plus" size={14} /> 创建主干
            </button>
            <button
              type="button"
              className="wst-tool"
              data-testid="clear-spines"
              disabled={!highlightedCount}
              onClick={onClearSpines}
            >
              清除高亮
            </button>
          </div>
        </div>
      )}

      {/* 分支列表 (侧枝、独立与粘贴分支) */}
      {tab === 'branches' && (
        <div className="wst-tab-panel" role="tabpanel" data-testid="panel-branches">
          {structure.branches.length > 0 ? (
            <div className="wst-branch-list" role="group" aria-label="分支列表">
              {structure.branches.map((branch: BranchSummaryItem) => (
                <div
                  key={branch.id}
                  className="wst-branch-item"
                  data-testid={`branch-item-${branch.id}`}
                >
                  <span
                    className="wst-branch-dot"
                    style={{ backgroundColor: branch.color }}
                    title={`分支颜色 ${branch.color}`}
                  />
                  <div className="wst-branch-item-main">
                    <div className="wst-branch-item-header">
                      <span className="wst-branch-item-title">{branch.title}</span>
                      <span className="wst-branch-badge">{branch.nodeCount} 节点</span>
                      {branch.isIndependent && (
                        <span className="wst-branch-badge is-independent">独立/粘贴</span>
                      )}
                    </div>
                    <div className="wst-branch-item-sub">
                      {branch.parentTitle ? `分叉自: ${branch.parentTitle}` : '独立分支 (未连接)'}
                    </div>
                  </div>

                  <div className="wst-branch-actions">
                    <button
                      type="button"
                      className="wst-branch-icon-btn"
                      title="在画布中定位此分支"
                      aria-label={`定位分支 ${branch.title}`}
                      data-testid={`branch-locate-${branch.id}`}
                      onClick={() => onLocateNode(branch.id)}
                    >
                      <WorkspaceIcon name="fit" size={13} />
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        className="wst-branch-icon-btn"
                        title="将此分支末端设为主干"
                        aria-label={`设为主干 ${branch.title}`}
                        data-testid={`branch-promote-${branch.id}`}
                        onClick={() =>
                          onCreateSpineForLeaf(branch.deepestLeafId, `${branch.title} 主干`)
                        }
                      >
                        <WorkspaceIcon name="route" size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="wst-muted">
              暂无侧枝或独立分支。在节点下创建分叉或粘贴分支后将在此自动汇总。
            </p>
          )}
        </div>
      )}

      {/* 引用关系 */}
      {tab === 'references' && (
        <div className="wst-tab-panel" role="tabpanel" data-testid="panel-references">
          {structure.references.length > 0 ? (
            <div className="wst-branch-list" role="group" aria-label="引用关系列表">
              {structure.references.map((ref: ReferenceSummaryItem, index) => {
                if (ref.type === 'project_ref') {
                  return (
                    <div
                      key={`pref-${ref.projectId}-${index}`}
                      className="wst-branch-item"
                      data-testid={`pref-item-${ref.projectId}`}
                    >
                      <WorkspaceIcon name="folder" size={14} />
                      <div className="wst-branch-item-main">
                        <div className="wst-branch-item-header">
                          <span className="wst-branch-item-title">{ref.projectId}</span>
                          <span className="wst-branch-badge">项目引用 [{ref.mode}]</span>
                        </div>
                        <div className="wst-branch-item-sub">
                          {ref.hostTitle ? `宿主: ${ref.hostTitle}` : '未挂载节点'}
                        </div>
                      </div>
                      {ref.hostNodeId && (
                        <div className="wst-branch-actions">
                          <button
                            type="button"
                            className="wst-branch-icon-btn"
                            title="定位宿主节点"
                            aria-label={`定位宿主节点 ${ref.hostTitle}`}
                            onClick={() => onLocateNode(ref.hostNodeId!)}
                          >
                            <WorkspaceIcon name="fit" size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                const isDep = ref.edgeType === 'dependency';
                return (
                  <div
                    key={`eref-${ref.id}`}
                    className="wst-branch-item"
                    data-testid={`eref-item-${ref.id}`}
                  >
                    <span
                      className="wst-branch-dot"
                      style={{ backgroundColor: isDep ? '#dc2626' : '#c026d3' }}
                      title={isDep ? '依赖连线' : '参考关联连线'}
                    />
                    <div className="wst-branch-item-main">
                      <div className="wst-branch-item-header">
                        <span className="wst-branch-item-title">
                          {ref.fromTitle} → {ref.toTitle}
                        </span>
                        <span className="wst-branch-badge">{isDep ? '前置依赖' : '关联参考'}</span>
                      </div>
                      {ref.note && <div className="wst-branch-item-sub">{ref.note}</div>}
                    </div>
                    <div className="wst-branch-actions">
                      <button
                        type="button"
                        className="wst-branch-icon-btn"
                        title={`定位起点: ${ref.fromTitle}`}
                        aria-label={`定位起点 ${ref.fromTitle}`}
                        onClick={() => onLocateNode(ref.fromNodeId)}
                      >
                        <WorkspaceIcon name="arrow" size={12} />
                      </button>
                      <button
                        type="button"
                        className="wst-branch-icon-btn"
                        title={`定位终点: ${ref.toTitle}`}
                        aria-label={`定位终点 ${ref.toTitle}`}
                        onClick={() => onLocateNode(ref.toNodeId)}
                      >
                        <WorkspaceIcon name="fit" size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="wst-muted">暂无跨项目引用或跨分支关联连线。</p>
          )}
        </div>
      )}
    </div>
  );
}
