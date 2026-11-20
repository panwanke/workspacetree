import { describe, expect, it } from 'vitest';
import {
  deriveTopology,
  type Hierarchy,
} from '@workspacetree/layout';

describe('拓扑结构加权算法 (Topology Metrics - Group B)', () => {
  it('根节点与独生子拓扑因子恒为 1.0；同规模兄弟无相对偏差', () => {
    // 拓扑: root -> [c1, c2] (无后代，同规模)
    const hierarchy: Hierarchy = {
      roots: ['root'],
      parents: new Map([
        ['root', null],
        ['c1', 'root'],
        ['c2', 'root'],
      ]),
      children: new Map([
        ['root', ['c1', 'c2']],
        ['c1', []],
        ['c2', []],
      ]),
    };

    const settings = {
      enabled: true,
      massDecay: 0.75,
      strength: 0.12,
      localMin: 0.92,
      localMax: 1.08,
      lineageMemory: 0.70,
      lineageMin: 0.88,
      lineageMax: 1.12,
    };

    const { masses, topologyFactors } = deriveTopology(hierarchy, settings);

    expect(masses.get('c1')).toBe(1.0);
    expect(masses.get('c2')).toBe(1.0);
    expect(masses.get('root')).toBe(1 + 0.75 * (1 + 1)); // 2.5

    expect(topologyFactors.get('root')).toBe(1.0);
    // 兄弟同规模，delta = 0，Q = exp(0) = 1.0, T = 1.0
    expect(topologyFactors.get('c1')).toBe(1.0);
    expect(topologyFactors.get('c2')).toBe(1.0);
  });

  it('主枝获得正向加权，旁枝适度收敛，且受严格边界 [0.88, 1.12] 约束', () => {
    // 拓扑:
    // root -> main_branch (下有 5 个后代: m1 -> m2 -> m3 -> m4 -> m5)
    //      -> side_branch (无后代)
    const hierarchy: Hierarchy = {
      roots: ['root'],
      parents: new Map([
        ['root', null],
        ['main', 'root'],
        ['side', 'root'],
        ['m1', 'main'],
        ['m2', 'm1'],
        ['m3', 'm2'],
        ['m4', 'm3'],
        ['m5', 'm4'],
      ]),
      children: new Map([
        ['root', ['main', 'side']],
        ['main', ['m1']],
        ['side', []],
        ['m1', ['m2']],
        ['m2', ['m3']],
        ['m3', ['m4']],
        ['m4', ['m5']],
        ['m5', []],
      ]),
    };

    const settings = {
      enabled: true,
      massDecay: 0.75,
      strength: 0.12,
      localMin: 0.92,
      localMax: 1.08,
      lineageMemory: 0.70,
      lineageMin: 0.88,
      lineageMax: 1.12,
    };

    const { masses, topologyFactors } = deriveTopology(hierarchy, settings);

    // main 分支包含深度链条，折扣质量显著高于 side 分支
    const mainMass = masses.get('main')!;
    const sideMass = masses.get('side')!;
    expect(mainMass).toBeGreaterThan(sideMass);

    const mainFactor = topologyFactors.get('main')!;
    const sideFactor = topologyFactors.get('side')!;

    // 主枝局部因子大于 1，旁枝小于 1
    expect(mainFactor).toBeGreaterThan(1.0);
    expect(sideFactor).toBeLessThan(1.0);

    // 局部与全局严格受控在安全区间内
    expect(mainFactor).toBeLessThanOrEqual(settings.lineageMax);
    expect(sideFactor).toBeGreaterThanOrEqual(settings.lineageMin);

    // 谱系记忆衰减验证：m1 是 main 的独生子，其 T 应继承 mainFactor^0.70，温和向 1.0 收敛
    const m1Factor = topologyFactors.get('m1')!;
    expect(m1Factor).toBeGreaterThan(1.0);
    expect(m1Factor).toBeLessThan(mainFactor); // 差异温和递减，不发生突变
  });

  it('关闭拓扑修正或强度置 0 时，全树拓扑因子均归一为 1.0', () => {
    const hierarchy: Hierarchy = {
      roots: ['root'],
      parents: new Map([
        ['root', null],
        ['main', 'root'],
        ['side', 'root'],
      ]),
      children: new Map([
        ['root', ['main', 'side']],
        ['main', []],
        ['side', []],
      ]),
    };

    const settingsDisabled = {
      enabled: false,
      massDecay: 0.75,
      strength: 0.12,
      localMin: 0.92,
      localMax: 1.08,
      lineageMemory: 0.70,
      lineageMin: 0.88,
      lineageMax: 1.12,
    };

    const res = deriveTopology(hierarchy, settingsDisabled);
    expect(res.topologyFactors.get('root')).toBe(1.0);
    expect(res.topologyFactors.get('main')).toBe(1.0);
    expect(res.topologyFactors.get('side')).toBe(1.0);
  });
});
