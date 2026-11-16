import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  DEFAULT_KEYBINDINGS,
  formatKeyboardEventToKeybinding,
  saveKeybindings,
  type KeybindingAction,
} from './keybindings';
import { DEFAULT_SETTINGS, saveSettings, type WorkspaceSettings } from './settings';
import { createMarkdownStyleSheet } from './markdown/custom-css';

export interface SettingsModalProps {
  open: boolean;
  settings?: WorkspaceSettings;
  keybindings: Record<KeybindingAction, string>;
  onClose: () => void;
  onChangeSettings?: (next: WorkspaceSettings) => void;
  onChangeKeybindings: (next: Record<KeybindingAction, string>) => void;
}

type SettingsTab = 'all' | 'general' | 'keybindings';

export default function SettingsModal({
  open,
  settings = DEFAULT_SETTINGS,
  keybindings,
  onClose,
  onChangeSettings,
  onChangeKeybindings,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('all');
  const [recordingAction, setRecordingAction] = useState<KeybindingAction | null>(null);
  const [draftMarkdownCss, setDraftMarkdownCss] = useState<string | null>(null);
  const [markdownCssError, setMarkdownCssError] = useState(false);
  const markdownCss = draftMarkdownCss ?? settings.markdownCss;

  useEffect(() => {
    if (!open) {
      setDraftMarkdownCss(null);
      setMarkdownCssError(false);
    }
  }, [open]);

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

      const isDragModifier = DEFAULT_KEYBINDINGS[recordingAction]?.category === 'drag';
      const formatted = formatKeyboardEventToKeybinding(event, isDragModifier);
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

  const canvasActions = (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).filter(
    (act) => DEFAULT_KEYBINDINGS[act].category !== 'drag',
  );
  const dragActions = (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).filter(
    (act) => DEFAULT_KEYBINDINGS[act].category === 'drag',
  );

  function handleToggleAutoSave() {
    const next: WorkspaceSettings = {
      ...settings,
      autoSaveNode: !settings.autoSaveNode,
    };
    onChangeSettings?.(next);
    saveSettings(next);
  }

  function updateMarkdownCss(css: string) {
    const value = css.trim() ? css : '';
    try {
      if (value) createMarkdownStyleSheet(value);
    } catch {
      setMarkdownCssError(true);
      return;
    }
    const next = { ...settings, markdownCss: value };
    onChangeSettings?.(next);
    saveSettings(next);
    setDraftMarkdownCss(null);
    setMarkdownCssError(false);
  }

  function handleResetAll() {
    const nextBindings = Object.fromEntries(
      Object.entries(DEFAULT_KEYBINDINGS).map(([k, v]) => [k, v.defaultKey]),
    ) as Record<KeybindingAction, string>;
    onChangeKeybindings(nextBindings);
    saveKeybindings(nextBindings);

    const nextSettings = { ...DEFAULT_SETTINGS };
    onChangeSettings?.(nextSettings);
    saveSettings(nextSettings);
    setDraftMarkdownCss(null);
    setMarkdownCssError(false);
  }

  function handleResetOne(action: KeybindingAction) {
    const next = { ...keybindings, [action]: DEFAULT_KEYBINDINGS[action].defaultKey };
    onChangeKeybindings(next);
    saveKeybindings(next);
  }

  function handleSelectOption(action: KeybindingAction, key: string) {
    const next = { ...keybindings, [action]: key };
    onChangeKeybindings(next);
    saveKeybindings(next);
  }

  const renderRow = (act: KeybindingAction) => {
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
          {meta.options && (
            <div className="wst-keybinding-options">
              {meta.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`wst-keybinding-opt-btn${currentKey === opt ? ' is-active' : ''}`}
                  onClick={() => handleSelectOption(act, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className={`wst-keybinding-badge ${isRecording ? 'is-recording' : ''}`}
            title={isRecording ? '请在键盘上按下新按键（Esc 取消）' : '点击通过键盘录制修改'}
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
  };

  const showGeneral = activeTab === 'all' || activeTab === 'general';
  const showKeybindings = activeTab === 'all' || activeTab === 'keybindings';

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
            <WorkspaceIcon name="sliders" size={18} /> 设置与快捷键
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
          <div className="wst-settings-tabs" role="tablist" aria-label="设置类别">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'all'}
              className={`wst-settings-tab-btn${activeTab === 'all' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              全部设置
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'general'}
              className={`wst-settings-tab-btn${activeTab === 'general' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              通用
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'keybindings'}
              className={`wst-settings-tab-btn${activeTab === 'keybindings' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('keybindings')}
            >
              快捷键修改
            </button>
          </div>

          {showGeneral && (
            <div className="wst-settings-section" style={{ marginBottom: 20 }}>
              <div className="wst-keybindings-section-title">节点编辑与自动保存</div>
              <p className="wst-settings-desc">
                控制卡片节点在编辑过程中的保存策略，开启后无需反复手动点击保存按钮。
              </p>

              <div className="wst-setting-item">
                <div className="wst-setting-info">
                  <span className="wst-setting-title">离开节点自动保存 / 每 5s 自动保存</span>
                  <span className="wst-setting-desc">
                    编辑节点时，移出节点或点击画布空白处自动保存；持续编辑期间每 5
                    秒自动保存草稿以防意外丢失。
                  </span>
                </div>
                <div className="wst-switch-control">
                  <span className={`wst-switch-status${settings.autoSaveNode ? ' is-active' : ''}`}>
                    {settings.autoSaveNode ? '已开启' : '已关闭'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.autoSaveNode}
                    aria-label="切换离开或每5秒自动保存"
                    className={`wst-switch${settings.autoSaveNode ? ' is-checked' : ''}`}
                    onClick={handleToggleAutoSave}
                  >
                    <span className="wst-switch-thumb" />
                  </button>
                </div>
              </div>

              <div className="wst-markdown-css-setting">
                <label className="wst-keybindings-section-title" htmlFor="markdown-custom-css">
                  Markdown 自定义 CSS
                </label>
                <p className="wst-settings-desc" id="markdown-custom-css-help">
                  仅作用于 Markdown 预览和编辑区，保存在当前浏览器。用 <code>:scope</code>{' '}
                  选中整个区域，用 <code>:scope .cm-content</code> 选中编辑正文。
                </p>
                <textarea
                  id="markdown-custom-css"
                  className="wst-markdown-css-input"
                  aria-describedby="markdown-custom-css-help"
                  aria-invalid={markdownCssError}
                  spellCheck={false}
                  rows={5}
                  placeholder={':scope ul, :scope ol {\n  padding-inline-start: 1.2em;\n}'}
                  value={markdownCss}
                  onChange={(event) => {
                    setDraftMarkdownCss(event.target.value);
                    setMarkdownCssError(false);
                  }}
                />
                {markdownCssError && (
                  <p className="wst-settings-css-error" role="alert">
                    无法应用这段 CSS。请检查规则的大括号，或使用支持 CSS @scope 的浏览器。
                  </p>
                )}
                <div className="wst-section-actions">
                  <button
                    type="button"
                    className="wst-tool is-subtle"
                    disabled={!markdownCss && !settings.markdownCss}
                    onClick={() => updateMarkdownCss('')}
                  >
                    恢复 Markdown 默认样式
                  </button>
                  <button
                    type="button"
                    className="wst-tool is-accent"
                    disabled={markdownCss === settings.markdownCss}
                    onClick={() => updateMarkdownCss(markdownCss)}
                  >
                    应用 CSS
                  </button>
                </div>
              </div>
            </div>
          )}

          {showKeybindings && (
            <div className="wst-settings-section">
              <div className="wst-keybindings-section-title">常用画布快捷键</div>
              <p className="wst-settings-desc">
                点击按键框后直接按下键盘新键即可修改，或点击预设修饰键标签快速切换。
              </p>
              <div className="wst-keybindings-list">{canvasActions.map(renderRow)}</div>

              <div className="wst-keybindings-section-title" style={{ marginTop: 20 }}>
                节点四角拖拽缩放修饰键
              </div>
              <p className="wst-settings-desc" style={{ marginBottom: 10 }}>
                拖动选中节点的四角调整大小时，按住以下修饰键触发不同的缩放行为。
              </p>
              <div className="wst-keybindings-list">{dragActions.map(renderRow)}</div>
            </div>
          )}
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
