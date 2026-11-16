import type { Point } from './history';

export interface AlignmentRect extends Point {
  width: number;
  height: number;
}

export interface AlignmentGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface AlignmentMatch {
  offset: number;
  line: number;
  target: AlignmentRect;
  crossDistance: number;
}

const SNAP_DISTANCE = 8;
const NEIGHBOR_DISTANCE = 160;
const ANCHORS = [0, 0.5, 1];

function nearestMatch(
  moving: AlignmentRect,
  candidates: readonly AlignmentRect[],
  axis: 'x' | 'y',
  zoom: number,
): AlignmentMatch | undefined {
  const cross = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'width' : 'height';
  const crossSize = axis === 'x' ? 'height' : 'width';
  const tolerance = SNAP_DISTANCE / zoom;
  let best: AlignmentMatch | undefined;

  for (const target of candidates) {
    const gap = Math.max(
      target[cross] - (moving[cross] + moving[crossSize]),
      moving[cross] - (target[cross] + target[crossSize]),
      0,
    );
    if (gap > NEIGHBOR_DISTANCE / zoom) continue;
    const crossDistance = Math.abs(
      target[cross] + target[crossSize] / 2 - (moving[cross] + moving[crossSize] / 2),
    );
    for (const from of ANCHORS) {
      for (const to of ANCHORS) {
        if ((from === 0.5) !== (to === 0.5)) continue;
        const line = target[axis] + to * target[size];
        const offset = line - (moving[axis] + from * moving[size]);
        const distance = Math.abs(offset);
        if (distance > tolerance) continue;
        if (
          !best ||
          distance < Math.abs(best.offset) ||
          (distance === Math.abs(best.offset) && crossDistance < best.crossDistance)
        ) {
          best = { offset, line, target, crossDistance };
        }
      }
    }
  }

  return best;
}

export function alignNodeDrag(
  moving: AlignmentRect,
  candidates: readonly AlignmentRect[],
  zoom: number,
): { position: Point; guides: AlignmentGuide[] } {
  const xMatch = nearestMatch(moving, candidates, 'x', zoom);
  const yMatch = nearestMatch(moving, candidates, 'y', zoom);
  const x = moving.x + (xMatch?.offset ?? 0);
  const y = moving.y + (yMatch?.offset ?? 0);
  const guides: AlignmentGuide[] = [];

  if (xMatch) {
    const { line, target } = xMatch;
    guides.push({
      x1: line,
      x2: line,
      y1: Math.min(y, target.y),
      y2: Math.max(y + moving.height, target.y + target.height),
    });
  }
  if (yMatch) {
    const { line, target } = yMatch;
    guides.push({
      x1: Math.min(x, target.x),
      x2: Math.max(x + moving.width, target.x + target.width),
      y1: line,
      y2: line,
    });
  }
  return { position: { x, y }, guides };
}
