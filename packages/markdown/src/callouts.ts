import type { Blockquote, Definition, Paragraph, Root } from 'mdast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import { parseMarkdown } from './parse.js';

export type StandardCalloutType =
  'note' | 'info' | 'tip' | 'warning' | 'question' | 'success' | 'example';

export const STANDARD_CALLOUT_TYPES: readonly StandardCalloutType[] = [
  'note',
  'info',
  'tip',
  'warning',
  'question',
  'success',
  'example',
];

export interface CalloutMeta {
  type: string;
  normalizedType: string;
  isStandard: boolean;
  foldable: boolean;
  defaultFolded: boolean;
  title: string;
}

/**
 * 解析 Callout 标题行（如 `[!note]`, `[!warning]+ 注意`, `[!tip]- 折叠提示`）。
 */
export function parseCalloutHeader(text: string): CalloutMeta | null {
  const match = /^\[!([a-zA-Z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/.exec(text.trim());
  if (!match) return null;
  const rawType = match[1]!;
  const normalizedType = rawType.toLowerCase();
  const fold = match[2];
  const customTitle = match[3]?.trim();
  const isStandard = STANDARD_CALLOUT_TYPES.includes(normalizedType as StandardCalloutType);
  const defaultTitle = isStandard
    ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)
    : rawType;

  return {
    type: rawType,
    normalizedType,
    isStandard,
    foldable: fold === '+' || fold === '-',
    defaultFolded: fold === '-',
    title: customTitle || defaultTitle,
  };
}

/**
 * 包装为 Callout 语法行：`> [!note] 标题` 或带折叠标志 `> [!note]+ 标题`
 */
export function formatCalloutHeader(type: string, title?: string, fold?: '+' | '-' | null): string {
  const foldStr = fold ? fold : '';
  const titleStr = title?.trim() ? ` ${title.trim()}` : '';
  return `> [!${type}]${foldStr}${titleStr}`;
}

function findCallouts(tree: Root, markdown: string, includeNested: boolean) {
  const lines = markdown.split(/\r\n?|\n/);
  const matches: { node: Blockquote; paragraph: Paragraph; line: number; meta: CalloutMeta }[] = [];
  visit(tree, 'blockquote', (node) => {
    const paragraph = node.children[0];
    if (paragraph?.type !== 'paragraph' || !paragraph.position) return;
    const { line, column } = paragraph.position.start;
    const header = lines[line - 1]?.slice(column - 1) ?? '';
    const meta = parseCalloutHeader(header);
    if (!meta) return;
    matches.push({ node, paragraph, line, meta });
    if (!includeNested) return SKIP;
  });
  return matches;
}

export function countMarkdownCallouts(markdown: string): number {
  if (!markdown.includes('[!')) return 0;
  return findCallouts(parseMarkdown(markdown), markdown, false).length;
}

export const remarkCallouts: Plugin<[{ onlyCallouts?: boolean }?], Root> =
  (options) => (tree, file) => {
    const markdown = String(file);
    if (!markdown.includes('[!')) {
      if (options?.onlyCallouts) tree.children = [];
      return;
    }

    const visible = options?.onlyCallouts ? findCallouts(tree, markdown, false) : undefined;
    for (const { node, paragraph, line, meta } of findCallouts(tree, markdown, true)) {
      node.data = Object.assign(node.data ?? {}, {
        callout: meta,
        hProperties: {
          dataCalloutType: meta.normalizedType,
          dataCalloutTitle: meta.title,
        },
      });
      paragraph.children = paragraph.children.filter((part) => {
        if (!part.position || part.position.start.line > line) return true;
        if (part.type !== 'text' || part.position.end.line <= line) return false;
        part.value = part.value.replace(/^[^\r\n]*\r?\n/, '');
        return part.value.length > 0;
      });
      if (!paragraph.children.length) node.children.shift();
    }

    if (visible) {
      const definitions: Definition[] = [];
      visit(tree, 'definition', (node) => {
        definitions.push(node);
      });
      tree.children = [...visible.map(({ node }) => node), ...definitions];
    }
  };
