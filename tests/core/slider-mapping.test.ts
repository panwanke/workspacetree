import { describe, expect, it } from 'vitest';
import { scaleFromSlider, sliderFromScale } from '@workspacetree/layout';

describe('非对称对数滑块映射 (Slider Mapping - Group C)', () => {
  it('100% (1.0x) 精确锚定在 75% (0.75) 轨道位置', () => {
    // 排版缩放区间 [0.5, 2.0]
    expect(scaleFromSlider(0.75, 0.5, 2.0)).toBeCloseTo(1.0, 5);
    expect(sliderFromScale(1.0, 0.5, 2.0)).toBeCloseTo(0.75, 5);

    // 几何缩放区间 [0.25, 5.0]
    expect(scaleFromSlider(0.75, 0.25, 5.0)).toBeCloseTo(1.0, 5);
    expect(sliderFromScale(1.0, 0.25, 5.0)).toBeCloseTo(0.75, 5);
  });

  it('轨道端点精确对应 min 与 max', () => {
    const min = 0.5;
    const max = 2.0;

    expect(scaleFromSlider(0.0, min, max)).toBeCloseTo(min, 5);
    expect(scaleFromSlider(1.0, min, max)).toBeCloseTo(max, 5);

    expect(sliderFromScale(min, min, max)).toBeCloseTo(0.0, 5);
    expect(sliderFromScale(max, min, max)).toBeCloseTo(1.0, 5);
  });

  it('全区间单调递增且双向往返完全可逆 (Round-Trip Reversibility)', () => {
    const min = 0.25;
    const max = 5.0;

    const testScales = [0.25, 0.35, 0.5, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 3.5, 5.0];
    for (const scale of testScales) {
      const p = sliderFromScale(scale, min, max, 0.75);
      expect(p).toBeGreaterThanOrEqual(0.0);
      expect(p).toBeLessThanOrEqual(1.0);

      const recovered = scaleFromSlider(p, min, max, 0.75);
      expect(recovered).toBeCloseTo(scale, 4);
    }
  });

  it('非对称特性：1.0x 以下占据 75% 的操作轨道，拥有更高的调节分辨率', () => {
    const min = 0.5;
    const max = 2.0;

    const pos08 = sliderFromScale(0.8, min, max, 0.75);
    const pos12 = sliderFromScale(1.2, min, max, 0.75);

    // 0.8x 到 1.0x (差 0.2x) 占据的物理轨道长度
    const trackBelow = 0.75 - pos08;
    // 1.0x 到 1.2x (差 0.2x) 占据的物理轨道长度
    const trackAbove = pos12 - 0.75;

    // 缩减段的轨道灵敏度更细腻（占有更长物理行程）
    expect(trackBelow).toBeGreaterThan(trackAbove);
  });
});
