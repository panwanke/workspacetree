import type { Root, Blockquote } from 'mdast';
import { visit } from 'unist-util-visit';

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

/**
 * remark 插件：识别 blockquote 中首个段落以 `[!type]` 开头的情况，
 * 将其标记为 callout 节点（注入 data.callout 属性），并调整首段文本。
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      if (!node.children || node.children.length === 0) return;
      const firstChild = node.children[0];
      if (
        firstChild?.type !== 'paragraph' ||
        !firstChild.children ||
        firstChild.children.length === 0
      ) {
        return;
      }
      const firstInline = firstChild.children[0];
      if (firstInline?.type !== 'text') return;

      const lines = firstInline.value.split(/\r?\n/);
      const firstLine = lines[0] ?? '';
      const meta = parseCalloutHeader(firstLine);
      if (!meta) return;

      // 标记为 callout
      (node as any).data = {
        ...(node as any).data,
        callout: meta,
      };

      // 调整首行：移除 `[!type] title`，保留后续行
      if (lines.length > 1) {
        firstInline.value = lines.slice(1).join('\n');
      } else {
        // 首行如果是这一段唯一的文本，并且没有其他内联节点，则移除整个首段
        if (firstChild.children.length === 1) {
          node.children.shift();
        } else {
          firstChild.children.shift();
        }
      }
    });
  };
}
