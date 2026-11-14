import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseCalloutHeader, parseImageMeta } from '@workspacetree/markdown';
import type { AssetRecord } from '@workspacetree/schema';
import { assetBlobUrls } from './images/image-assets.js';
import './markdown/markdown.css';

export function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(!\[[^\]]*\]\([^)]+\)|\{color:[^}]+\}[\s\S]*?\{\/color\}|==[^=]+==|\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('![')) {
      const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      if (imgMatch) {
        parts.push(
          <img
            key={key++}
            className="wst-md-img"
            src={imgMatch[2]}
            alt={imgMatch[1] || '插图'}
            loading="lazy"
          />,
        );
      }
    } else if (token.startsWith('{color:')) {
      const colorMatch = /^\{color:([^}]+)\}([\s\S]*)\{\/color\}$/.exec(token);
      if (colorMatch) {
        parts.push(
          <span key={key++} style={{ color: colorMatch[1], fontWeight: 600 }}>
            {colorMatch[2]}
          </span>,
        );
      }
    } else if (token.startsWith('==')) {
      parts.push(
        <mark key={key++} className="wst-md-mark">
          {token.slice(2, -2)}
        </mark>,
      );
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{renderInlineMarkdown(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function trimMarkdownSafely(markdown: string, maxLines?: number): string {
  if (!maxLines) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (lines.length <= maxLines) return markdown;

  let inCode = false;
  let inCallout = false;
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCode = !inCode;
    }
    if (/^>\s*\[!/.test(line.trim())) {
      inCallout = true;
    } else if (inCallout && !line.startsWith('>')) {
      inCallout = false;
    }

    result.push(line);
    if (result.length >= maxLines && !inCode && !inCallout) {
      break;
    }
  }
  return result.join('\n');
}

export interface MarkdownPreviewProps {
  markdown: string;
  assets?: Record<string, AssetRecord>;
  className?: string;
  maxLines?: number;
}

export function MarkdownPreview({
  markdown,
  assets,
  className = '',
  maxLines,
}: MarkdownPreviewProps) {
  const content = trimMarkdownSafely(markdown, maxLines);

  return (
    <div className={`wst-markdown-preview ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote({ children }) {
            // 提取首行判断是否为 Callout
            const childrenArray = Array.isArray(children) ? children : [children];
            const firstPara = childrenArray[0];
            let calloutHeader: ReturnType<typeof parseCalloutHeader> = null;

            if (firstPara && typeof firstPara === 'object' && 'props' in firstPara) {
              const paraChildren = (firstPara as any).props?.children;
              const firstText = Array.isArray(paraChildren) ? paraChildren[0] : paraChildren;
              if (typeof firstText === 'string') {
                calloutHeader = parseCalloutHeader(firstText);
              }
            }

            if (calloutHeader) {
              return (
                <div className={`wst-callout is-${calloutHeader.normalizedType}`}>
                  <div className="wst-callout-title">
                    <span className="wst-callout-icon">💡</span>
                    <span>{calloutHeader.title}</span>
                  </div>
                  <div className="wst-callout-content">{children}</div>
                </div>
              );
            }

            return <blockquote>{children}</blockquote>;
          },
          img({ src, alt }) {
            if (!src) return null;
            const meta = parseImageMeta(alt || '', src);
            const resolvedUrl =
              meta.isAsset && meta.assetId
                ? assetBlobUrls.getUrl(meta.assetId, assets?.[meta.assetId])
                : meta.url;

            if (meta.isAsset && (!resolvedUrl || resolvedUrl === '')) {
              return (
                <div className="wst-md-img-missing" title={meta.url}>
                  ⚠️ 缺失图片资产 ({meta.url})
                </div>
              );
            }

            const style = meta.widthPercent ? { width: `${meta.widthPercent}%` } : undefined;
            return (
              <img
                src={resolvedUrl || meta.url}
                alt={meta.alt}
                style={style}
                className="wst-md-img"
                loading="lazy"
              />
            );
          },
          input({ type, checked }) {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="wst-md-checkbox"
                />
              );
            }
            return <input type={type} />;
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
