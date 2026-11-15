import { useState, useRef, useEffect, useCallback } from 'react';
import type { MarkdownImageMeta } from '@workspacetree/markdown';
import type { AssetRecord } from '@workspacetree/schema';
import { assetBlobUrls } from './image-assets.js';
import '../markdown/markdown.css';

export interface MarkdownImageProps {
  meta: MarkdownImageMeta;
  assets?: Record<string, AssetRecord>;
  interactive?: boolean; // 是否允许拖拽调整尺寸（编辑态为 true）
  onWidthPercentChange?: (widthPercent: number) => void;
  className?: string;
}

export function MarkdownImage({
  meta,
  assets,
  interactive = false,
  onWidthPercentChange,
  className = '',
}: MarkdownImageProps) {
  const [widthPercent, setWidthPercent] = useState<number>(meta.widthPercent ?? 50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (meta.widthPercent !== undefined) {
      setWidthPercent(meta.widthPercent);
    }
  }, [meta.widthPercent]);

  // 解析 asset 或 URL
  const resolvedUrl =
    meta.isAsset && meta.assetId
      ? assetBlobUrls.getUrl(meta.assetId, assets?.[meta.assetId])
      : meta.url;

  // 拖动调整尺寸：屏幕位移换算为容器宽度的百分比
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const initialPercent = widthPercent;
      const parentWidth = containerRef.current?.parentElement?.getBoundingClientRect().width || 400;

      setIsDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaPercent = (deltaX / parentWidth) * 100;
        const newPercent = Math.max(10, Math.min(100, Math.round(initialPercent + deltaPercent)));
        setWidthPercent(newPercent);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        setIsDragging(false);

        const deltaX = upEvent.clientX - startX;
        const deltaPercent = (deltaX / parentWidth) * 100;
        const finalPercent = Math.max(10, Math.min(100, Math.round(initialPercent + deltaPercent)));
        onWidthPercentChange?.(finalPercent);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [interactive, widthPercent, onWidthPercentChange],
  );

  if (meta.isAsset && (!resolvedUrl || resolvedUrl === '')) {
    return (
      <div className={`wst-md-img-missing ${className}`} title={meta.url}>
        ⚠️ 缺失图片资产 ({meta.url})
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`wst-image-container nodrag nopan ${interactive ? 'is-interactive' : ''} ${className}`}
      style={{ width: `${widthPercent}%` }}
    >
      <img
        src={resolvedUrl || meta.url}
        alt={meta.alt || '插图'}
        className="wst-md-img"
        loading="lazy"
      />
      {interactive && (
        <div
          className={`wst-image-resize-handle ${isDragging ? 'is-dragging' : ''}`}
          onPointerDown={handlePointerDown}
          title={`拖动调整尺寸 (${widthPercent}%)`}
        />
      )}
      {isDragging && <div className="wst-image-resize-badge">{widthPercent}%</div>}
    </div>
  );
}
