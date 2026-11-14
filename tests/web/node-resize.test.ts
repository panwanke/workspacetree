import { describe, expect, it } from 'vitest';
import {
  calculateResizeScale,
  resolveEffectiveResizeMode,
  snapScaleValue,
} from '../../apps/web/src/node-resize';

describe('node-resize modifier handling', () => {
  it('defaults to the given mode when no modifier keys are pressed', () => {
    expect(resolveEffectiveResizeMode('box', {})).toEqual({
      mode: 'box',
      isProportional: false,
      snap: false,
    });
    expect(resolveEffectiveResizeMode('uniform', {})).toEqual({
      mode: 'uniform',
      isProportional: true,
      snap: false,
    });
    expect(resolveEffectiveResizeMode('branch', {})).toEqual({
      mode: 'branch',
      isProportional: true,
      snap: false,
    });
  });

  it('Shift enables proportional mode keeping aspect ratio', () => {
    const result = resolveEffectiveResizeMode('box', { shiftKey: true });
    expect(result).toEqual({
      mode: 'box',
      isProportional: true,
      snap: false,
    });
  });

  it('Alt triggers branch scale', () => {
    const result = resolveEffectiveResizeMode('box', { altKey: true });
    expect(result).toEqual({
      mode: 'branch',
      isProportional: true,
      snap: false,
    });
  });

  it('Ctrl / Meta triggers uniform node scale with snap enabled', () => {
    const ctrlResult = resolveEffectiveResizeMode('box', { ctrlKey: true });
    expect(ctrlResult).toEqual({
      mode: 'uniform',
      isProportional: true,
      snap: true,
    });

    const metaResult = resolveEffectiveResizeMode('box', { metaKey: true });
    expect(metaResult).toEqual({
      mode: 'uniform',
      isProportional: true,
      snap: true,
    });
  });

  it('Alt + Ctrl triggers branch scale with snap enabled', () => {
    const result = resolveEffectiveResizeMode('box', { altKey: true, ctrlKey: true });
    expect(result).toEqual({
      mode: 'branch',
      isProportional: true,
      snap: true,
    });
  });

  it('snaps scale values when within snap threshold', () => {
    // Near 1.0 (e.g. 0.98 or 1.04)
    expect(snapScaleValue(0.98, 'node')).toBe(1.0);
    expect(snapScaleValue(1.04, 'node')).toBe(1.0);
    // Far from standard steps (e.g. 1.12), does not snap
    expect(snapScaleValue(1.12, 'node')).toBe(1.12);
    // Branch step at 0.1
    expect(snapScaleValue(0.12, 'branch')).toBe(0.1);
  });

  it('calculates clamped and snapped scale', () => {
    // 220px base width
    expect(calculateResizeScale(220, 'node')).toBe(1.0);
    expect(calculateResizeScale(440, 'node')).toBe(2.0);
    expect(calculateResizeScale(600, 'node')).toBe(2.0); // max clamped
    expect(calculateResizeScale(50, 'node')).toBe(0.35); // min clamped
    expect(calculateResizeScale(22, 'branch')).toBe(0.1); // branch min clamped
    // With snap
    expect(calculateResizeScale(215, 'node', true)).toBe(1.0);
  });

  it('supports custom drag keybindings', () => {
    // Customize: Ctrl for branch scale, Alt for node scale
    const customBindings = {
      resizeBranch: 'Ctrl',
      resizeNodeScale: 'Alt',
      resizeProportional: 'Shift',
    };

    const ctrlResult = resolveEffectiveResizeMode('box', { ctrlKey: true }, customBindings);
    expect(ctrlResult).toEqual({
      mode: 'branch',
      isProportional: true,
      snap: false,
    });

    const altResult = resolveEffectiveResizeMode('box', { altKey: true }, customBindings);
    expect(altResult).toEqual({
      mode: 'uniform',
      isProportional: true,
      snap: true,
    });
  });
});
