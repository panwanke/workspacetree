import type { Root, Paragraph } from 'mdast';
import { visit } from 'unist-util-visit';

export interface MarkdownImageMeta {
  alt: string;
  url: string;
  widthPercent?: number; // 10% - 100%
  pixelWidth?: number;
  pixelHeight?: number;
  isAsset: boolean;
  assetId?: string; // e.g. 'sha256_abcd'
  raw?: string;
}

export const ASSET_PROTOCOL = 'asset:';

export function isAssetUrl(url: string): boolean {
  return url.startsWith(ASSET_PROTOCOL);
}

export function assetIdFromUrl(url: string): string | undefined {
  if (isAssetUrl(url)) {
    return url.slice(ASSET_PROTOCOL.length);
  }
  return undefined;
}

export function assetUrlFromId(id: string): string {
  return `${ASSET_PROTOCOL}${id}`;
}

/**
 * 解析图片 tag（包含本项目 `{width=60%}` 扩展与 Obsidian `|300` 兼容写法）。
 */
export function parseImageMeta(
  altText: string,
  url: string,
  suffixText?: string,
): MarkdownImageMeta {
  let cleanAlt = altText;
  let widthPercent: number | undefined;
  let pixelWidth: number | undefined;
  let pixelHeight: number | undefined;

  // 1. 优先检查 `{width=X%}` 后缀
  if (suffixText) {
    const widthMatch = /^\{width=(\d+)%\}/.exec(suffixText);
    if (widthMatch) {
      const parsed = parseInt(widthMatch[1]!, 10);
      if (!Number.isNaN(parsed)) {
        widthPercent = Math.max(10, Math.min(100, parsed));
      }
    }
  }

  // 2. 如果没有 `{width=X%}`，检查 Obsidian 兼容写法：`alt|100%` 或 `alt|300` 或 `alt|300x200`
  if (widthPercent === undefined && cleanAlt.includes('|')) {
    const parts = cleanAlt.split('|');
    cleanAlt = parts[0]!.trim();
    const sizeSpec = parts[parts.length - 1]!.trim();

    const percentMatch = /^(\d+)%$/.exec(sizeSpec);
    if (percentMatch) {
      const parsed = parseInt(percentMatch[1]!, 10);
      if (!Number.isNaN(parsed)) {
        widthPercent = Math.max(10, Math.min(100, parsed));
      }
    } else {
      const dimMatch = /^(\d+)(?:x(\d+))?$/.exec(sizeSpec);
      if (dimMatch) {
        pixelWidth = parseInt(dimMatch[1]!, 10);
        if (dimMatch[2]) {
          pixelHeight = parseInt(dimMatch[2]!, 10);
        }
      }
    }
  }

  const isAsset = isAssetUrl(url);
  const assetId = assetIdFromUrl(url);

  return {
    alt: cleanAlt,
    url,
    widthPercent,
    pixelWidth,
    pixelHeight,
    isAsset,
    assetId,
  };
}

/**
 * 格式化图片 tag
 */
export function formatImageTag(meta: {
  alt?: string;
  url: string;
  widthPercent?: number;
}): string {
  const alt = meta.alt ?? '';
  const widthAttr =
    meta.widthPercent != null && meta.widthPercent >= 10 && meta.widthPercent <= 100
      ? `{width=${Math.round(meta.widthPercent)}%}`
      : '';
  return `![${alt}](${meta.url})${widthAttr}`;
}

/** 正则扫描整个 Markdown 字符串中的图片 */
export const IMAGE_TAG_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\{width=(\d+)%\})?/g;

export function extractAllImages(markdown: string): MarkdownImageMeta[] {
  const images: MarkdownImageMeta[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMAGE_TAG_REGEX.source, 'g');

  while ((match = regex.exec(markdown)) !== null) {
    const [raw, alt = '', url = '', widthStr] = match;
    const meta = parseImageMeta(
      alt,
      url,
      widthStr ? `{width=${widthStr}%}` : undefined,
    );
    images.push({ ...meta, raw });
  }

  return images;
}

export function extractAssetIds(markdown: string): string[] {
  const images = extractAllImages(markdown);
  const ids = new Set<string>();
  for (const img of images) {
    if (img.isAsset && img.assetId) {
      ids.add(img.assetId);
    }
  }
  return [...ids];
}

/**
 * remark 插件：将图片紧跟的 `{width=X%}` 合并到 image 节点的 data.widthPercent 中，
 * 并从后续 text 节点中清除 `{width=X%}`。
 */
export function remarkImageAttributes() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph) => {
      if (!node.children || node.children.length === 0) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child?.type === 'image') {
          const nextChild = node.children[i + 1];
          let widthSuffix: string | undefined;
          if (nextChild?.type === 'text') {
            const match = /^\{width=(\d+)%\}/.exec(nextChild.value);
            if (match) {
              widthSuffix = match[0];
              const remaining = nextChild.value.slice(match[0].length);
              if (remaining) {
                nextChild.value = remaining;
              } else {
                node.children.splice(i + 1, 1);
              }
            }
          }
          const meta = parseImageMeta(child.alt || '', child.url, widthSuffix);
          (child as any).data = {
            ...(child as any).data,
            ...meta,
          };
        }
      }
    });
  };
}

export const remarkImageDimensionsPlugin = remarkImageAttributes;
