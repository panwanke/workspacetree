import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  computeAssetId,
  createAssetRecord,
  assetBlobUrls,
} from '../../apps/web/src/images/image-assets.js';
import {
  calculateTargetDimensions,
  processImageBytes,
} from '../../apps/web/src/images/image-processing.worker.js';
import {
  isImageUrl,
  fetchRemoteImageAsAsset,
} from '../../apps/web/src/images/image-url.js';
import {
  formatPlaceholder,
  generatePlaceholderToken,
  handlePastedContent,
} from '../../apps/web/src/images/image-input.js';

describe('阶段 3: 图片插入、压缩、URL 与资产处理 (tests/web/image-insertion.test.ts)', () => {
  it('Base64 与 Uint8Array 互转及 SHA-256 资产 ID 往返正确', () => {
    const original = new Uint8Array([0, 127, 255, 64, 32, 16, 8, 4, 2, 1]);
    const b64 = bytesToBase64(original);
    const roundtrip = base64ToBytes(b64);
    expect(roundtrip).toEqual(original);

    const assetId = computeAssetId(original);
    expect(assetId).toMatch(/^sha256_[0-9a-f]{64}$/);

    const { id, record } = createAssetRecord(original, 'image/png', 100, 200);
    expect(id).toBe(assetId);
    expect(record.byteLength).toBe(10);
    expect(record.width).toBe(100);
    expect(record.height).toBe(200);
  });

  describe('calculateTargetDimensions: 保持宽高比与长边限制', () => {
    it('小图或未超过限制的图片保持原始尺寸', () => {
      const dim = calculateTargetDimensions(1024, 768, 2048);
      expect(dim).toEqual({ width: 1024, height: 768, scaled: false });
    });

    it('宽度超过 2048 时按比例缩小', () => {
      const dim = calculateTargetDimensions(4096, 2048, 2048);
      expect(dim).toEqual({ width: 2048, height: 1024, scaled: true });
    });

    it('高度超过 2048 时按比例缩小', () => {
      const dim = calculateTargetDimensions(1500, 3000, 2048);
      expect(dim).toEqual({ width: 1024, height: 2048, scaled: true });
    });
  });

  describe('processImageBytes: 压缩与超限保护', () => {
    it('文件超过 20 MiB 时抛出超出限制异常', async () => {
      const largeBytes = new Uint8Array(21 * 1024 * 1024);
      await expect(processImageBytes(largeBytes, 'image/jpeg')).rejects.toThrow('超出限制');
    });

    it('GIF 动图在 1 MiB 阈值内时直接保留原始动画', async () => {
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
      const result = await processImageBytes(gifBytes, 'image/gif');
      expect(result.compressed).toBe(false);
      expect(result.originalBytes).toBe(gifBytes.byteLength);
    });

    it('在无 DOM 环境下正常回退生成资产记录', async () => {
      const samplePng = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await processImageBytes(samplePng, 'image/png');
      expect(result.id).toMatch(/^sha256_/);
      expect(result.record.mime).toBe('image/png');
    });
  });

  describe('isImageUrl 与 URL 探测', () => {
    it('识别带标准扩展名的图片 URL（含大小写与查询参数）', () => {
      expect(isImageUrl('https://example.com/avatar.png')).toBe(true);
      expect(isImageUrl('https://example.com/photo.JPG?size=medium&token=xyz')).toBe(true);
      expect(isImageUrl('https://example.com/banner.webp#main')).toBe(true);
      expect(isImageUrl('https://example.com/icon.svg')).toBe(true);
      expect(isImageUrl('https://example.com/animation.gif')).toBe(true);
    });

    it('非图片 URL 正确排除', () => {
      expect(isImageUrl('https://example.com/docs/readme.pdf')).toBe(false);
      expect(isImageUrl('https://example.com/blog/article-1')).toBe(false);
      expect(isImageUrl('not a url')).toBe(false);
    });

    it('fetchRemoteImageAsAsset 在遭遇 CORS 限制或网络故障时返回明确说明', async () => {
      const result = await fetchRemoteImageAsAsset('https://blocked-cors.example.com/image.png');
      expect(result.success).toBe(false);
      expect(result.error).toContain('CORS');
    });
  });

  describe('handlePastedContent: 粘贴内容智能路由', () => {
    it('优先识别剪贴板中的文件', async () => {
      const mockFile = new File([new Uint8Array([1, 2])], 'test.png', { type: 'image/png' });
      const result = await handlePastedContent('https://example.com/pic.png', [mockFile]);
      expect(result.type).toBe('files');
      if (result.type === 'files') {
        expect(result.files).toHaveLength(1);
      }
    });

    it('无文件且为图片链接时，转换为 image-url', async () => {
      const result = await handlePastedContent('https://example.com/image.png', []);
      expect(result.type).toBe('image-url');
      if (result.type === 'image-url') {
        expect(result.url).toBe('https://example.com/image.png');
        expect(result.markdown).toContain('![参考图片](https://example.com/image.png)');
      }
    });

    it('普通文本直接返回 text', async () => {
      const result = await handlePastedContent('这是一段普通的 Markdown 笔记', []);
      expect(result.type).toBe('text');
      if (result.type === 'text') {
        expect(result.text).toBe('这是一段普通的 Markdown 笔记');
      }
    });
  });

  describe('占位符生成与缺失资产防崩保护', () => {
    it('生成的占位符具有唯一性与格式契约', () => {
      const token1 = generatePlaceholderToken();
      const token2 = generatePlaceholderToken();
      expect(token1).not.toBe(token2);
      expect(token1).toMatch(/^placeholder_/);

      const placeholder = formatPlaceholder(token1, '处理中...');
      expect(placeholder).toBe(`![处理中...](${token1})`);
    });

    it('缺失资产查询时优雅返回空字符串，不产生崩溃', () => {
      const nonExistentUrl = assetBlobUrls.getUrl('sha256_non_existent');
      expect(nonExistentUrl).toBe('');
    });
  });
});
