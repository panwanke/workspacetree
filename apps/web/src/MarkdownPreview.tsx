import type { ReactNode } from 'react';
import { readMarkdownTodos, TODO_STATUS } from './markdown-todos';
import { TagList } from './TagList';

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

export function MarkdownPreview({
  markdown,
  className,
  maxLines,
}: {
  markdown: string;
  className: string;
  maxLines?: number;
}) {
  const lines = markdown.split(/\r?\n/).slice(0, maxLines);
  const todos = new Map(readMarkdownTodos(lines.join('\n')).map((item) => [item.lineIndex, item]));
  return (
    <div className={className}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
          const content = trimmed.replace(/^#{1,3}\s+/, '');
          return (
            <div key={index} className="wst-md-heading">
              {renderInlineMarkdown(content)}
            </div>
          );
        }
        const todo = todos.get(index);
        if (todo) {
          const { marker, label } = TODO_STATUS[todo.status];
          return (
            <div key={index} className={`wst-md-item is-${todo.status}`}>
              <span aria-label={label} title={label}>
                {marker}
              </span>{' '}
              <span className="wst-md-task-title">{renderInlineMarkdown(todo.title)}</span>
              <TagList tags={todo.tags} label="TODO 标签" />
              {todo.scheduledAt && (
                <time className="wst-todo-date" dateTime={todo.scheduledAt}>
                  {todo.scheduledAt}
                </time>
              )}
            </div>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={index} className="wst-md-item">
              • {renderInlineMarkdown(trimmed.slice(2))}
            </div>
          );
        }
        return (
          <div key={index} className="wst-md-line">
            {renderInlineMarkdown(trimmed)}
          </div>
        );
      })}
    </div>
  );
}
