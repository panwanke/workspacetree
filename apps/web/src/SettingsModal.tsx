import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  DEFAULT_KEYBINDINGS,
  formatKeyboardEventToKeybinding,
  saveKeybindings,
  type KeybindingAction,
} from './keybindings';

interface SettingsModalProps {
  open: boolean;
  keybindings: Record<KeybindingAction, string>;
  onClose: () => void;
  onChangeKeybindings: (next: Record<KeybindingAction, string>) => void;
}

export default function SettingsModal({
  open,
  keybindings,
  onClose,
  onChangeKeybindings,
}: SettingsModalProps) {
  const [recordingAction, setRecordingAction] = useState<KeybindingAction | null>(null);

  useEffect(() => {
    if (!recordingAction) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // 按 Escape 取消本次录制
      if (event.key === 'Escape') {
        setRecordingAction(null);
        return;
      }

      const formatted = formatKeyboardEventToKeybinding(event);
      if (formatted) {
        const next = { ...keybindings, [recordingAction]: formatted };
        onChangeKeybindings(next);
        saveKeybindings(next);
        setRecordingAction(null);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [recordingAction, keybindings, onChangeKeybindings]);

  if (!open) return null;

  const actions = Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[];

  function handleResetAll() {
    const next: Record<KeybindingAction, string> = Object.fromEntries(
      (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).map((action) => [
        action,
        DEFAULT_KEYBINDINGS[action].defaultKey,
      ]),
    ) as Record<KeybindingAction, string>;
    onChangeKeybindings(next);
    saveKeybindings(next);
  }

  function handleResetOne(action: KeybindingAction) {
    const next = { ...keybindings, [action]: DEFAULT_KEYBINDINGS[action].defaultKey };
    onChangeKeybindings(next);
    saveKeybindings(next);
  }

  return (
    <div
      className="wst-modal-backdrop"
      onClick={() => {
        setRecordingAction(null);
        onClose();
      }}
    >
      <div
        className="wst-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wst-modal-header">
          <h2 id="settings-modal-title">
            <WorkspaceIcon name="sliders" size={18} /> 画布快捷键设置
          </h2>
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label="关闭设置面板"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        <div className="wst-modal-body">
          <p className="wst-settings-desc">
            点击下方按键框后直接按下键盘新快捷键即可修改。支持单键与组合键（如
            Delete、Tab、r、Ctrl+Z 等）。
          </p>

          <div className="wst-keybindings-list">
            {actions.map((act) => {
              const meta = DEFAULT_KEYBINDINGS[act];
              const currentKey = keybindings[act] ?? meta.defaultKey;
              const isRecording = recordingAction === act;
              const isCustomized = currentKey !== meta.defaultKey;

              return (
                <div key={act} className="wst-keybinding-row">
                  <div className="wst-keybinding-info">
                    <span className="wst-keybinding-label">{meta.label}</span>
                    <span className="wst-keybinding-desc">{meta.description}</span>
                  </div>

                  <div className="wst-keybinding-controls">
                    <button
                      type="button"
                      className={`wst-keybinding-badge ${isRecording ? 'is-recording' : ''}`}
                      title={isRecording ? '请在键盘上按下新按键（Esc 取消）' : '点击修改快捷键'}
                      onClick={() => setRecordingAction(isRecording ? null : act)}
                    >
                      {isRecording ? '按下新按键…' : currentKey}
                    </button>

                    {isCustomized && (
                      <button
                        type="button"
                        className="wst-keybinding-reset-one"
                        title={`恢复默认（${meta.defaultKey}）`}
                        onClick={() => handleResetOne(act)}
                      >
                        <WorkspaceIcon name="reset" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="wst-modal-footer">
          <button type="button" className="wst-tool is-subtle" onClick={handleResetAll}>
            恢复全部默认
          </button>
          <button type="button" className="wst-tool is-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
