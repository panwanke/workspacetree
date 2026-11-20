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

export type Matrix2D = [a: number, b: number, c: number, d: number, e: number, f: number];

export function identityMatrix(): Matrix2D {
  return [1, 0, 0, 1, 0, 0];
}

export function translateMatrix(tx: number, ty: number): Matrix2D {
  return [1, 0, 0, 1, tx, ty];
}

export function scaleMatrix(sx: number, sy: number = sx): Matrix2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function multiplyMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * 分支绝对缩放变换矩阵：以锚点 anchor 为固定中心进行等比几何缩放
 * M = T(anchor) * S(scale) * T(-anchor)
 */
export function anchorScaleMatrix(anchor: Point, scale: number): Matrix2D {
  return [scale, 0, 0, scale, anchor.x * (1 - scale), anchor.y * (1 - scale)];
}

export function transformPoint(m: Matrix2D, p: Point): Point {
  return {
    x: round(m[0] * p.x + m[2] * p.y + m[4]),
    y: round(m[1] * p.x + m[3] * p.y + m[5]),
  };
}

export function invertMatrix(m: Matrix2D): Matrix2D {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return identityMatrix();
  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * f - d * e) * invDet,
    (b * e - a * f) * invDet,
  ];
}

/**
 * 计算分支根节点面向父节点的挂载连接锚点，随布局方向自适应：
 * - horizontal (LTR): 根节点的左边缘中点
 * - horizontal (RTL): 根节点的右边缘中点
 * - vertical (TTB): 根节点的顶边缘中点
 */
export function branchAnchorPoint(
  nodePosition: Point,
  nodeSize: { width: number; height: number },
  direction: 'horizontal' | 'vertical' = 'horizontal',
  isRtl = false,
): Point {
  if (direction === 'vertical') {
    return {
      x: round(nodePosition.x + nodeSize.width / 2),
      y: round(nodePosition.y),
    };
  }
  if (isRtl) {
    return {
      x: round(nodePosition.x + nodeSize.width),
      y: round(nodePosition.y + nodeSize.height / 2),
    };
  }
  return {
    x: round(nodePosition.x),
    y: round(nodePosition.y + nodeSize.height / 2),
  };
}
