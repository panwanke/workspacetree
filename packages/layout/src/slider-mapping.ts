/**
 * 非对称对数滑块映射。
 * 100% (1.0x) 固定锚定在滑块轨道的 anchor 位置（默认 0.75 / 75% 处）。
 * 提供 0%～100% 缩小时更高的交互微调分辨率，同时支持 100%～max 的平滑放大。
 */

export function scaleFromSlider(
  p: number,
  min: number,
  max: number,
  anchor = 0.75,
): number {
  if (min <= 0 || max <= min) throw new Error('Invalid slider scale bounds');
  const t = Math.min(1.0, Math.max(0.0, p));
  if (t <= anchor) {
    if (anchor <= 0) return 1.0;
    const factor = 1.0 - t / anchor;
    return Math.exp(Math.log(min) * factor);
  }
  if (anchor >= 1.0) return 1.0;
  const factor = (t - anchor) / (1.0 - anchor);
  return Math.exp(Math.log(max) * factor);
}

export function sliderFromScale(
  scale: number,
  min: number,
  max: number,
  anchor = 0.75,
): number {
  if (min <= 0 || max <= min) throw new Error('Invalid slider scale bounds');
  const value = Math.max(min, Math.min(max, scale));
  if (value <= 1.0) {
    if (min >= 1.0) return 0.0;
    const ratio = Math.log(value / min) / Math.log(1.0 / min);
    return anchor * Math.max(0.0, Math.min(1.0, ratio));
  }
  if (max <= 1.0) return 1.0;
  const ratio = Math.log(value) / Math.log(max);
  return anchor + (1.0 - anchor) * Math.max(0.0, Math.min(1.0, ratio));
}
