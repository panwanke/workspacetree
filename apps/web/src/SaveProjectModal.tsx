import { FILE_SUFFIX } from '@workspacetree/schema';
import type { BranchFile } from '@workspacetree/schema';
import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  hasNativeSavePicker,
  sanitizeFilename,
  saveProjectWithNativePicker,
  triggerDownload,
} from './save-project';

interface SaveProjectModalProps {
  open: boolean;
  onClose: () => void;
  file: BranchFile | null;
  onSaved?: (filename: string) => void;
}

export default function SaveProjectModal({ open, onClose, file, onSaved }: SaveProjectModalProps) {
  const [filenameInput, setFilenameInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && file) {
      const defaultTitle = file.domain.project.title?.trim() || file.projectId;
      setFilenameInput(sanitizeFilename(defaultTitle));
      setError(null);
    }
  }, [open, file]);

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

  if (!open || !file) return null;

  const canUseNativePicker = hasNativeSavePicker();

  async function handleNativeSave() {
    if (!file) return;
    const sanitized = sanitizeFilename(filenameInput);
    if (!sanitized) {
      setError('请输入有效的文件名');
      return;
    }
    const result = await saveProjectWithNativePicker(file, sanitized);
    if ('fallbackNeeded' in result) {
      handleDownload();
      return;
    }
    if (result.success) {
      onSaved?.(result.filename);
      onClose();
    } else if ('error' in result) {
      setError(result.error);
    }
  }

  function handleDownload() {
    if (!file) return;
    const sanitized = sanitizeFilename(filenameInput);
    if (!sanitized) {
      setError('请输入有效的文件名');
      return;
    }
    const fullName = sanitized.endsWith(FILE_SUFFIX.project)
      ? sanitized
      : `${sanitized}${FILE_SUFFIX.project}`;
    const content = `${JSON.stringify(file, null, 2)}\n`;
    triggerDownload(fullName, content, 'application/json');
    onSaved?.(fullName);
    onClose();
  }

  return (
    <div
      className="wst-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wst-settings-modal wst-save-modal">
        <div className="wst-modal-header">
          <h2 id="save-modal-title">
            <WorkspaceIcon name="download" size={18} /> 另存为分支项目文件
          </h2>
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label="关闭保存面板"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        <div className="wst-modal-body">
          <p className="wst-settings-desc">
            为当前分支项目设定保存文件名，并选择保存到本地磁盘目录或直接下载。
          </p>

          {error && <div className="wst-modal-error">{error}</div>}

          <div className="wst-save-field">
            <label htmlFor="wst-save-filename-input" className="wst-save-label">
              文件名称：
            </label>
            <div className="wst-save-input-group">
              <input
                id="wst-save-filename-input"
                type="text"
                className="wst-save-input"
                value={filenameInput}
                onChange={(e) => {
                  setFilenameInput(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canUseNativePicker) {
                      void handleNativeSave();
                    } else {
                      handleDownload();
                    }
                  }
                }}
                placeholder="请输入文件名"
                autoFocus
              />
              <span className="wst-save-suffix">{FILE_SUFFIX.project}</span>
            </div>
          </div>

          <div className="wst-save-tips">
            <p className="wst-save-tip">
              💡 <strong>另存为</strong>
              ：将唤起操作系统文件对话框，允许自由浏览选择存储文件夹与完整路径。
            </p>
          </div>
        </div>

        <div className="wst-modal-footer">
          <button type="button" className="wst-tool is-subtle" onClick={onClose}>
            取消
          </button>
          <div className="wst-save-actions">
            <button
              type="button"
              className="wst-tool"
              onClick={handleDownload}
              title="下载至浏览器默认下载文件夹"
            >
              直接下载
            </button>
            <button
              type="button"
              className="wst-tool is-primary"
              onClick={() => void handleNativeSave()}
              title="唤起系统文件选择窗口，自选保存目录与名称"
            >
              <WorkspaceIcon name="download" size={14} /> <span>选择位置另存为...</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
