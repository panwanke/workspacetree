/**
 * SVG 导出（06 §二 Phase 1 验收 6：与画布结构一致，且可选择包含哪些边类型）。
 * 与画布共用 @workspacetree/layout 的同一组几何/坐标函数，端点不会漂移。
 * 纯 TS：不依赖 React 组件、DOM、Node / Electron API；输入是数据，输出是字符串。
 */
import {
  DEFAULT_VISIBLE_EDGE_TYPES,
  layoutBounds,
  pathForNodes,
  visualEdgeAnchors,
  visualEdgePath,
  resolveEdgeStyle,
  type LayoutOptions,
  type Point,
  type ResolvedEdgeStyle,
  type VisibleEdgeTypes,
  type VisualGraph,
} from '@workspacetree/layout';
import {
  extractAllImages,
  indexWorkspaceTasks,
  workspaceTaskCounts,
} from '@workspacetree/markdown';
import type { AssetRecord, Block, Edge, Node, Task } from '@workspacetree/schema';

export interface SvgExportInput {
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** nodeId -> 左上角坐标，来自 resolvePositions / SavedPresentation。 */
  positions: Record<string, Point>;
  tasks?: readonly Task[];
  blocks?: readonly Block[];
  assets?: Record<string, AssetRecord>;
  /** 默认只含 hierarchy；调用方可显式选择 dependency / reference / custom。 */
  visibleEdgeTypes?: VisibleEdgeTypes;
  highlightNodeIds?: readonly string[];
  title?: string;
  options?: LayoutOptions;
  /** Phase 2：传入后直接复用画布的折叠、缩放、方向与连线汇聚结果。 */
  graph?: VisualGraph;
}

export interface SvgExportMeta {
  width: number;
  height: number;
  nodeCount: number;
  edgeCount: number;
  edgeTypes: string[];
}

export interface SvgExportResult {
  svg: string;
  meta: SvgExportMeta;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportSvg(input: SvgExportInput): SvgExportResult {
  const cfg = input.options ?? {};
  const visibleTypes = input.visibleEdgeTypes ?? DEFAULT_VISIBLE_EDGE_TYPES;
  const visible = new Set<string>(visibleTypes);
  const positions = input.graph?.positions ?? input.positions;
  const bounds = input.graph?.bounds ?? layoutBounds(positions, cfg, 48);
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + 48));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + 48));
  const nodeWidth = cfg.nodeWidth ?? 220;
  const nodeHeight = cfg.nodeHeight ?? 76;
  const highlight = new Set(input.highlightNodeIds ?? []);
  const tasks = input.graph ? undefined : indexWorkspaceTasks(input);

  const sourceEdges = new Map(input.edges.map((edge) => [edge.id, edge]));
  const exportEdges = input.graph
    ? input.graph.edges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        originalIds: edge.originalEdgeIds,
        color: edge.color,
        style2d: edge.style2d as ResolvedEdgeStyle | undefined,
      }))
    : input.edges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        sourceId: edge.fromNodeId,
        targetId: edge.toNodeId,
        originalIds: [edge.id],
        color: undefined as string | undefined,
        style2d: undefined as ResolvedEdgeStyle | undefined,
      }));
  const styleOf = (edge: (typeof exportEdges)[number]): ResolvedEdgeStyle =>
    edge.style2d ?? resolveEdgeStyle(edge.type, undefined, edge.color);
  const markerColors = new Set<string>();
  for (const edge of exportEdges) {
    if (!visible.has(edge.type)) continue;
    const style = styleOf(edge);
    if (style.arrow === 'start' || style.arrow === 'end' || style.arrow === 'both') {
      markerColors.add(style.color);
    }
  }
  const markerIds = new Map(
    [...markerColors].map((color, index) => [color, `wst-arrow-${index}`] as const),
  );

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.minX - 24} ${bounds.minY - 24} ${width} ${height}">`,
  );
  lines.push('  <defs>');
  for (const [color, id] of markerIds) {
    lines.push(
      `    <marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}" /></marker>`,
    );
  }
  lines.push('  </defs>');
  lines.push(
    `  <rect x="${bounds.minX - 24}" y="${bounds.minY - 24}" width="${width}" height="${height}" fill="#ffffff" />`,
  );
  if (input.title) {
    lines.push(
      `  <text x="${bounds.minX - 12}" y="${bounds.minY - 6}" font-family="system-ui, sans-serif" font-size="13" fill="#475569">${escapeXml(input.title)}</text>`,
    );
  }

  lines.push('  <g id="edges" fill="none">');
  const drawnEdges: string[] = [];
  for (const edge of exportEdges) {
    if (!visible.has(edge.type)) continue;
    const from = positions[edge.sourceId];
    const to = positions[edge.targetId];
    if (!from || !to) continue;
    const sourceVisual = input.graph?.nodeById[edge.sourceId];
    const targetVisual = input.graph?.nodeById[edge.targetId];
    const path =
      sourceVisual && targetVisual && input.graph
        ? visualEdgePath(sourceVisual, targetVisual, input.graph.direction)
        : pathForNodes(from, to, cfg).path;
    const style = styleOf(edge);
    const marker = markerIds.get(style.color);
    const markerStart =
      marker && (style.arrow === 'start' || style.arrow === 'both')
        ? ` marker-start="url(#${marker})"`
        : '';
    const markerEnd =
      marker && (style.arrow === 'end' || style.arrow === 'both')
        ? ` marker-end="url(#${marker})"`
        : '';
    const dash = style.dashArray ? ` stroke-dasharray="${style.dashArray}"` : '';
    const cap = style.lineStyle === 'dotted' ? ' stroke-linecap="round"' : '';
    lines.push(
      `    <path id="${escapeXml(edge.id)}" data-edge-type="${edge.type}" d="${path}" stroke="${style.color}" stroke-width="${style.width}"${dash}${cap}${markerStart}${markerEnd} />`,
    );
    const original =
      edge.originalIds.length === 1 ? sourceEdges.get(edge.originalIds[0]) : undefined;
    if (
      original?.note &&
      original.fromNodeId === edge.sourceId &&
      original.toNodeId === edge.targetId
    ) {
      const anchors =
        sourceVisual && targetVisual && input.graph
          ? visualEdgeAnchors(sourceVisual, targetVisual, input.graph.direction)
          : pathForNodes(from, to, cfg).anchors;
      const labelX = (anchors.source.x + anchors.target.x) / 2;
      const labelY = (anchors.source.y + anchors.target.y) / 2;
      lines.push(
        `    <text data-edge-note="${escapeXml(original.id)}" x="${labelX}" y="${labelY}" text-anchor="middle" fill="#1e293b" font-family="system-ui, sans-serif" font-size="12">${escapeXml(original.note)}</text>`,
      );
    }
    drawnEdges.push(edge.type);
  }
  lines.push('  </g>');

  lines.push('  <g id="nodes">');
  const blockMap = new Map((input.blocks ?? []).map((b) => [b.id, b]));

  for (const node of input.nodes) {
    const position = positions[node.id];
    if (!position) continue;
    const active = highlight.has(node.id);
    const visual = input.graph?.nodeById[node.id];
    const stats = visual
      ? { done: visual.taskDone, total: visual.taskTotal }
      : workspaceTaskCounts(tasks?.byNode.get(node.id));
    const width = visual?.size.width ?? nodeWidth;
    const height = visual?.size.height ?? nodeHeight;
    const fill = visual?.collapsed
      ? '#eff6ff'
      : node.archived
        ? '#f1f5f9'
        : active
          ? '#fff7ed'
          : '#ffffff';
    const stroke = active ? '#ea580c' : visual?.collapsed ? '#3b82f6' : '#cbd5e1';
    const summary = visual?.collapsed
      ? `${visual.collapsedCount} nodes · tasks ${stats.done}/${stats.total} · ${visual.externalConnectionCount} links`
      : visual?.lod === 'summary'
        ? `LOD summary · tasks ${stats.done}/${stats.total}`
        : `tasks ${stats.done}/${stats.total}${node.archived ? ' · archived' : ''}`;
    const textScale = visual?.lod === 'summary' ? 1 : (visual?.scale ?? 1);

    const imageElements: string[] = [];
    if (!visual?.collapsed && visual?.lod !== 'summary') {
      const nodeBlocks = node.blockIds.map((id) => blockMap.get(id)).filter(Boolean);
      let imgOffsetY = position.y + 60 * textScale;
      for (const b of nodeBlocks) {
        const markdown = (b?.payload as { markdown?: string })?.markdown;
        if (markdown) {
          const images = extractAllImages(markdown);
          for (const imgMeta of images) {
            let href = imgMeta.url;
            if (imgMeta.isAsset && imgMeta.assetId && input.assets?.[imgMeta.assetId]) {
              const record = input.assets[imgMeta.assetId];
              href = `data:${record.mime};base64,${record.base64}`;
            }
            const pct = (imgMeta.widthPercent ?? 50) / 100;
            const imgWidth = Math.max(20, Math.round((width - 24) * pct));
            const imgHeight = Math.round(imgWidth * 0.6);
            imageElements.push(
              `      <image href="${escapeXml(href)}" x="${position.x + 12}" y="${imgOffsetY}" width="${imgWidth}" height="${imgHeight}" preserveAspectRatio="xMidYMid meet" />`,
            );
            imgOffsetY += imgHeight + 4;
          }
        }
      }
    }

    lines.push(
      `    <g id="${escapeXml(node.id)}" data-node-id="${escapeXml(node.id)}">`,
      `      <rect x="${position.x}" y="${position.y}" width="${width}" height="${height}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${active ? 2.5 : 1.4}" />`,
      `      <text x="${position.x + 12}" y="${position.y + 27 * textScale}" font-family="system-ui, sans-serif" font-size="${14 * textScale}" font-weight="600" fill="#0f172a">${escapeXml(truncate(node.title, 24))}</text>`,
      `      <text x="${position.x + 12}" y="${position.y + 50 * textScale}" font-family="system-ui, sans-serif" font-size="${11 * textScale}" fill="#64748b">${escapeXml(summary)}</text>`,
      ...imageElements,
      '    </g>',
    );
  }
  lines.push('  </g>');
  lines.push('</svg>');

  return {
    svg: lines.join('\n'),
    meta: {
      width,
      height,
      nodeCount: input.nodes.filter((node) => Boolean(positions[node.id])).length,
      edgeCount: drawnEdges.length,
      edgeTypes: [...new Set(drawnEdges)].sort(),
    },
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
