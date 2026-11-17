export const EDGE_RECENT_COLORS_KEY = 'wst_edge_recent_colors';
export const MAX_RECENT_EDGE_COLORS = 7;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const EDGE_PRESET_COLORS = [
  { value: '#64748b', name: '石板灰' },
  { value: '#ef4444', name: '红' },
  { value: '#f97316', name: '橙' },
  { value: '#eab308', name: '黄' },
  { value: '#22c55e', name: '绿' },
  { value: '#14b8a6', name: '青绿' },
  { value: '#3b82f6', name: '蓝' },
  { value: '#6366f1', name: '靛蓝' },
  { value: '#a855f7', name: '紫' },
  { value: '#ec4899', name: '粉' },
  { value: '#78350f', name: '棕' },
  { value: '#84cc16', name: '黄绿' },
  { value: '#0f172a', name: '深色' },
  { value: '#ffffff', name: '白色' },
] as const;

function normalizeColor(color: string): string | null {
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

/** 最近使用的颜色最多保留 7 个；重复选择移到最前。 */
export function addRecentEdgeColor(colors: readonly string[], color: string): string[] {
  const normalized = normalizeColor(color);
  if (!normalized) return colors.filter((item) => normalizeColor(item) !== null).slice();
  const rest = colors.filter((item) => normalizeColor(item) !== normalized);
  return [normalized, ...rest].slice(0, MAX_RECENT_EDGE_COLORS);
}

export function loadRecentEdgeColors(): string[] {
  try {
    const raw = window.localStorage.getItem(EDGE_RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && normalizeColor(item) !== null)
      .map((item) => item.toLowerCase())
      .slice(0, MAX_RECENT_EDGE_COLORS);
  } catch {
    return [];
  }
}

export function saveRecentEdgeColors(colors: readonly string[]): void {
  try {
    window.localStorage.setItem(EDGE_RECENT_COLORS_KEY, JSON.stringify([...colors]));
  } catch {
    // localStorage may be unavailable or full; recent colors are only a convenience.
  }
}
