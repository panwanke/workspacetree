import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { render, PeleError } from 'pele';
import { insertPeleDiagram, type CommandTarget } from '../../apps/web/src/markdown/commands';
import {
  livePreviewField,
  PeleWidget,
  setSourceModeEffect,
  sourceModeState,
} from '../../apps/web/src/markdown/live-preview';

function createTestTarget(
  doc: string,
  selection?: { from: number; to: number },
): CommandTarget & { docString: () => string; state: EditorState } {
  let state = EditorState.create({
    doc,
    selection: selection ? EditorSelection.single(selection.from, selection.to) : undefined,
    extensions: [markdown({ base: markdownLanguage }), sourceModeState, livePreviewField],
  });
  return {
    get state() {
      return state;
    },
    dispatch(tr: TransactionSpec) {
      state = state.update(tr).state;
    },
    docString() {
      return state.doc.toString();
    },
  };
}

describe('Pele / Mermaid 图表集成测试 (tests/web/pele-diagram.test.ts)', () => {
  describe('Pele 核心渲染与错误模型', () => {
    it('正确解析并渲染基础流程图为有效 SVG 字符串', () => {
      const code = 'flowchart TD\n  A[开始] --> B[结束]';
      const result = render(code, {
        fontFamily: '"Microsoft YaHei", sans-serif',
        responsive: true,
      });
      expect(result).toBeDefined();
      expect(result.type).toBe('flowchart');
      expect(result.svg).toContain('<svg');
      expect(result.svg).toContain('</svg>');
      expect(result.svg).toContain('开始');
      expect(result.svg).toContain('结束');
    });

    it('非法或破损的 Mermaid 代码抛出可识别的 PeleError', () => {
      const brokenCode = 'flowchart TD\n  A --> [无效语法缺少节点名';
      let caughtError: unknown = null;
      try {
        render(brokenCode);
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(PeleError);
      const peleErr = caughtError as PeleError;
      expect(peleErr.message).toBeDefined();
      expect(peleErr.line).toBeGreaterThanOrEqual(1);
    });
  });

  describe('insertPeleDiagram 编辑器命令', () => {
    it('在空行直接插入 Mermaid 模板代码', () => {
      const target = createTestTarget('', { from: 0, to: 0 });
      expect(insertPeleDiagram(target)).toBe(true);
      const doc = target.docString();
      expect(doc).toContain('```mermaid\nflowchart TD');
      expect(doc).toContain('A[开始] --> B{判定?}');
      expect(doc).toContain('```\n');
    });

    it('在非空行追加换行后插入 Mermaid 模板代码', () => {
      const target = createTestTarget('已有正文内容', { from: 6, to: 6 });
      expect(insertPeleDiagram(target)).toBe(true);
      const doc = target.docString();
      expect(doc.startsWith('已有正文内容\n```mermaid')).toBe(true);
    });
  });

  describe('实时预览装饰 (Live Preview)', () => {
    it('光标在图表块外部时，折叠为 PeleWidget 替换装饰', () => {
      const doc = '# 标题\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n正文结尾';
      // 光标放在文章末尾（远离图表块）
      const target = createTestTarget(doc, { from: doc.length, to: doc.length });
      const decos = target.state.field(livePreviewField);

      let foundPeleWidget: PeleWidget | null = null;
      decos.between(0, doc.length, (_from, _to, value) => {
        const widget = (value.spec as any)?.widget;
        if (widget instanceof PeleWidget) {
          foundPeleWidget = widget;
        }
      });

      expect(foundPeleWidget).not.toBeNull();
      const widget = foundPeleWidget as unknown as PeleWidget;
      expect(widget.code.trim()).toBe('flowchart TD\n  A --> B');
    });

    it('支持 ```pele 代码围栏语法', () => {
      const doc = '```pele\nsequenceDiagram\n  Alice->>Bob: Hello\n```';
      const docWithTail = `${doc}\n尾部文本`;
      const target = createTestTarget(docWithTail, {
        from: docWithTail.length,
        to: docWithTail.length,
      });
      const decos = target.state.field(livePreviewField);

      let foundPeleWidget: PeleWidget | null = null;
      decos.between(0, docWithTail.length, (_from, _to, value) => {
        const widget = (value.spec as any)?.widget;
        if (widget instanceof PeleWidget) {
          foundPeleWidget = widget;
        }
      });

      expect(foundPeleWidget).not.toBeNull();
      const widget = foundPeleWidget as unknown as PeleWidget;
      expect(widget.code.trim()).toBe('sequenceDiagram\n  Alice->>Bob: Hello');
    });

    it('光标进入图表块内部时，展开显示原始源码（不进行 Widget 替换）', () => {
      const doc = '# 标题\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n正文结尾';
      const insidePos = doc.indexOf('flowchart TD') + 2;
      const target = createTestTarget(doc, { from: insidePos, to: insidePos });
      const decos = target.state.field(livePreviewField);

      let foundPeleWidget = false;
      decos.between(0, doc.length, (_from, _to, value) => {
        const widget = (value.spec as any)?.widget;
        if (widget instanceof PeleWidget) {
          foundPeleWidget = true;
        }
      });

      // 光标在代码块内部，不应该渲染为 PeleWidget 替换装饰
      expect(foundPeleWidget).toBe(false);
    });

    it('源码模式下不生成图表预览装饰', () => {
      const doc = '```mermaid\nflowchart TD\n  A --> B\n```\n尾部';
      const target = createTestTarget(doc, { from: doc.length, to: doc.length });

      target.dispatch({ effects: setSourceModeEffect.of(true) });
      const decos = target.state.field(livePreviewField);
      expect(decos.size).toBe(0);
    });
  });
});
