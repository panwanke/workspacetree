/**
 * 节点尺寸与缩放修饰键解析器。
 * 支持在拖拽调整节点大小时：
 * - 无修饰键：根据当前模式自由调整方框或缩放
 * - Shift：保持宽高比进行同比例调整 (Keep Aspect Ratio)
 * - Alt：整个分支联动缩放 (Branch Scale)
 * - Ctrl / Meta (⌘)：单节点独立等比缩放 (Node Scale) 并支持整档刻度吸附
 */

export interface ResizeModifiers {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type EffectiveResizeMode = 'box' | 'uniform' | 'branch';

export interface DragResizeBindings {
  resizeProportional?: string;
  resizeBranch?: string;
  resizeNodeScale?: string;
}

export interface ResolveResizeModeResult {
  mode: EffectiveResizeMode;
  isProportional: boolean;
  snap: boolean;
}

export const SCALE_SNAP_STEPS = {
  branch: [0.1, 0.25, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
  node: [0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
} as const;

export function isModifierActive(modifiers: Partial<ResizeModifiers>, binding?: string): boolean {
  if (!binding) return false;
  const parts = binding.split('+').map((p) => p.trim().toLowerCase());
  const needCtrl = parts.some((p) => p === 'ctrl' || p === 'mod');
  const needAlt = parts.some((p) => p === 'alt');
  const needShift = parts.some((p) => p === 'shift');

  const hasCtrl = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  const hasAlt = Boolean(modifiers.altKey);
  const hasShift = Boolean(modifiers.shiftKey);

  if (needCtrl && !hasCtrl) return false;
  if (needAlt && !hasAlt) return false;
  if (needShift && !hasShift) return false;

  return needCtrl || needAlt || needShift;
}

export function resolveEffectiveResizeMode(
  defaultMode: EffectiveResizeMode = 'box',
  modifiers: Partial<ResizeModifiers> = {},
  bindings: DragResizeBindings = {},
): ResolveResizeModeResult {
  const branchKey = bindings.resizeBranch ?? 'Alt';
  const nodeScaleKey = bindings.resizeNodeScale ?? 'Ctrl';
  const propKey = bindings.resizeProportional ?? 'Shift';

  const isBranch = isModifierActive(modifiers, branchKey);
  const isNodeScale = isModifierActive(modifiers, nodeScaleKey);
  const isProp = isModifierActive(modifiers, propKey);

  // 1. 分支缩放（若同时激活 nodeScale 键则开启档位吸附）
  if (isBranch) {
    return {
      mode: 'branch',
      isProportional: true,
      snap: isNodeScale,
    };
  }

  // 2. 单节点等比缩放并吸附档位
  if (isNodeScale) {
    return {
      mode: 'uniform',
      isProportional: true,
      snap: true,
    };
  }

  // 3. 锁定宽高比同比例调整
  if (isProp) {
    return {
      mode: defaultMode === 'branch' ? 'branch' : defaultMode === 'uniform' ? 'uniform' : 'box',
      isProportional: true,
      snap: false,
    };
  }

  // 4. 无修饰键：遵循默认模式
  return {
    mode: defaultMode,
    isProportional: defaultMode !== 'box',
    snap: false,
  };
}

export function snapScaleValue(scale: number, kind: 'node' | 'branch', threshold = 0.08): number {
  const steps = SCALE_SNAP_STEPS[kind];
  let closest: number = steps[0];
  let minDiff = Math.abs(scale - closest);
  for (const step of steps) {
    const diff = Math.abs(scale - step);
    if (diff < minDiff) {
      minDiff = diff;
      closest = step;
    }
  }
  return minDiff <= threshold ? closest : scale;
}

export function calculateResizeScale(
  width: number,
  kind: 'node' | 'branch',
  snap = false,
  baseWidth = 220,
): number {
  const minScale = kind === 'branch' ? 0.1 : 0.35;
  const rawScale = Number((width / baseWidth).toFixed(2));
  const clamped = Math.min(2, Math.max(minScale, rawScale));
  if (!snap) return clamped;
  return snapScaleValue(clamped, kind);
}
