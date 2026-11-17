import { describe, expect, it } from 'vitest';
import {
  addRecentEdgeColor,
  EDGE_PRESET_COLORS,
  MAX_RECENT_EDGE_COLORS,
} from '../../apps/web/src/edge-colors';

describe('edge color palette', () => {
  it('provides two rows of seven preset colors', () => {
    expect(EDGE_PRESET_COLORS).toHaveLength(14);
    expect(EDGE_PRESET_COLORS.every((color) => /^#[0-9a-f]{6}$/i.test(color.value))).toBe(true);
  });

  it('moves a repeated custom color to the front and caps the recent list', () => {
    let recent: string[] = [];
    for (let index = 0; index < MAX_RECENT_EDGE_COLORS; index += 1) {
      recent = addRecentEdgeColor(recent, `#${index.toString(16).padStart(6, '0')}`);
    }
    expect(recent).toHaveLength(MAX_RECENT_EDGE_COLORS);
    expect(addRecentEdgeColor(recent, recent[3]!)).toEqual([
      recent[3],
      ...recent.filter((color) => color !== recent[3]),
    ]);
    expect(addRecentEdgeColor(recent, '#123456')).toEqual([
      '#123456',
      ...recent.slice(0, MAX_RECENT_EDGE_COLORS - 1),
    ]);
  });

  it('ignores invalid colors', () => {
    expect(addRecentEdgeColor(['#123456'], 'red')).toEqual(['#123456']);
  });
});
