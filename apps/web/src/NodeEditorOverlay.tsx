import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRecord } from '@workspacetree/schema';
import { MarkdownEditor } from './markdown/MarkdownEditor';
import { WorkspaceIcon } from './WorkspaceIcon';

export interface NodeEditorOverlayProps {
  id: string;
  title: string;
  note: string;
  assets?: Record<string, AssetRecord>;
  autoSaveEnabled?: boolean;
  autoSaveInterval?: number;
  onSave: (
    id: string,
    title: string,
    note: string,
    baseNote: string,
    assets?: Record<string, AssetRecord>,
  ) => Promise<boolean>;
  onClose: () => void;
}

export function NodeEditorOverlay({
  id,
  title,
  note,
  assets,
  autoSaveEnabled = true,
  autoSaveInterval = 5000,
  onSave,
  onClose,
}: NodeEditorOverlayProps) {
  const [titleDraft, setTitleDraft] = useState(title);
  const [noteDraft, setNoteDraft] = useState(note);
  const [draftAssets, setDraftAssets] = useState<Record<string, AssetRecord>>({});
  const isCancellingRef = useRef(false);
  const committingRef = useRef(false);
  const autoSaveRef = useRef<Promise<void> | null>(null);

  const titleDraftRef = useRef(titleDraft);
  const noteDraftRef = useRef(noteDraft);
  const draftAssetsRef = useRef(draftAssets);
  const lastSavedRef = useRef<{
    title: string;
    note: string;
    assets: Record<string, AssetRecord>;
  }>({
    title,
    note,
    assets: {},
  });

  titleDraftRef.current = titleDraft;
  noteDraftRef.current = noteDraft;
  draftAssetsRef.current = draftAssets;

  const commitDraft = useCallback(async () => {
    if (isCancellingRef.current || committingRef.current) return;
    committingRef.current = true;
    try {
      if (autoSaveRef.current) await autoSaveRef.current;
      if (isCancellingRef.current) return;
      const currentTitle = titleDraftRef.current.trim() || title;
      const currentNote = noteDraftRef.current;
      const currentAssets = draftAssetsRef.current;
      const saved = await onSave(
        id,
        currentTitle,
        currentNote,
        lastSavedRef.current.note,
        currentAssets,
      );
      if (saved) {
        lastSavedRef.current = { title: currentTitle, note: currentNote, assets: currentAssets };
        onClose();
      }
    } finally {
      committingRef.current = false;
    }
  }, [id, title, onSave, onClose]);

  // 定时自动保存 (默认 5s 周期)
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const intervalMs = autoSaveInterval ?? 5000;
    const timer = setInterval(() => {
      if (isCancellingRef.current || committingRef.current || autoSaveRef.current) return;
      const currentTitle = titleDraftRef.current.trim() || title;
      const currentNote = noteDraftRef.current;
      const currentAssets = draftAssetsRef.current;
      const last = lastSavedRef.current;

      const hasChanged =
        currentTitle !== last.title ||
        currentNote !== last.note ||
        JSON.stringify(currentAssets) !== JSON.stringify(last.assets);

      if (hasChanged) {
        autoSaveRef.current = onSave(
          id,
          currentTitle,
          currentNote,
          last.note,
          currentAssets,
        )
          .then((saved) => {
            if (saved) {
              lastSavedRef.current = {
                title: currentTitle,
                note: currentNote,
                assets: { ...currentAssets },
              };
            }
          })
          .finally(() => {
            autoSaveRef.current = null;
          });
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [id, title, autoSaveEnabled, autoSaveInterval, onSave]);

  const handleCancel = useCallback(() => {
    isCancellingRef.current = true;
    onClose();
  }, [onClose]);

  return (
    <div
      className="wst-editor-overlay-backdrop"
      onClick={() => {
        void commitDraft();
      }}
    >
      <div
        className="wst-editor-overlay-card nodrag nopan nowheel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="编辑节点内容"
      >
        <div className="wst-editor-overlay-header">
          <input
            className="wst-card-edit-title"
            value={titleDraft}
            autoFocus
            placeholder="节点标题"
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.key === 'Enter' && !event.shiftKey) ||
                ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
              ) {
                event.preventDefault();
                void commitDraft();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                handleCancel();
              }
            }}
          />
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label="关闭编辑器"
            onClick={handleCancel}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        <div className="wst-editor-overlay-body">
          <MarkdownEditor
            value={noteDraft}
            assets={assets}
            onChange={(val) => setNoteDraft(val)}
            onAssetsChange={(nextAssets) => setDraftAssets(nextAssets)}
            onSave={(nextAssets) => {
              if (nextAssets) {
                draftAssetsRef.current = nextAssets;
                setDraftAssets(nextAssets);
              }
              void commitDraft();
            }}
            onCancel={handleCancel}
            autoFocus={false}
            placeholder="输入 Markdown 笔记... 支持五态任务 [ ] / [x] / [-] / [~] / [?]，Callout 提示框与公式"
          />
        </div>

        <div className="wst-editor-overlay-footer">
          {autoSaveEnabled && (
            <div
              className="wst-card-autosave-tip"
              title="离开节点自动保存；持续编辑期间每5秒自动保存"
            >
              <span className="wst-card-autosave-dot" /> 自动保存已开启
            </div>
          )}
          <span className="wst-editor-overlay-shortcut-hint">按 Esc 取消 · Ctrl+S 或点击外部保存</span>
          <button
            type="button"
            className="wst-card-btn-cancel"
            onClick={handleCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="wst-card-btn-save"
            onClick={() => void commitDraft()}
          >
            保存 (Ctrl+S)
          </button>
        </div>
      </div>
    </div>
  );
}
