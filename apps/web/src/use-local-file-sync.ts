import { useEffect, useState } from 'react';
import type { EditorController } from './editor';
import { localFileSyncMessage, type LocalFileConnection } from './local-file-access';

export function useLocalFileSync(
  editor: EditorController | undefined,
  connection: LocalFileConnection | undefined,
  editing: boolean,
): string | null {
  const [failure, setFailure] = useState<{
    connection: LocalFileConnection;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!connection || !editor) return;
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
        await editor.refreshFromFile(() => connection.storage.refresh(canApply));
        if (!cancelled) setFailure(null);
      } catch (cause) {
        if (!cancelled) {
          const message = localFileSyncMessage(cause);
          setFailure((current) =>
            current?.connection === connection && current.message === message
              ? current
              : { connection, message },
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
  }, [connection, editor, editing]);

  return failure && failure.connection === connection ? failure.message : null;
}
