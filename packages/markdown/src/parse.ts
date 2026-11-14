import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';

export function createMarkdownProcessor() {
  return unified().use(remarkParse).use(remarkGfm);
}

export function parseMarkdown(markdown: string): Root {
  return createMarkdownProcessor().parse(markdown) as Root;
}

export interface CodeBlockRange {
  startLine: number; // 1-based
  endLine: number; // 1-based
}

/**
 * 获取所有代码块（fenced 或 indented）的起止行范围（1-based）。
 * 用于避免在代码块内部匹配 TODO 或其他扩展语法。
 */
export function getCodeBlockRanges(ast: Root): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  visit(ast, 'code', (node: Code) => {
    if (node.position) {
      ranges.push({
        startLine: node.position.start.line,
        endLine: node.position.end.line,
      });
    }
  });
  return ranges;
}

export function isLineInCodeBlock(line1Based: number, codeRanges: CodeBlockRange[]): boolean {
  return codeRanges.some((r) => line1Based >= r.startLine && line1Based <= r.endLine);
}
