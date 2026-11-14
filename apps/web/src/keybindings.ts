export type KeybindingCategory = 'canvas' | 'drag';

export type KeybindingAction =
  | 'deleteNode'
  | 'addChildNode'
  | 'addBranchNode'
  | 'addRandomBranch'
  | 'fitView'
  | 'undo'
  | 'redo'
  | 'cutBranch'
  | 'pasteBranch'
  | 'saveBranch'
  | 'resizeProportional'
  | 'resizeBranch'
  | 'resizeNodeScale';

export interface KeybindingMeta {
  label: string;
  description: string;
  defaultKey: string;
  category?: KeybindingCategory;
  options?: readonly string[];
}

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, KeybindingMeta> = {
  saveBranch: {
    label: '导出项目文件',
    description: '下载当前项目的 .branch.json 文件',
    defaultKey: 'Ctrl+S',
    category: 'canvas',
  },
  deleteNode: {
    label: '删除选中项',
    description: '删除选中的连线或节点子树（根节点除外）',
    defaultKey: 'Delete',
    category: 'canvas',
  },
  cutBranch: {
    label: '剪切分支',
    description: '标记当前分支以便移动',
    defaultKey: 'Ctrl+X',
    category: 'canvas',
  },
  pasteBranch: {
    label: '粘贴为子分支',
    description: '将剪切的分支移动到选中节点下',
    defaultKey: 'Ctrl+V',
    category: 'canvas',
  },
  addChildNode: {
    label: '新建节点',
    description: '在选中的节点下新建延续或叶子节点并进入编辑',
    defaultKey: 'Tab',
    category: 'canvas',
  },
  addBranchNode: {
    label: '新建分支',
    description: '在选中的节点下新建侧枝并进入编辑',
    defaultKey: 'b',
  },
  addRandomBranch: {
    label: '新建独立分支',
    description: '在画布视口中心随机位置创建独立新分支节点',
    defaultKey: 'r',
    category: 'canvas',
  },
  fitView: {
    label: '自适应视图',
    description: '缩放并平移画布以完全居中呈现所有节点',
    defaultKey: 'f',
    category: 'canvas',
  },
  undo: {
    label: '撤销',
    description: '撤销上一次操作',
    defaultKey: 'Ctrl+Z',
    category: 'canvas',
  },
  redo: {
    label: '重做',
    description: '重做上一次已撤销的操作',
    defaultKey: 'Ctrl+Y',
    category: 'canvas',
  },
  resizeProportional: {
    label: '保持等比尺寸',
    description: '拖拽节点四角调整尺寸时按住，锁定宽高比进行等比尺寸调整',
    defaultKey: 'Shift',
    category: 'drag',
    options: ['Shift', 'Alt', 'Ctrl', 'Alt+Shift', 'Ctrl+Shift'],
  },
  resizeBranch: {
    label: '分支联动缩放',
    description: '拖拽节点四角调整尺寸时按住，当前节点与所有子树后代同步缩放',
    defaultKey: 'Alt',
    category: 'drag',
    options: ['Alt', 'Shift', 'Ctrl', 'Alt+Shift', 'Ctrl+Alt'],
  },
  resizeNodeScale: {
    label: '单节点等比吸附',
    description: '拖拽节点四角调整尺寸时按住，仅缩放单节点并吸附到标准整档刻度',
    defaultKey: 'Ctrl',
    category: 'drag',
    options: ['Ctrl', 'Shift', 'Alt', 'Ctrl+Shift', 'Ctrl+Alt'],
  },
};

const STORAGE_KEY = 'workspacetree_keybindings_v1';

export function loadKeybindings(): Record<KeybindingAction, string> {
  const result: Record<KeybindingAction, string> = {
    deleteNode: DEFAULT_KEYBINDINGS.deleteNode.defaultKey,
    addChildNode: DEFAULT_KEYBINDINGS.addChildNode.defaultKey,
    addBranchNode: DEFAULT_KEYBINDINGS.addBranchNode.defaultKey,
    addRandomBranch: DEFAULT_KEYBINDINGS.addRandomBranch.defaultKey,
    fitView: DEFAULT_KEYBINDINGS.fitView.defaultKey,
    undo: DEFAULT_KEYBINDINGS.undo.defaultKey,
    redo: DEFAULT_KEYBINDINGS.redo.defaultKey,
    cutBranch: DEFAULT_KEYBINDINGS.cutBranch.defaultKey,
    pasteBranch: DEFAULT_KEYBINDINGS.pasteBranch.defaultKey,
    saveBranch: DEFAULT_KEYBINDINGS.saveBranch.defaultKey,
    resizeProportional: DEFAULT_KEYBINDINGS.resizeProportional.defaultKey,
    resizeBranch: DEFAULT_KEYBINDINGS.resizeBranch.defaultKey,
    resizeNodeScale: DEFAULT_KEYBINDINGS.resizeNodeScale.defaultKey,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<KeybindingAction, string>>;
        for (const [key, val] of Object.entries(parsed)) {
          if (key in result && typeof val === 'string' && val.trim().length > 0) {
            result[key as KeybindingAction] = val.trim();
          }
        }
      }
    }
  } catch {
    // 忽略异常，使用默认快捷键
  }
  return result;
}

export function saveKeybindings(bindings: Record<KeybindingAction, string>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    }
  } catch {
    // 忽略
  }
}

export interface KeyLike {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * 判断键盘事件是否与指定的快捷键字符串匹配
 * 格式说明：
 * - 单键："Delete", "Tab", "r", "f"
 * - 组合键："Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Alt+N"
 */
export function isEventMatchingKeybinding(event: KeyLike, keybinding: string): boolean {
  const parts = keybinding.split('+').map((p) => p.trim());
  const mainKey = parts[parts.length - 1];
  const requireCtrl = parts.some((p) => p.toLowerCase() === 'ctrl' || p.toLowerCase() === 'mod');
  const requireShift = parts.some((p) => p.toLowerCase() === 'shift');
  const requireAlt = parts.some((p) => p.toLowerCase() === 'alt');

  const ctrlOrMeta = Boolean(event.ctrlKey || event.metaKey);
  if (requireCtrl !== ctrlOrMeta) return false;
  if (requireShift !== Boolean(event.shiftKey)) return false;
  if (requireAlt !== Boolean(event.altKey)) return false;

  const eventKey = event.key;
  if (!eventKey) return false;

  // 特殊键映射处理
  if (mainKey.toLowerCase() === 'delete') {
    return eventKey === 'Delete' || eventKey === 'Backspace';
  }
  if (mainKey.toLowerCase() === 'backspace') {
    return eventKey === 'Backspace' || eventKey === 'Delete';
  }
  if (mainKey.toLowerCase() === 'tab') {
    return eventKey === 'Tab';
  }
  return eventKey.toLowerCase() === mainKey.toLowerCase();
}

/**
 * 将录制到的 KeyboardEvent 格式化为快捷键字符串展示。
 * 当 allowModifierOnly 为 true 时，允许单独按修饰键（如 Shift / Alt / Ctrl）。
 */
export function formatKeyboardEventToKeybinding(
  event: KeyLike,
  allowModifierOnly = false,
): string | null {
  const key = event.key;
  if (!key) return null;

  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    if (allowModifierOnly) {
      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey || key === 'Control' || key === 'Meta') parts.push('Ctrl');
      if (event.altKey || key === 'Alt') parts.push('Alt');
      if (event.shiftKey || key === 'Shift') parts.push('Shift');
      return parts.join('+') || (key === 'Control' || key === 'Meta' ? 'Ctrl' : key);
    }
    return null; // 正在按下修饰键，尚未按下主键
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  let keyLabel = key;
  if (key === ' ') keyLabel = 'Space';
  else if (key.length === 1) keyLabel = key.toUpperCase();
  parts.push(keyLabel);

  return parts.join('+');
}
