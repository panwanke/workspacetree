/** 06 §二 Phase 0 验收 2（稳定 ID 与引用完整性）。 */
import { describe, expect, it } from 'vitest';
import { makeId, newNodeId, newOperationId } from '@workspacetree/core';
import { ID_PREFIX } from '@workspacetree/schema';

describe('T-05 稳定 ID', () => {
  it('注入固定 now / random 可确定性复现', () => {
    const deps = { now: () => 1_700_000_000_000, random: () => 0.5 };
    expect(makeId('n_', deps)).toBe(makeId('n_', deps));
  });

  it('不同随机源产生不同 ID，且前缀稳定', () => {
    const fixed = { now: () => 1_700_000_000_000, random: () => 0.5 };
    const different = { now: () => 1_700_000_000_000, random: () => 0.75 };
    expect(makeId('n_', fixed)).not.toBe(makeId('n_', different));
    expect(newNodeId(fixed).startsWith(ID_PREFIX.node)).toBe(true);
    expect(newOperationId(fixed).startsWith(ID_PREFIX.operation)).toBe(true);
  });
});
