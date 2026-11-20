import { describe, expect, it } from 'vitest';
import { depthRatio } from '@workspacetree/layout';

describe('层级生长算法 (Growth Algorithms - Group A)', () => {
  it('渐近衰减算法 (Asymptotic)：满足规范预设序列精度与 G(0)=1 约束', () => {
    const algorithm = {
      type: 'asymptotic' as const,
      decay: 0.25,
      minRatio: 0.55,
    };

    // 深度 0 -> 100%
    expect(depthRatio(0, algorithm)).toBe(1.0);

    // 深度 1 -> 约 90.0% (0.55 + 0.45 * exp(-0.25) ≈ 0.900463)
    const d1 = depthRatio(1, algorithm);
    expect(Number((d1 * 100).toFixed(1))).toBe(90.0);

    // 深度 2 -> 约 82.3% (0.55 + 0.45 * exp(-0.50) ≈ 0.82287)
    const d2 = depthRatio(2, algorithm);
    expect(Number((d2 * 100).toFixed(1))).toBe(82.3);

    // 深度 3 -> 约 76.3% (0.55 + 0.45 * exp(-0.75) ≈ 0.76256)
    const d3 = depthRatio(3, algorithm);
    expect(Number((d3 * 100).toFixed(1))).toBe(76.3);

    // 深度 5 -> 约 67.9% (0.55 + 0.45 * exp(-1.25) ≈ 0.67897)
    const d5 = depthRatio(5, algorithm);
    expect(Number((d5 * 100).toFixed(1))).toBe(67.9);

    // 深度 10 -> 约 58.7% (0.55 + 0.45 * exp(-2.50) ≈ 0.58694)
    const d10 = depthRatio(10, algorithm);
    expect(Number((d10 * 100).toFixed(1))).toBe(58.7);

    // 随深度严格单调递减，渐近逼近 0.55 且不低于 0.55
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
    expect(d3).toBeGreaterThan(d5);
    expect(d5).toBeGreaterThan(d10);
    expect(depthRatio(100, algorithm)).toBeGreaterThanOrEqual(0.55);
  });

  it('线性递减算法 (Linear)：每层步进 0.10，触碰 gMin 平台', () => {
    const algorithm = {
      type: 'linear' as const,
      step: 0.10,
      minRatio: 0.55,
    };

    expect(depthRatio(0, algorithm)).toBe(1.0);
    expect(depthRatio(1, algorithm)).toBe(0.9);
    expect(depthRatio(2, algorithm)).toBe(0.8);
    expect(depthRatio(3, algorithm)).toBe(0.7);
    expect(depthRatio(4, algorithm)).toBe(0.6);
    expect(depthRatio(5, algorithm)).toBe(0.55); // 1 - 0.5 = 0.5 < 0.55，平台截断
    expect(depthRatio(10, algorithm)).toBe(0.55);
  });

  it('固定比例算法 (Exponential)：每层乘 0.90，触碰 gMin 平台', () => {
    const algorithm = {
      type: 'exponential' as const,
      ratio: 0.90,
      minRatio: 0.55,
    };

    expect(depthRatio(0, algorithm)).toBe(1.0);
    expect(Number(depthRatio(1, algorithm).toFixed(2))).toBe(0.90);
    expect(Number(depthRatio(2, algorithm).toFixed(2))).toBe(0.81);
    expect(Number(depthRatio(3, algorithm).toFixed(3))).toBe(0.729);
    expect(Number(depthRatio(4, algorithm).toFixed(4))).toBe(0.6561);
    expect(depthRatio(10, algorithm)).toBe(0.55);
  });

  it('边界保护：负深度与非法参数安全防崩溃', () => {
    const algorithm = {
      type: 'asymptotic' as const,
      decay: 0.25,
      minRatio: 0.55,
    };
    expect(depthRatio(-5, algorithm)).toBe(1.0);
    expect(depthRatio(0, algorithm)).toBe(1.0);
  });
});
