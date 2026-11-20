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
import { depthRatio } from '@workspacetree/layout';
import { DEFAULT_SCALE_SETTINGS, type ScaleSettings } from '@workspacetree/schema';

export interface SettingsModalProps {
  open: boolean;
  settings?: WorkspaceSettings;
  keybindings: Record<KeybindingAction, string>;
  scaleSettings?: ScaleSettings;
  onClose: () => void;
  onChangeSettings?: (next: WorkspaceSettings) => void;
  onChangeKeybindings: (next: Record<KeybindingAction, string>) => void;
  onChangeScaleSettings?: (next: ScaleSettings) => void;
}

type SettingsTab = 'all' | 'general' | 'scale' | 'keybindings';

export default function SettingsModal({
  open,
  settings = DEFAULT_SETTINGS,
  keybindings,
  scaleSettings = DEFAULT_SCALE_SETTINGS,
  onClose,
  onChangeSettings,
  onChangeKeybindings,
  onChangeScaleSettings,
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
    onChangeScaleSettings?.(DEFAULT_SCALE_SETTINGS);
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
  const showScale = activeTab === 'all' || activeTab === 'scale';
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
              aria-selected={activeTab === 'scale'}
              className={`wst-settings-tab-btn${activeTab === 'scale' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('scale')}
            >
              缩放规则
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

          {showScale && (
            <div className="wst-settings-section" style={{ marginBottom: 20 }}>
              <div className="wst-keybindings-section-title">新建子节点缩放策略</div>
              <p className="wst-settings-desc">
                定义在脑图树中创建子节点时的默认缩放行为。支持相对排版缩放与绝对几何缩放。
              </p>

              <div className="wst-setting-item">
                <div className="wst-setting-info">
                  <span className="wst-setting-title">默认缩放模式</span>
                  <span className="wst-setting-desc">
                    相对排版缩放：文字依层级步进变小，重新排版自适应换行；
                    <br />
                    绝对几何缩放：整体等比缩小，保持排版结构不变；
                    <br />
                    双层组合：同时应用排版与几何缩放。
                  </span>
                </div>
                <div className="wst-scale-mode-select">
                  <select
                    className="wst-select"
                    value={scaleSettings.defaultChildMode}
                    onChange={(event) =>
                      onChangeScaleSettings?.({
                        ...scaleSettings,
                        defaultChildMode: event.target.value as 'layout' | 'visual' | 'both',
                      })
                    }
                  >
                    <option value="layout">相对排版缩放 (默认推荐)</option>
                    <option value="visual">绝对几何缩放</option>
                    <option value="both">双层组合缩放</option>
                  </select>
                </div>
              </div>

              <div className="wst-keybindings-section-title" style={{ marginTop: 24 }}>
                层级—拓扑自动生长策略 (Growth Strategy)
              </div>
              <p className="wst-settings-desc" style={{ marginBottom: 12 }}>
                根据真实树深度与分叉拓扑权重自动计算节点排版基准，主枝适度强化、旁枝适度收敛，深层渐近收敛不趋零。
              </p>

              {/* 总开关 */}
              <div className="wst-setting-item">
                <div className="wst-setting-info">
                  <span className="wst-setting-title">启用自动层级拓扑生长</span>
                  <span className="wst-setting-desc">
                    开启后，新建子节点自动按深度曲线自适应收敛尺寸，手动修正初始为 100%；关闭则保持传统手动继承。
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <label className="wst-switch-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(scaleSettings.growth?.enabled)}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        const currentGrowth = scaleSettings.growth ?? DEFAULT_SCALE_SETTINGS.growth!;
                        onChangeScaleSettings?.({
                          ...scaleSettings,
                          growth: { ...currentGrowth, enabled },
                        });
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {scaleSettings.growth?.enabled ? '已开启' : '已关闭'}
                    </span>
                  </label>
                </div>
              </div>

              {scaleSettings.growth?.enabled && (
                <>
                  {/* 算法选择 */}
                  <div className="wst-setting-item">
                    <div className="wst-setting-info">
                      <span className="wst-setting-title">深度生长算法</span>
                      <span className="wst-setting-desc">
                        渐近衰减：平滑逼近基准下限，深层不触碰硬折点（新项目推荐）；<br />
                        线性递减：每层减少固定步长；固定比例：每层乘以固定衰减比。
                      </span>
                    </div>
                    <select
                      className="wst-select"
                      value={scaleSettings.growth.algorithm.type}
                      onChange={(e) => {
                        const type = e.target.value as 'asymptotic' | 'linear' | 'exponential';
                        const currentAlgo = scaleSettings.growth!.algorithm;
                        const minRatio = currentAlgo.minRatio ?? 0.55;
                        let nextAlgo = currentAlgo;
                        if (type === 'asymptotic') {
                          nextAlgo = { type: 'asymptotic', decay: 0.25, minRatio };
                        } else if (type === 'linear') {
                          nextAlgo = { type: 'linear', step: 0.10, minRatio };
                        } else {
                          nextAlgo = { type: 'exponential', ratio: 0.90, minRatio };
                        }
                        onChangeScaleSettings?.({
                          ...scaleSettings,
                          growth: {
                            ...scaleSettings.growth!,
                            algorithm: nextAlgo,
                          },
                        });
                      }}
                    >
                      <option value="asymptotic">渐近衰减 (Asymptotic - 默认推荐)</option>
                      <option value="linear">线性递减 (Linear)</option>
                      <option value="exponential">固定比例 (Exponential)</option>
                    </select>
                  </div>

                  {/* 算法参数 */}
                  {scaleSettings.growth.algorithm.type === 'asymptotic' && (
                    <div className="wst-setting-item">
                      <div className="wst-setting-info">
                        <span className="wst-setting-title">渐近衰减系数 (k) 与下限 (gMin)</span>
                        <span className="wst-setting-desc">
                          衰减系数 k 越大收敛越快（默认 0.25）；下限 gMin 为深度无限时的渐近底线（默认 0.55）。
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>k:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.05"
                          max="1.0"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.decay}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  decay: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                        <span style={{ marginLeft: 6 }}>gMin:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.3"
                          max="0.8"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.minRatio}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  minRatio: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {scaleSettings.growth.algorithm.type === 'linear' && (
                    <div className="wst-setting-item">
                      <div className="wst-setting-info">
                        <span className="wst-setting-title">每级递减步长 (step) 与下限 (gMin)</span>
                        <span className="wst-setting-desc">
                          每深入一层减少比例（默认 0.10，即 -10%）；触及 gMin（默认 0.55）后保持平台。
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>step:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.05"
                          max="0.3"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.step}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  step: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                        <span style={{ marginLeft: 6 }}>gMin:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.3"
                          max="0.8"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.minRatio}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  minRatio: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {scaleSettings.growth.algorithm.type === 'exponential' && (
                    <div className="wst-setting-item">
                      <div className="wst-setting-info">
                        <span className="wst-setting-title">衰减比率 (ratio) 与下限 (gMin)</span>
                        <span className="wst-setting-desc">
                          每深入一层乘以固定比例（默认 0.90）；触及 gMin（默认 0.55）后保持平台。
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>ratio:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.7"
                          max="0.98"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.ratio}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  ratio: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                        <span style={{ marginLeft: 6 }}>gMin:</span>
                        <input
                          type="number"
                          className="wst-input"
                          style={{ width: 68, textAlign: 'right' }}
                          min="0.3"
                          max="0.8"
                          step="0.05"
                          value={scaleSettings.growth.algorithm.minRatio}
                          onChange={(e) =>
                            onChangeScaleSettings?.({
                              ...scaleSettings,
                              growth: {
                                ...scaleSettings.growth!,
                                algorithm: {
                                  ...scaleSettings.growth!.algorithm,
                                  minRatio: Number(e.target.value),
                                } as any,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* 拓扑修正设置 */}
                  <div className="wst-setting-item">
                    <div className="wst-setting-info">
                      <span className="wst-setting-title">拓扑结构加权 (主枝加权 / 旁枝收敛)</span>
                      <span className="wst-setting-desc">
                        根据子树规模动态调整分叉比率；轻度加权（强度 0.12，默认）、中度（0.20）或关闭。
                      </span>
                    </div>
                    <select
                      className="wst-select"
                      value={
                        !scaleSettings.growth.topology.enabled || scaleSettings.growth.topology.strength === 0
                          ? 'off'
                          : scaleSettings.growth.topology.strength === 0.20
                            ? 'medium'
                            : 'light'
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        const currentTopo = scaleSettings.growth!.topology;
                        let nextTopo = currentTopo;
                        if (val === 'off') {
                          nextTopo = { ...currentTopo, enabled: false, strength: 0 };
                        } else if (val === 'medium') {
                          nextTopo = { ...currentTopo, enabled: true, strength: 0.20 };
                        } else {
                          nextTopo = { ...currentTopo, enabled: true, strength: 0.12 };
                        }
                        onChangeScaleSettings?.({
                          ...scaleSettings,
                          growth: {
                            ...scaleSettings.growth!,
                            topology: nextTopo,
                          },
                        });
                      }}
                    >
                      <option value="light">轻度修正 (强度 0.12 - 默认推荐)</option>
                      <option value="medium">中度修正 (强度 0.20)</option>
                      <option value="off">关闭拓扑修正 (仅按深度衰减)</option>
                    </select>
                  </div>

                  {/* 实时层级衰减模拟预览条 */}
                  <div className="wst-setting-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <span className="wst-setting-title" style={{ marginBottom: 4 }}>
                      层级衰减即时曲线预览 (Depth 0 ~ 6)
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: 10,
                        background: 'var(--wash, #f8fafc)',
                        padding: '12px 14px',
                        borderRadius: 6,
                        border: '1px solid var(--line, #e2e8f0)',
                      }}
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((depth) => {
                        const ratio = depthRatio(depth, scaleSettings.growth!.algorithm);
                        const pct = Math.round(ratio * 100);
                        const height = Math.round(48 * ratio);
                        return (
                          <div
                            key={depth}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                              flex: 1,
                            }}
                          >
                            <span style={{ fontSize: 10, color: 'var(--muted, #64748b)' }}>{pct}%</span>
                            <div
                              style={{
                                width: '100%',
                                height: `${height}px`,
                                background: depth === 0 ? 'var(--accent, #3b82f6)' : 'var(--line, #94a3b8)',
                                borderRadius: 3,
                                transition: 'height 0.15s ease',
                              }}
                            />
                            <span style={{ fontSize: 11, fontWeight: 600 }}>D{depth}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="wst-keybindings-section-title" style={{ marginTop: 24 }}>
                高级兼容设置 (Legacy Fallback)
              </div>
              <div className="wst-setting-item">
                <div className="wst-setting-info">
                  <span className="wst-setting-title">排版缩放递减步长 (Layout Step)</span>
                  <span className="wst-setting-desc">
                    未开启自动生长时，新建子节点沿用的旧版字体缩放减小量（默认 -0.10）
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    className="wst-input"
                    style={{ width: 80, textAlign: 'right' }}
                    min="-0.3"
                    max="0"
                    step="0.05"
                    value={scaleSettings.childLayoutStep}
                    onChange={(event) =>
                      onChangeScaleSettings?.({
                        ...scaleSettings,
                        childLayoutStep: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div className="wst-setting-item">
                <div className="wst-setting-info">
                  <span className="wst-setting-title">几何缩放衰减比率 (Visual Ratio)</span>
                  <span className="wst-setting-desc">
                    未开启自动生长时，新建子节点沿用的旧版等比几何缩放倍率（默认 0.90）
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    className="wst-input"
                    style={{ width: 80, textAlign: 'right' }}
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={scaleSettings.childVisualRatio}
                    onChange={(event) =>
                      onChangeScaleSettings?.({
                        ...scaleSettings,
                        childVisualRatio: Number(event.target.value),
                      })
                    }
                  />
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
