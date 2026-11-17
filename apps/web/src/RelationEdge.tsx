import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { directionalBezierPath } from '@workspacetree/layout';

/** 与 SVG 导出共用 layout 的贝塞尔几何，避免两种渲染器端点漂移。 */
export default function RelationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  markerStart,
  markerEnd,
  data,
  selected,
  interactionWidth,
}: EdgeProps) {
  const kind = typeof data?.kind === 'string' ? data.kind : 'hierarchy';
  const highlighted = data?.highlighted === true;
  const dimmed = data?.dimmed === true;
  const baseColor =
    typeof data?.color === 'string' ? data.color : kind === 'hierarchy' ? '#94a3b8' : '#dc2626';
  const baseWidth = typeof data?.width === 'number' ? data.width : kind === 'hierarchy' ? 1.8 : 2;
  const dashArray = typeof data?.dashArray === 'string' ? data.dashArray : undefined;
  const path = directionalBezierPath(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
    sourcePosition,
  );
  return (
    <BaseEdge
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      label={typeof data?.note === 'string' ? data.note : undefined}
      labelX={(sourceX + targetX) / 2}
      labelY={(sourceY + targetY) / 2}
      labelStyle={{ fill: '#1e293b', fontSize: 12 }}
      labelBgStyle={{ fill: '#fff' }}
      style={{
        stroke: selected ? '#2563eb' : highlighted ? '#ea580c' : baseColor,
        strokeWidth: selected || highlighted ? Math.max(3, baseWidth) : baseWidth,
        strokeDasharray: dashArray,
        strokeLinecap: dashArray === '1 5' ? 'round' : undefined,
        opacity: dimmed && !selected ? 0.18 : 1,
        transition: 'stroke 160ms ease, stroke-width 160ms ease, opacity 160ms ease',
      }}
    />
  );
}
