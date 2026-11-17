/**
 * 边样式默认值与聚合规则。2D React Flow、SVG 导出和属性面板共享同一解析结果，
 * 3D 仍消费 VisualEdge.color，不读取这里的 style2d。
 */
import type { Edge, EdgeStyle, EdgeType } from '@workspacetree/schema';

export interface ResolvedEdgeStyle {
  color: string;
  width: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  arrow: 'none' | 'start' | 'end' | 'both';
  dashArray?: string;
}

export type EdgeStyleField = 'color' | 'width' | 'lineStyle' | 'arrow';

export const DEFAULT_EDGE_STYLE: Record<EdgeType, ResolvedEdgeStyle> = {
  hierarchy: { color: '#64748b', width: 1.8, lineStyle: 'solid', arrow: 'end' },
  dependency: {
    color: '#dc2626',
    width: 2,
    lineStyle: 'dashed',
    arrow: 'end',
    dashArray: '6 4',
  },
  reference: {
    color: '#c026d3',
    width: 2,
    lineStyle: 'dashed',
    arrow: 'end',
    dashArray: '6 4',
  },
  custom: {
    color: '#c026d3',
    width: 2,
    lineStyle: 'dashed',
    arrow: 'end',
    dashArray: '6 4',
  },
};

export function dashArrayFor(lineStyle: ResolvedEdgeStyle['lineStyle']): string | undefined {
  if (lineStyle === 'dashed') return '6 4';
  if (lineStyle === 'dotted') return '1 5';
  return undefined;
}

export function resolveEdgeStyle(
  type: EdgeType,
  override?: Readonly<EdgeStyle> | null,
  fallbackColor?: string,
): ResolvedEdgeStyle {
  const base = DEFAULT_EDGE_STYLE[type];
  const lineStyle = override?.lineStyle ?? base.lineStyle;
  const width = override?.width ?? base.width;
  const color = override?.color ?? fallbackColor ?? base.color;
  return {
    color,
    width,
    lineStyle,
    arrow: override?.arrow ?? base.arrow,
    dashArray: dashArrayFor(lineStyle),
  };
}

export function isDirectVisualEdge(edge: Edge, sourceId: string, targetId: string): boolean {
  return edge.fromNodeId === sourceId && edge.toNodeId === targetId;
}

/** 聚合边逐字段取共同值；不同字段回退到类型默认并计入 mixedStyleFields。 */
export function resolveAggregatedEdgeStyle(
  type: EdgeType,
  originals: readonly Edge[],
  edgeStyles: Readonly<Record<string, EdgeStyle>> | undefined,
  edgeColors?: ReadonlyMap<string, string>,
): { style: ResolvedEdgeStyle; mixedStyleFields: EdgeStyleField[] } {
  const defaults = DEFAULT_EDGE_STYLE[type];
  if (originals.length === 0) return { style: defaults, mixedStyleFields: [] };
  const resolved = originals.map((edge) =>
    resolveEdgeStyle(edge.type, edgeStyles?.[edge.id], edgeColors?.get(edge.id)),
  );
  const fields: EdgeStyleField[] = ['color', 'width', 'lineStyle', 'arrow'];
  const style = { ...defaults } as ResolvedEdgeStyle;
  const mixedStyleFields: EdgeStyleField[] = [];
  for (const field of fields) {
    const first = resolved[0]![field];
    if (resolved.every((item) => item[field] === first)) {
      // 类型已收窄为具体字段值，此处仅做一次显式赋值以保留字段关联。
      Object.assign(style, { [field]: first });
    } else {
      mixedStyleFields.push(field);
    }
  }
  style.dashArray = dashArrayFor(style.lineStyle);
  return { style, mixedStyleFields };
}
