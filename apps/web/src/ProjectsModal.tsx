import type { IdbJsonStorageAdapter, StoredProjectSummary } from '@workspacetree/storage';
import { useCallback, useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';

interface ProjectsModalProps {
  open: boolean;
  onClose: () => void;
  storage: IdbJsonStorageAdapter | null;
  openProjectIds: string[];
  onOpenProject: (projectId: string) => Promise<void>;
  onCreateProject: () => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

export default function ProjectsModal({
  open,
  onClose,
  storage,
  openProjectIds,
  onOpenProject,
  onCreateProject,
  onDeleteProject,
}: ProjectsModalProps) {
  const [projects, setProjects] = useState<StoredProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    if (!storage) return;
    setLoading(true);
    setError(null);
    try {
      const list = await storage.listProjects();
      // Sort projects: open projects first, then by title
      list.sort((a, b) => {
        const aOpen = openProjectIds.includes(a.projectId) ? 1 : 0;
        const bOpen = openProjectIds.includes(b.projectId) ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
        return a.title.localeCompare(b.title);
      });
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [storage, openProjectIds]);

  useEffect(() => {
    if (open) {
      void loadProjects();
    }
  }, [open, loadProjects]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleDelete(projectId: string, title: string) {
    if (typeof window !== 'undefined' && window.confirm) {
      const ok = window.confirm(`确定要删除项目 "${title}" 吗？此操作无法撤销。`);
      if (!ok) return;
    }
    try {
      await onDeleteProject(projectId);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="wst-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="projects-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wst-settings-modal wst-projects-modal">
        <div className="wst-modal-header">
          <h2 id="projects-modal-title">
            <WorkspaceIcon name="folder" size={18} /> 本地项目管理
          </h2>
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label="关闭项目管理面板"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        <div className="wst-modal-body">
          <div className="wst-projects-toolbar">
            <p className="wst-settings-desc" style={{ margin: 0 }}>
              浏览并切换已保存在浏览器本地（IndexedDB）中的项目分支。
            </p>
            <button
              type="button"
              className="wst-tool is-primary"
              onClick={async () => {
                await onCreateProject();
                onClose();
              }}
            >
              <WorkspaceIcon name="plus" size={14} /> <span>新建空白项目</span>
            </button>
          </div>

          {error && <div className="wst-modal-error">{error}</div>}

          {loading ? (
            <div className="wst-projects-loading">正在读取本地存储项目…</div>
          ) : projects.length === 0 ? (
            <div className="wst-projects-empty">本地暂无保存的项目记录</div>
          ) : (
            <div className="wst-projects-list">
              {projects.map((p) => {
                const isOpen = openProjectIds.includes(p.projectId);
                return (
                  <div key={p.projectId} className={`wst-project-card ${isOpen ? 'is-open' : ''}`}>
                    <div className="wst-project-card-info">
                      <div className="wst-project-card-title-row">
                        <span className="wst-project-card-title">{p.title}</span>
                        {isOpen && <span className="wst-project-badge-open">已在标签页打开</span>}
                      </div>
                      <div className="wst-project-card-meta">
                        <span className="wst-project-card-id">{p.projectId}</span>
                        <span>分支: {p.activeBranch}</span>
                        <span>节点: {p.nodeCount}</span>
                      </div>
                    </div>
                    <div className="wst-project-card-actions">
                      <button
                        type="button"
                        className={`wst-tool ${isOpen ? 'is-subtle' : 'is-primary'}`}
                        onClick={async () => {
                          await onOpenProject(p.projectId);
                          onClose();
                        }}
                      >
                        {isOpen ? '切换到' : '打开'}
                      </button>
                      <button
                        type="button"
                        className="wst-tool is-danger is-icon"
                        title="删除项目"
                        aria-label={`删除项目 ${p.title}`}
                        onClick={() => void handleDelete(p.projectId, p.title)}
                      >
                        <WorkspaceIcon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="wst-modal-footer">
          <span className="wst-projects-count">共 {projects.length} 个本地保存项目</span>
          <button type="button" className="wst-tool is-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
