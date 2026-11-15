import { describe, expect, it } from 'vitest';
import { createDemoBranchFile } from '../../apps/web/src/demo.js';
import { extractAllImages } from '@workspacetree/markdown';
import { collectProjectTodos } from '../../apps/web/src/project-todos.js';
import { getNodeNote } from '../../apps/web/src/history.js';

describe('search & date directory multi-view extraction', () => {
  it('正确支持按标题和按 Markdown 正文检索节点并生成摘要片段', () => {
    const file = createDemoBranchFile();
    const domain = file.domain;

    // 1. 标题检索：检索「哲学」
    const titleQuery = '哲学';
    const titleMatches = domain.nodes.filter((node) =>
      node.title.toLowerCase().includes(titleQuery.toLowerCase()),
    );
    expect(titleMatches.length).toBeGreaterThan(0);
    expect(titleMatches.some((node) => node.id === 'n_layout_philosophy')).toBe(true);

    // 2. Markdown 检索：检索「工程之骨」
    const noteQuery = '工程之骨';
    const noteMatches: Array<{ nodeId: string; snippet: string }> = [];
    for (const node of domain.nodes) {
      const note = getNodeNote(domain, node.id);
      const idx = note.indexOf(noteQuery);
      if (idx !== -1) {
        const start = Math.max(0, idx - 15);
        const end = Math.min(note.length, idx + noteQuery.length + 15);
        const snippet =
          (start > 0 ? '...' : '') + note.slice(start, end) + (end < note.length ? '...' : '');
        noteMatches.push({ nodeId: node.id, snippet });
      }
    }

    expect(noteMatches.length).toBeGreaterThan(0);
    expect(noteMatches.some((m) => m.nodeId === 'n_layout_philosophy')).toBe(true);
    expect(noteMatches.some((m) => m.snippet.includes('工程之骨'))).toBe(true);
  });

  it('日期目录能从演示项目中抽取全部内嵌图片与资产', () => {
    const file = createDemoBranchFile();
    const domain = file.domain;
    const extractedImages: Array<{ nodeId: string; url: string; alt: string }> = [];

    for (const node of domain.nodes) {
      const note = getNodeNote(domain, node.id);
      if (!note) continue;
      const images = extractAllImages(note);
      for (const img of images) {
        extractedImages.push({
          nodeId: node.id,
          url: img.url,
          alt: img.alt,
        });
      }
    }

    expect(extractedImages.length).toBeGreaterThanOrEqual(1);
    expect(extractedImages.some((img) => img.nodeId === 'n_branch_ui')).toBe(true);
    expect(extractedImages.some((img) => img.alt === '交互渲染流水线')).toBe(true);
  });

  it('日期目录能正确提取并汇聚所有待办任务', () => {
    const file = createDemoBranchFile();
    const domain = file.domain;
    const groups = collectProjectTodos(domain);
    const allTodos = groups.flatMap((g) => g.items);

    expect(allTodos.length).toBeGreaterThan(0);
    expect(allTodos.some((t) => t.status === 'open' || t.status === 'done')).toBe(true);
  });
});
