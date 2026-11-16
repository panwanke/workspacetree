import { describe, expect, it } from 'vitest';
import { alignNodeDrag } from '../../apps/web/src/node-alignment.js';

describe('drag alignment', () => {
  it('aligns differently sized cards by center with a guide between them', () => {
    const moving = { x: 42, y: 140, width: 120, height: 40 };
    const target = { x: 60, y: 40, width: 80, height: 60 };
    expect(alignNodeDrag(moving, [target], 1)).toEqual({
      position: { x: 40, y: 140 },
      guides: [{ x1: 100, x2: 100, y1: 40, y2: 180 }],
    });
  });

  it('aligns opposite edges and chooses the closest stop on each axis', () => {
    const moving = { x: 102, y: 78, width: 60, height: 24 };
    const left = { x: 40, y: 50, width: 60, height: 30 };
    const below = { x: 160, y: 103, width: 75, height: 47 };
    const result = alignNodeDrag(moving, [left, below], 1);
    expect(result.position).toEqual({ x: 100, y: 79 });
    expect(result.guides).toHaveLength(2);
  });

  it('uses screen pixels for the snap tolerance and excludes distant rows', () => {
    const moving = { x: 0, y: 60, width: 60, height: 20 };
    const target = { x: 10, y: 10, width: 60, height: 20 };
    expect(alignNodeDrag(moving, [target], 1).guides).toEqual([]);
    expect(alignNodeDrag(moving, [target], 0.5).position.x).toBe(10);
    expect(alignNodeDrag(moving, [{ ...target, y: 800 }], 0.5).guides).toEqual([]);
  });
});
