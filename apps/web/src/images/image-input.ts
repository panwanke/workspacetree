import { formatImageTag } from '@workspacetree/markdown';
import { processImageBytes } from './image-processing.worker.js';
import { isImageUrl, probeRemoteImage } from './image-url.js';
import type { AssetRecord } from '@workspacetree/schema';

export interface ImageInsertResult {
  markdownToInsert: string;
  assets: Record<string, AssetRecord>;
  placeholderToken: string;
}

/**
 * 生成唯一的占位标记
 */
export function generatePlaceholderToken(): string {
  return `placeholder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatPlaceholder(token: string, hint = '正在处理图片...'): string {
  return `![${hint}](${token})`;
}

/**
 * 从 ClipboardEvent 中提取图片文件（优先处理文件，去重）
 */
export function extractFilesFromClipboard(event: ClipboardEvent): File[] {
  const files: File[] = [];
  const items = event.clipboardData?.items;
  if (!items) return files;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * 从 DragEvent 中提取图片文件
 */
export function extractFilesFromDrop(event: DragEvent): File[] {
  const files: File[] = [];
  const dtFiles = event.dataTransfer?.files;
  if (!dtFiles) return files;

  for (let i = 0; i < dtFiles.length; i++) {
    const file = dtFiles[i]!;
    if (file.type.startsWith('image/')) {
      files.push(file);
    }
  }
  return files;
}

/**
 * 处理单个图片文件并产出嵌入 Markdown 与资产记录
 */
export async function processFileToAsset(
  file: File,
  widthPercent = 100,
): Promise<{ id: string; record: AssetRecord; markdown: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const result = await processImageBytes(bytes, file.type || 'image/jpeg');

  const alt = file.name.replace(/\.[^/.]+$/, '') || '插图';
  const markdown = formatImageTag({
    alt,
    url: `asset:${result.id}`,
    widthPercent,
  });

  return {
    id: result.id,
    record: result.record,
    markdown,
  };
}

/**
 * 统一处理粘贴内容：区分文件、图片 URL 或普通文本
 */
export async function handlePastedContent(
  text: string,
  files: File[],
): Promise<
  | { type: 'files'; files: File[] }
  | { type: 'image-url'; url: string; markdown: string }
  | { type: 'text'; text: string }
> {
  // 1. 如果剪贴板有文件，优先处理文件
  if (files.length > 0) {
    return { type: 'files', files };
  }

  // 2. 检查纯文本是否是单个 HTTP(S) 图片链接
  const trimmed = text.trim();
  if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
    const isImg = isImageUrl(trimmed);
    if (isImg) {
      const markdown = formatImageTag({
        alt: '参考图片',
        url: trimmed,
        widthPercent: 100,
      });
      return { type: 'image-url', url: trimmed, markdown };
    }
    // 探测远程链接
    const probe = await probeRemoteImage(trimmed, 2000);
    if (probe.isImage) {
      const markdown = formatImageTag({
        alt: '参考图片',
        url: trimmed,
        widthPercent: 100,
      });
      return { type: 'image-url', url: trimmed, markdown };
    }
  }

  // 3. 普通文本
  return { type: 'text', text };
}
