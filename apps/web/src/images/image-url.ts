import { createAssetRecord } from './image-assets.js';
import type { AssetRecord } from '@workspacetree/schema';

export const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
]);

/**
 * 判断 URL 是否可能是图片链接（支持保留查询参数）
 */
export function isImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'http://localhost');
    const pathname = parsed.pathname.toLowerCase();
    const dotIndex = pathname.lastIndexOf('.');
    if (dotIndex >= 0) {
      const ext = pathname.slice(dotIndex + 1);
      if (IMAGE_EXTENSIONS.has(ext)) return true;
    }
  } catch {
    // 忽略
  }
  return false;
}

/**
 * 探测远程 URL 是否可作为图片渲染（利用 img 元素加载，无需 CORS 权限）
 */
export function probeRemoteImage(
  url: string,
  timeoutMs = 5000,
): Promise<{ isImage: boolean; width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      // 非浏览器环境根据扩展名推断
      resolve({ isImage: isImageUrl(url) });
      return;
    }

    const img = new Image();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        img.src = '';
        resolve({ isImage: false });
      }
    }, timeoutMs);

    img.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          isImage: true,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      }
    };

    img.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ isImage: false });
      }
    };

    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

export interface FetchRemoteAssetResult {
  success: boolean;
  id?: string;
  record?: AssetRecord;
  error?: string;
}

/**
 * 尝试通过 CORS 请求下载远程图片并转为本地嵌入资产。
 * 若遭遇 CORS 限制，返回明确提示，原图片仍可继续通过 URL 显示。
 */
export async function fetchRemoteImageAsAsset(url: string): Promise<FetchRemoteAssetResult> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      return {
        success: false,
        error: `下载远程图片失败 (HTTP ${response.status})`,
      };
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 默认尺寸探测
    const probe = await probeRemoteImage(url);
    const width = probe.width || 800;
    const height = probe.height || 600;

    const { id, record } = createAssetRecord(bytes, contentType, width, height);
    return { success: true, id, record };
  } catch {
    return {
      success: false,
      error:
        '受浏览器跨域(CORS)限制，无法下载该远程图片转为嵌入项目资产。图片仍可作为外部链接正常显示。',
    };
  }
}
