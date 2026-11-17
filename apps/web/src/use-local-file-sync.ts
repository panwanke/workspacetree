import { useEffect, useState } from 'react';
import type { EditorController } from './editor';
import { localFileSyncMessage } from './local-file-access';
import type { LinkedBranchFile } from './linked-branch-file';

export function useLocalFileSync(
  editor: EditorController | undefined,
  storage: LinkedBranchFile | undefined,
  editing: boolean,
): string | null {
  const [failure, setFailure] = useState<{
    storage: LinkedBranchFile;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!storage || !editor) return;
    let cancelled = false;
    let pending = false;
    const canApply = () => {
      const control = document.activeElement;
      const activeField = control?.matches('input, textarea, select, [contenteditable="true"]');
      const openEditor = Array.from(document.querySelectorAll('.cm-editor, [role="dialog"]')).some(
        (element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0,
      );
      return !cancelled && !editing && !editor.isDragging && !activeField && !openEditor;
    };
    const check = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        await editor.refreshFromFile(() => storage.refresh(canApply));
        if (!cancelled) setFailure(null);
      } catch (cause) {
        if (!cancelled) {
          const message = localFileSyncMessage(cause);
          setFailure((current) =>
            current?.storage === storage && current.message === message
              ? current
              : { storage, message },
          );
        }
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = window.setInterval(check, 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [storage, editor, editing]);

  return failure && failure.storage === storage ? failure.message : null;
}
