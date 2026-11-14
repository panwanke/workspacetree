import { computeBytesSha256Hex } from '@workspacetree/core';
import type { AssetRecord } from '@workspacetree/schema';

/**
 * 计算资产唯一 ID：sha256_${hex}
 */
export function computeAssetId(bytes: Uint8Array): string {
  return `sha256_${computeBytesSha256Hex(bytes)}`;
}

/**
 * Uint8Array 与 Base64 互转
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function createAssetRecord(
  bytes: Uint8Array,
  mime: string,
  width: number,
  height: number,
): { id: string; record: AssetRecord } {
  const id = computeAssetId(bytes);
  const base64 = bytesToBase64(bytes);
  const record: AssetRecord = {
    mime,
    byteLength: bytes.byteLength,
    width,
    height,
    base64,
  };
  return { id, record };
}

/**
 * 运行时 Blob URL 缓存
 */
class AssetBlobUrlCache {
  private urls = new Map<string, string>();

  getUrl(id: string, record?: AssetRecord): string {
    const cached = this.urls.get(id);
    if (cached) return cached;
    if (!record) return '';

    if (typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      const bytes = base64ToBytes(record.base64);
      const blob = new Blob([bytes as BlobPart], { type: record.mime });
      const url = URL.createObjectURL(blob);
      this.urls.set(id, url);
      return url;
    }

    // Node 环境回退到 data URL
    return `data:${record.mime};base64,${record.base64}`;
  }

  revoke(id: string): void {
    const url = this.urls.get(id);
    if (url && typeof URL !== 'undefined') {
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
  }

  clear(): void {
    if (typeof URL !== 'undefined') {
      for (const url of this.urls.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.urls.clear();
  }
}

export const assetBlobUrls = new AssetBlobUrlCache();

/** 资产存储配额检查（超过 20 MiB 提示用户） */
export const STORAGE_WARNING_BYTES = 20 * 1024 * 1024; // 20 MiB

export async function estimateStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percent: number;
  warning: boolean;
}> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;
      return {
        usage,
        quota,
        percent,
        warning: usage >= STORAGE_WARNING_BYTES,
      };
    } catch {
      // 容错
    }
  }
  return { usage: 0, quota: 0, percent: 0, warning: false };
}
