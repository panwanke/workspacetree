import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import type { LayoutDirection, VisualGraph } from '@workspacetree/layout';

interface TimelineTick {
  date: string;
  screenPos: number;
  nodeIds: string[];
}

export default function TimelineAxis({
  graph,
  direction,
  onSelectDateNodes,
}: {
  graph: VisualGraph;
  direction: LayoutDirection;
  onSelectDateNodes: (nodeIds: string[]) => void;
}) {
  const viewport = useViewport();
  const isVertical = direction === 'vertical';

  const ticks = useMemo<TimelineTick[]>(() => {
    const offset = isVertical ? viewport.y : viewport.x;
    const minSpacing = isVertical ? 24 : 92;
    const filtered: TimelineTick[] = [];
    for (const { date, position, nodeIds } of graph.dateAnchors) {
      const screenPos = offset + position * viewport.zoom;
      const prev = filtered[filtered.length - 1];
      if (!prev || screenPos - prev.screenPos >= minSpacing) {
        filtered.push({ date, screenPos, nodeIds });
      }
    }
    return filtered;
  }, [graph.dateAnchors, isVertical, viewport.x, viewport.y, viewport.zoom]);

  return (
    <div
      className={`wst-timeline-axis ${isVertical ? 'is-vertical' : 'is-horizontal'}`}
      aria-label="时间轴日期标尺"
    >
      <div className="wst-timeline-header">{isVertical ? '时间轴' : '日期'}</div>
      {ticks.map((tick) => (
        <button
          key={tick.date}
          type="button"
          className="wst-timeline-tick"
          style={isVertical ? { top: `${tick.screenPos}px` } : { left: `${tick.screenPos}px` }}
          title={`${tick.date}（${tick.nodeIds.length} 个节点，点击选中）`}
          onClick={() => onSelectDateNodes(tick.nodeIds)}
        >
          <span className="wst-timeline-dot" />
          <span className="wst-timeline-label">{tick.date.slice(5)}</span>
        </button>
      ))}
    </div>
  );
}
