/**
 * 布局层中性类型与常量。
 * 纯 TS：不依赖 React 组件、DOM、Node / Electron API 或产品名（06 §一.2 / §二 Phase 1 验收 8）。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import type { EdgeType } from '@workspacetree/schema';
import type { EdgeStyleField, ResolvedEdgeStyle } from './edge-style.js';

export type LayoutDirection = 'horizontal' | 'vertical';
export type LayoutStrategy = 'timeline' | 'structure' | 'date-constrained' | 'date-priority';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface LayoutOptions {
  strategy?: LayoutStrategy;
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  timelineColumns?: number;
  timelineCrossSize?: number;
}

export const DEFAULT_LAYOUT_OPTIONS = {
  nodeWidth: 220,
  nodeHeight: 76,
  horizontalGap: 90,
  verticalGap: 28,
  timelineColumns: 3,
};

export interface LayoutResult {
  /** nodeId -> 左上角坐标。 */
  positions: Record<string, Point>;
  /** 被 SavedPresentation 手动锁定、自动布局不覆盖的节点。 */
  locked: string[];
  /** 自动布局的确定性顺序。 */
  order: string[];
}

export type VisualLod = 'full' | 'summary';

export const LOD_SCALE_THRESHOLD = 0.35;
export const LOD_MIN_WIDTH = 140;
export const LOD_MIN_HEIGHT = 44;

export interface VisualNode {
  id: string;
  position: Point;
  size: Size;
  /** 卡片最终显示比例，包含祖先分支比例和单节点比例。 */
  scale: number;
  /** 分支几何比例，不含单节点比例。 */
  branchScale: number;
  depth: number;
  startAt: string | null;
  collapsed: boolean;
  collapsedCount: number;
  taskDone: number;
  taskTotal: number;
  externalConnectionCount: number;
  lod: VisualLod;
  branchColor?: string;
}

export interface VisualEdge {
  id: string;
  type: EdgeType;
  sourceId: string;
  targetId: string;
  originalEdgeIds: string[];
  aggregatedCount: number;
  color?: string;
  /** 2D / SVG 使用的完整样式；3D 继续只消费上面的 color。 */
  style2d: ResolvedEdgeStyle;
  direct: boolean;
  mixedStyleFields: readonly EdgeStyleField[];
}

export type AnchorSide = 'left' | 'right' | 'top' | 'bottom';

export interface DateAnchor {
  date: string;
  position: number;
  nodeIds: string[];
}

/** 2D、3D 与导出共同消费的唯一几何结果。 */
export interface VisualGraph {
  direction: LayoutDirection;
  nodes: VisualNode[];
  nodeById: Record<string, VisualNode>;
  edges: VisualEdge[];
  positions: Record<string, Point>;
  sizes: Record<string, Size>;
  scales: Record<string, number>;
  locked: string[];
  order: string[];
  dateAnchors: DateAnchor[];
  hiddenNodeIds: string[];
  bounds: Bounds;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type VisibleEdgeTypes = readonly EdgeType[];

/** 06 §二 Phase 1 验收 2：默认只渲染 hierarchy 边。 */
export const DEFAULT_VISIBLE_EDGE_TYPES: VisibleEdgeTypes = ['hierarchy'];
