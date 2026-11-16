export interface WorkspaceSettings {
  /** 编辑节点是否开启离开或定时自动保存 */
  autoSaveNode: boolean;
  /** 持续编辑时的自动保存间隔（毫秒），默认 5000ms (5秒) */
  autoSaveInterval: number;
  markdownCss: string;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  autoSaveNode: true,
  autoSaveInterval: 5000,
  markdownCss: '',
};

const SETTINGS_STORAGE_KEY = 'workspacetree_settings_v1';

export function loadSettings(): WorkspaceSettings {
  const result: WorkspaceSettings = { ...DEFAULT_SETTINGS };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>;
        if (typeof parsed.autoSaveNode === 'boolean') {
          result.autoSaveNode = parsed.autoSaveNode;
        }
        if (typeof parsed.autoSaveInterval === 'number' && parsed.autoSaveInterval > 0) {
          result.autoSaveInterval = parsed.autoSaveInterval;
        }
        if (typeof parsed.markdownCss === 'string') {
          result.markdownCss = parsed.markdownCss;
        }
      }
    }
  } catch {
    // 忽略异常，降级使用默认设置
  }
  return result;
}

export function saveSettings(settings: WorkspaceSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // 忽略异常
  }
}
