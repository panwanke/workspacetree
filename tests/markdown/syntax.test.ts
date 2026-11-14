import { describe, expect, it } from 'vitest';
import {
  readMarkdownTasks,
  toggleTaskOnLine,
  setTaskStatusOnLine,
  parseCalloutHeader,
  formatCalloutHeader,
  parseImageMeta,
  formatImageTag,
  extractAllImages,
  extractAssetIds,
} from '@workspacetree/markdown';

describe('Markdown 语法与任务解析 (packages/markdown)', () => {
  it('支持任务五态标记，大小写 X 均为已完成，并正确跳过代码围栏', () => {
    const md = [
      '- [ ] 未完成',
      '- [x] 已完成小写',
      '- [X] 已完成大写',
      '- [-] 废弃任务',
      '- [~] 停用任务',
      '- [?] 待定任务',
      '```markdown',
      '- [*] 围栏内不应被识别',
      '- [x] 围栏内不应被识别',
      '```',
      '普通文本中的 [x] 不应被识别',
    ].join('\n');

    const tasks = readMarkdownTasks(md);
    expect(tasks).toHaveLength(6);
    expect(tasks[0]).toMatchObject({ lineIndex: 0, status: 'open', marker: '[ ]', title: '未完成' });
    expect(tasks[1]).toMatchObject({ lineIndex: 1, status: 'done', marker: '[x]', title: '已完成小写' });
    expect(tasks[2]).toMatchObject({ lineIndex: 2, status: 'done', marker: '[x]', title: '已完成大写' });
    expect(tasks[3]).toMatchObject({ lineIndex: 3, status: 'discarded', marker: '[-]', title: '废弃任务' });
    expect(tasks[4]).toMatchObject({ lineIndex: 4, status: 'paused', marker: '[~]', title: '停用任务' });
    expect(tasks[5]).toMatchObject({ lineIndex: 5, status: 'pending', marker: '[?]', title: '待定任务' });
  });

  it('支持识别 Callout / 引用块内部的任务', () => {
    const md = [
      '> [!note] 备忘录',
      '> - [x] 块内已完成任务 #callout',
      '> - [~] 块内停用任务 📅 2026-11-20',
      '>> 1. [-] 嵌套引用内的废弃任务',
    ].join('\n');

    const tasks = readMarkdownTasks(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      lineIndex: 1,
      status: 'done',
      title: '块内已完成任务',
      tags: ['callout'],
    });
    expect(tasks[1]).toMatchObject({
      lineIndex: 2,
      status: 'paused',
      title: '块内停用任务',
      scheduledAt: '2026-11-20',
    });
    expect(tasks[2]).toMatchObject({
      lineIndex: 3,
      status: 'discarded',
      title: '嵌套引用内的废弃任务',
    });
  });

  it('支持纯标签任务、日期与混合内联元素', () => {
    const md = [
      '- [ ] #tagOnly',
      '- [x] 常规任务 #t1 #t2 📅 2026-12-01',
      '- [?] 包含 `代码` 与 [链接](https://example.com) 的待定任务 #qc',
    ].join('\n');

    const tasks = readMarkdownTasks(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({ lineIndex: 0, status: 'open', title: '', tags: ['tagOnly'] });
    expect(tasks[1]).toMatchObject({
      lineIndex: 1,
      status: 'done',
      title: '常规任务',
      tags: ['t1', 't2'],
      scheduledAt: '2026-12-01',
    });
    expect(tasks[2]).toMatchObject({
      lineIndex: 2,
      status: 'pending',
      title: '包含 `代码` 与 [链接](https://example.com) 的待定任务',
      tags: ['qc'],
    });
  });

  it('toggleTaskOnLine 在完成与未完成之间切换，setTaskStatusOnLine 支持直接切五态', () => {
    const md = '- [ ] 任务一\n- [x] 任务二\n- [-] 任务三';
    // 切换任务一（open -> done）
    const toggled1 = toggleTaskOnLine(md, 0);
    expect(toggled1.split('\n')[0]).toBe('- [x] 任务一');

    // 切换任务二（done -> open）
    const toggled2 = toggleTaskOnLine(md, 1);
    expect(toggled2.split('\n')[1]).toBe('- [ ] 任务二');

    // 直接设为 paused [~]
    const paused = setTaskStatusOnLine(md, 0, 'paused');
    expect(paused.split('\n')[0]).toBe('- [~] 任务一');

    // 直接设为 discarded [-]
    const discarded = setTaskStatusOnLine(md, 1, 'discarded');
    expect(discarded.split('\n')[1]).toBe('- [-] 任务二');
  });

  it('Callout 标题解析与格式化', () => {
    // 标准类型
    const note = parseCalloutHeader('[!note] 注意事项');
    expect(note).toEqual({
      type: 'note',
      normalizedType: 'note',
      isStandard: true,
      foldable: false,
      defaultFolded: false,
      title: '注意事项',
    });

    // 折叠展开标记
    const warningFold = parseCalloutHeader('[!warning]+ 展开提示');
    expect(warningFold).toEqual({
      type: 'warning',
      normalizedType: 'warning',
      isStandard: true,
      foldable: true,
      defaultFolded: false,
      title: '展开提示',
    });

    const tipFoldClosed = parseCalloutHeader('[!tip]- 折叠提示');
    expect(tipFoldClosed).toEqual({
      type: 'tip',
      normalizedType: 'tip',
      isStandard: true,
      foldable: true,
      defaultFolded: true,
      title: '折叠提示',
    });

    // 未知类型回退
    const custom = parseCalloutHeader('[!my-custom-callout]');
    expect(custom).toEqual({
      type: 'my-custom-callout',
      normalizedType: 'my-custom-callout',
      isStandard: false,
      foldable: false,
      defaultFolded: false,
      title: 'my-custom-callout',
    });

    // 格式化输出
    expect(formatCalloutHeader('note', '测试')).toBe('> [!note] 测试');
    expect(formatCalloutHeader('tip', '可折叠', '-')).toBe('> [!tip]- 可折叠');
  });

  it('图片语法解析、{width=X%} 扩展、Obsidian 像素兼容与资产提取', () => {
    // 扩展语法
    const img1 = parseImageMeta('实验图', 'asset:sha256_abcd1234', '{width=60%}');
    expect(img1).toEqual({
      alt: '实验图',
      url: 'asset:sha256_abcd1234',
      widthPercent: 60,
      pixelWidth: undefined,
      pixelHeight: undefined,
      isAsset: true,
      assetId: 'sha256_abcd1234',
    });

    // Obsidian 像素尺寸兼容
    const img2 = parseImageMeta('参考|400x300', 'https://example.com/demo.png');
    expect(img2).toEqual({
      alt: '参考',
      url: 'https://example.com/demo.png',
      widthPercent: undefined,
      pixelWidth: 400,
      pixelHeight: 300,
      isAsset: false,
      assetId: undefined,
    });

    // 格式化输出
    expect(formatImageTag({ alt: '图', url: 'https://img.com/a.jpg', widthPercent: 80 })).toBe(
      '![图](https://img.com/a.jpg){width=80%}',
    );

    // 提取整篇 Markdown 中的图片与资产 ID
    const content = [
      '# 实验记录',
      '![装置1](asset:sha256_1111){width=50%}',
      '一些文本说明',
      '![装置2](asset:sha256_2222)',
      '![外链](https://external.com/pic.png){width=100%}',
      '重复引用：![装置1副本](asset:sha256_1111)',
    ].join('\n');

    const allImages = extractAllImages(content);
    expect(allImages).toHaveLength(4);
    expect(extractAssetIds(content)).toEqual(['sha256_1111', 'sha256_2222']);
  });
});
