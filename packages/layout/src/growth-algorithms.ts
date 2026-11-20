import type { GrowthAlgorithm } from '@workspacetree/schema';

/**
 * 计算深度为 depth 处的生长因子 G(d)。
 * 严格满足 G(0) = 1.0，随深度非增，且下限受 gMin (minRatio) 约束。
 */
export function depthRatio(depth: number, algorithm: GrowthAlgorithm): number {
  const d = Math.max(0, depth);
  if (d === 0) return 1.0;

  const minRatio = typeof algorithm.minRatio === 'number' && Number.isFinite(algorithm.minRatio)
    ? Math.max(0.01, Math.min(1.0, algorithm.minRatio))
    : 0.55;

  switch (algorithm.type) {
    case 'linear': {
      const step = typeof algorithm.step === 'number' && Number.isFinite(algorithm.step)
        ? Math.max(0.001, algorithm.step)
        : 0.10;
      return Math.max(minRatio, Number((1 - step * d).toFixed(6)));
    }
    case 'exponential': {
      const ratio = typeof algorithm.ratio === 'number' && Number.isFinite(algorithm.ratio)
        ? Math.max(0.01, Math.min(1.0, algorithm.ratio))
        : 0.90;
      return Math.max(minRatio, Number(Math.pow(ratio, d).toFixed(6)));
    }
    case 'asymptotic': {
      const decay = typeof algorithm.decay === 'number' && Number.isFinite(algorithm.decay)
        ? Math.max(0.001, algorithm.decay)
        : 0.25;
      const factor = minRatio + (1 - minRatio) * Math.exp(-decay * d);
      return Number(factor.toFixed(6));
    }
    default:
      return 1.0;
  }
}
