/**
 * 曲线几何（06 §二 Phase 1 任务 2「SVG 贝塞尔曲线」、验收 4「连线跟随节点移动」）。
 * 同一组纯函数同时供画布自定义边与 SVG 导出消费，保证两种渲染器端点完全一致。
 */
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions, type Point } from './types.js';

export interface Anchors {
  source: Point;
  target: Point;
}

/** 水平方向树：从源节点右边缘中点连到目标节点左边缘中点。 */
export function edgeAnchors(from: Point, to: Point, options: LayoutOptions = {}): Anchors {
  const cfg = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  return {
    source: { x: from.x + cfg.nodeWidth, y: from.y + cfg.nodeHeight / 2 },
    target: { x: to.x, y: to.y + cfg.nodeHeight / 2 },
  };
}

/** 三次贝塞尔路径；控制点水平外推，回连（target 在 source 左侧）时自动加大弯曲。 */
export function bezierPath(source: Point, target: Point, curvature = 0.5): string {
  const spread = Math.max(48, Math.abs(target.x - source.x) * curvature);
  const c1 = { x: source.x + spread, y: source.y };
  const c2 = { x: target.x - spread, y: target.y };
  return `M ${round(source.x)},${round(source.y)} C ${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(target.x)},${round(target.y)}`;
}

/** 节点左上角坐标变化时重算整条路径：纯函数，无缓存、无 DOM 测量。 */
export function pathForNodes(
  from: Point,
  to: Point,
  options: LayoutOptions = {},
): { anchors: Anchors; path: string } {
  const anchors = edgeAnchors(from, to, options);
  return { anchors, path: bezierPath(anchors.source, anchors.target) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
