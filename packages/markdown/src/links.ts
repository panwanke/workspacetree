import type { Root, PhrasingContent } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export type LinkType = 'url' | 'md' | 'folder' | 'generic';

/**
 * 分类内嵌链接类型：
 * - 'url': 网页链接 (http://, https://, //, www.)
 * - 'md': Markdown 文档 (.md, .markdown, obsidian://, vscode:// 指向 md)
 * - 'folder': 文件夹路径 (file:/// 目录, Windows 盘符目录, 相对目录, 以 / 或 \ 结尾的路径)
 * - 'generic': 其他文件/协议 (如 mailto:, pdf, png 等)
 */
export function classifyLink(rawHref: string): LinkType {
  if (!rawHref) return 'generic';
  const href = rawHref.trim();

  // 提取纯净路径（去除 query 与 fragment）
  const [clean] = href.split(/[?#]/);
  const lowerClean = clean.toLowerCase();

  // 1. Markdown 文档判定
  if (
    /\.(md|markdown|mdown|mkd)$/i.test(lowerClean) ||
    /^obsidian:\/\//i.test(href) ||
    /^vscode:\/\/file\/.*?\.(md|markdown|mdown|mkd)$/i.test(lowerClean)
  ) {
    return 'md';
  }

  // 2. 文件夹目录判定
  // - GitHub 仓库在线目录路径 (https://github.com/.../tree/...)
  // - 本地绝对目录路径无文件扩展名 (file:///..., D:/..., C:\...)
  // - 本地相对目录路径（以 / 或 \ 结尾，或无文件扩展名）
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/tree\//i.test(href)) {
    return 'folder';
  }

  const isLocalOrFileScheme =
    /^(file:\/\/\/|[a-zA-Z]:[\\/])/i.test(clean) || /^vscode:\/\/file\//i.test(clean);

  if (isLocalOrFileScheme) {
    const lastSegment = clean.split(/[/\\]/).filter(Boolean).pop() || '';
    const hasFileExtension = /\.[a-zA-Z0-9_-]{1,6}$/.test(lastSegment);
    if (!hasFileExtension) {
      return 'folder';
    }
  }

  if (!/^(https?:|\/\/|www\.)/i.test(href)) {
    if (lowerClean.endsWith('/') || lowerClean.endsWith('\\')) {
      return 'folder';
    }
    if (!clean.includes('.') && clean.includes('/')) {
      return 'folder';
    }
  }

  // 3. 网页链接判定 (http://, https://, //, www.)
  if (/^(https?:\/\/|\/\/|www\.)/i.test(href)) {
    return 'url';
  }

  return 'generic';
}

/**
 * 提取适合系统剪贴板与本地打开的本地绝对路径或标准路径
 */
export function extractLocalPath(rawHref: string): string {
  if (!rawHref) return '';
  let path = rawHref.trim();
  if (path.startsWith('file:///')) {
    path = decodeURIComponent(path.slice(8));
  } else if (path.startsWith('file://')) {
    path = decodeURIComponent(path.slice(7));
  } else if (path.startsWith('vscode://file/')) {
    path = decodeURIComponent(path.slice(14));
  }

  // 若为 Windows 盘符开头带正斜杠，规范为 Windows 标准反斜杠
  if (/^[a-zA-Z]:\//.test(path)) {
    path = path.replace(/\//g, '\\');
  }
  return path;
}

/**
 * 获取链接对应的建议图标名称
 */
export function getLinkIconName(type: LinkType): 'globe' | 'fileText' | 'folder' | 'externalLink' {
  switch (type) {
    case 'url':
      return 'globe';
    case 'md':
      return 'fileText';
    case 'folder':
      return 'folder';
    default:
      return 'externalLink';
  }
}

/**
 * 获取链接对应的操作提示文字
 */
export function getLinkActionLabel(type: LinkType, href: string): string {
  switch (type) {
    case 'url':
      return `在新标签页打开网页 (${href})`;
    case 'md':
      return `打开 Markdown 文档 (${href})`;
    case 'folder':
      return `打开文件夹 (${href})`;
    default:
      return `打开链接 (${href})`;
  }
}

const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Remark 插件：支持解析 `[[目标|显示文字]]` 或 `[[目标]]` 为标准 Markdown Link 节点
 */
export const remarkWikilinks: Plugin<[], Root> = () => (tree) => {
  visit(tree, (node: any) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const newChildren: PhrasingContent[] = [];
      for (const child of node.children) {
        if (child.type === 'text') {
          const text = child.value;
          let lastIndex = 0;
          let match: RegExpExecArray | null;
          WIKILINK_REGEX.lastIndex = 0;
          let found = false;

          while ((match = WIKILINK_REGEX.exec(text)) !== null) {
            found = true;
            if (match.index > lastIndex) {
              newChildren.push({
                type: 'text',
                value: text.slice(lastIndex, match.index),
              });
            }
            const target = match[1]!.trim();
            const label = match[2]?.trim() || target;
            newChildren.push({
              type: 'link',
              url: target,
              children: [{ type: 'text', value: label }],
            });
            lastIndex = WIKILINK_REGEX.lastIndex;
          }

          if (found) {
            if (lastIndex < text.length) {
              newChildren.push({
                type: 'text',
                value: text.slice(lastIndex),
              });
            }
          } else {
            newChildren.push(child);
          }
        } else {
          newChildren.push(child);
        }
      }
      node.children = newChildren;
    }
  });
};

export interface MarkdownLinkMeta {
  text: string;
  url: string;
  type: LinkType;
  raw: string;
}

/**
 * 跨全部 Markdown 正文提取所有标准内嵌链接与双链（自动过滤掉图片链接）
 */
export function extractAllLinks(markdown: string): MarkdownLinkMeta[] {
  if (!markdown) return [];
  const results: MarkdownLinkMeta[] = [];
  const seen = new Set<string>();

  // 1. 标准 Markdown 链接 [text](url)，负向零宽断言排除图片 ![alt](src)
  const standardLinkRegex = /(?<![!])\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = standardLinkRegex.exec(markdown)) !== null) {
    const text = match[1].trim();
    const url = match[2].trim();
    if (url.startsWith('asset:')) continue;
    const key = `${url}__${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({
        text: text || url,
        url,
        type: classifyLink(url),
        raw: match[0],
      });
    }
  }

  // 2. Wikilinks [[url|text]] 或 [[url]]
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  while ((match = wikilinkRegex.exec(markdown)) !== null) {
    const target = match[1].trim();
    const text = match[2]?.trim() || target;
    const key = `${target}__${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({
        text,
        url: target,
        type: classifyLink(target),
        raw: match[0],
      });
    }
  }

  return results;
}
