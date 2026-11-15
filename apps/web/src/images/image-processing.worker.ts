import { createAssetRecord } from './image-assets.js';
import type { AssetRecord } from '@workspacetree/schema';

export const COMPRESSION_MAX_BYTES = 1024 * 1024; // 1 MiB
export const COMPRESSION_MAX_DIMENSION = 2048; // 2048 px
export const MAX_INPUT_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_PIXELS = 40_000_000; // 40 MP

export interface ProcessImageOptions {
  maxBytes?: number;
  maxDimension?: number;
  quality?: number;
}

export interface ProcessedImageResult {
  id: string;
  record: AssetRecord;
  compressed: boolean;
  originalBytes: number;
}

/**
 * 计算缩放尺寸：保持宽高比，长边不超过 maxDimension
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number; scaled: boolean } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height, scaled: false };
  }
  if (width >= height) {
    const targetWidth = maxDimension;
    const targetHeight = Math.max(1, Math.round((height * maxDimension) / width));
    return { width: targetWidth, height: targetHeight, scaled: true };
  } else {
    const targetHeight = maxDimension;
    const targetWidth = Math.max(1, Math.round((width * maxDimension) / height));
    return { width: targetWidth, height: targetHeight, scaled: true };
  }
}

/**
 * 核心图片压缩与处理函数：
 * 支持浏览器 OffscreenCanvas / HTMLCanvasElement，并在无 DOM 环境（如 Node.js 测试）平滑回退
 */
export async function processImageBytes(
  bytes: Uint8Array,
  mimeType: string,
  options: ProcessImageOptions = {},
): Promise<ProcessedImageResult> {
  const maxBytes = options.maxBytes ?? COMPRESSION_MAX_BYTES;
  const maxDim = options.maxDimension ?? COMPRESSION_MAX_DIMENSION;
  const minQuality = options.quality ?? 0.65;
  const originalBytes = bytes.byteLength;

  if (originalBytes > MAX_INPUT_FILE_BYTES) {
    throw new Error(
      `图片文件超出限制（最大允许 20 MiB，当前 ${(originalBytes / (1024 * 1024)).toFixed(1)} MiB）`,
    );
  }

  // 1. 动图 (GIF / APNG) 如果在阈值内，直接保留原始动画
  const isGif = mimeType === 'image/gif';
  if (isGif && originalBytes <= maxBytes) {
    const { id, record } = createAssetRecord(bytes, mimeType, 800, 600);
    return { id, record, compressed: false, originalBytes };
  }

  // 2. 如果在非浏览器环境（Node 测试中无 Canvas / createImageBitmap），且无需压缩，直接生成资产
  if (typeof createImageBitmap === 'undefined' && typeof document === 'undefined') {
    const { id, record } = createAssetRecord(bytes, mimeType, 800, 600);
    return { id, record, compressed: false, originalBytes };
  }

  // 3. 浏览器端使用 createImageBitmap 解码尺寸
  try {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const origWidth = bitmap.width;
    const origHeight = bitmap.height;

    if (origWidth * origHeight > MAX_PIXELS) {
      bitmap.close?.();
      throw new Error(`图片像素超出限制（最大允许 40 MP）`);
    }

    const {
      width: targetWidth,
      height: targetHeight,
      scaled,
    } = calculateTargetDimensions(origWidth, origHeight, maxDim);

    // 如果未超过尺寸且字节数小于 1 MiB，直接采用原图
    if (!scaled && originalBytes <= maxBytes) {
      bitmap.close?.();
      const { id, record } = createAssetRecord(bytes, mimeType, origWidth, origHeight);
      return { id, record, compressed: false, originalBytes };
    }

    // 4. 使用 OffscreenCanvas 或普通 Canvas 进行缩放与重编码
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(targetWidth, targetHeight);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();

    // 目标格式选择：透明图优先 WebP/PNG，其余使用 WebP 或 JPEG
    const targetMime = mimeType === 'image/png' ? 'image/webp' : 'image/jpeg';
    let quality = 0.85;

    let outputBlob: Blob | null = null;
    if ('convertToBlob' in canvas) {
      outputBlob = await (canvas as OffscreenCanvas).convertToBlob({
        type: targetMime,
        quality,
      });
      // 迭代压缩质量
      while (outputBlob.size > maxBytes && quality > minQuality) {
        quality -= 0.1;
        outputBlob = await (canvas as OffscreenCanvas).convertToBlob({
          type: targetMime,
          quality,
        });
      }
    } else {
      outputBlob = await new Promise<Blob | null>((resolve) => {
        (canvas as HTMLCanvasElement).toBlob(resolve, targetMime, quality);
      });
    }

    if (outputBlob) {
      const buffer = await outputBlob.arrayBuffer();
      const compressedBytes = new Uint8Array(buffer);
      const { id, record } = createAssetRecord(
        compressedBytes,
        outputBlob.type || targetMime,
        targetWidth,
        targetHeight,
      );
      return { id, record, compressed: true, originalBytes };
    }

    // 回退
    const { id, record } = createAssetRecord(bytes, mimeType, origWidth, origHeight);
    return { id, record, compressed: false, originalBytes };
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('超出限制')) {
      throw cause;
    }
    // 解码或压缩异常时保留原图
    const { id, record } = createAssetRecord(bytes, mimeType, 800, 600);
    return { id, record, compressed: false, originalBytes };
  }
}
