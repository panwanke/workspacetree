import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainState, Node } from '@workspacetree/schema';
import { getNodeNote } from './history';
import { WorkspaceIcon } from './WorkspaceIcon';

interface SearchResultItem {
  node: Node;
  matchedInTitle: boolean;
  matchedInNote: boolean;
  snippet?: string;
}

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  domain: DomainState;
  onSelectNode: (nodeId: string) => void;
}

export default function SearchModal({ open, onClose, domain, onSelectNode }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [includeMarkdown, setIncludeMarkdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [open]);

  const results: SearchResultItem[] = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const list: SearchResultItem[] = [];

    for (const node of domain.nodes) {
      const title = node.title || '未命名节点';
      const note = getNodeNote(domain, node.id);

      if (!q) {
        // 初始未输入时按节点出现顺序展示全部
        list.push({
          node,
          matchedInTitle: true,
          matchedInNote: false,
        });
        continue;
      }

      const inTitle = title.toLowerCase().includes(q);
      const noteLower = note.toLowerCase();
      const noteIdx = includeMarkdown ? noteLower.indexOf(q) : -1;
      const inNote = noteIdx !== -1;

      if (inTitle || inNote) {
        let snippet: string | undefined;
        if (inNote) {
          const start = Math.max(0, noteIdx - 20);
          const end = Math.min(note.length, noteIdx + q.length + 32);
          const prefix = start > 0 ? '...' : '';
          const suffix = end < note.length ? '...' : '';
          snippet = prefix + note.slice(start, end).replace(/\s+/g, ' ') + suffix;
        }
        list.push({
          node,
          matchedInTitle: inTitle,
          matchedInNote: inNote,
          snippet,
        });
      }
    }
    return list;
  }, [open, query, includeMarkdown, domain]);

  // 当搜索结果发生变动时重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, includeMarkdown]);

  // 保证选中项在可视区域内
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector<HTMLElement>('.wst-search-item.is-selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!open) return null;

  function commitSelect(nodeId: string) {
    onSelectNode(nodeId);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        commitSelect(results[selectedIndex].node.id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function renderHighlightedText(text: string, highlight: string) {
    if (!highlight.trim()) return text;
    const q = highlight.trim().toLowerCase();
    const parts: React.ReactNode[] = [];
    let cur = text;
    let key = 0;

    while (cur) {
      const idx = cur.toLowerCase().indexOf(q);
      if (idx === -1) {
        parts.push(cur);
        break;
      }
      if (idx > 0) {
        parts.push(cur.slice(0, idx));
      }
      parts.push(
        <mark key={key++} className="wst-search-mark">
          {cur.slice(idx, idx + q.length)}
        </mark>,
      );
      cur = cur.slice(idx + q.length);
    }
    return parts;
  }

  return (
    <div
      className="wst-modal-backdrop wst-search-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="搜索项目节点"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wst-search-modal" onKeyDown={handleKeyDown}>
        {/* 顶部搜索输入栏 */}
        <div className="wst-search-header">
          <span className="wst-search-icon" aria-hidden="true">
            <WorkspaceIcon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            className="wst-search-input"
            type="text"
            value={query}
            placeholder="搜索节点标题... (支持键盘上下键切换，按 Enter 直达)"
            aria-label="搜索关键词"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="wst-search-clear-btn"
              title="清空"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            className="wst-tool is-icon wst-search-close"
            title="关闭搜索 (Esc)"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        {/* 检索范围与计数状态栏 */}
        <div className="wst-search-toolbar">
          <label className="wst-search-scope-toggle">
            <input
              type="checkbox"
              checked={includeMarkdown}
              onChange={(e) => setIncludeMarkdown(e.target.checked)}
            />
            <span>同时检索 Markdown 笔记正文</span>
          </label>
          <span className="wst-search-count">
            {query.trim()
              ? `找到 ${results.length} 个匹配节点`
              : `共 ${domain.nodes.length} 个节点`}
          </span>
        </div>

        {/* 搜索结果列表 */}
        <div className="wst-search-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="wst-search-empty">
              <p>未找到包含「{query}」的节点</p>
              <span className="wst-search-empty-hint">
                提示：可尝试勾选上方「同时检索 Markdown 笔记正文」扩大搜索范围
              </span>
            </div>
          ) : (
            results.map((item, index) => {
              const isSelected = index === selectedIndex;
              const titleText = item.node.title || '未命名节点';
              return (
                <div
                  key={item.node.id}
                  className={`wst-search-item${isSelected ? ' is-selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => commitSelect(item.node.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="wst-search-item-main">
                    <div className="wst-search-item-title">
                      <span className="wst-search-node-icon" aria-hidden="true">
                        <WorkspaceIcon name="tree" size={14} />
                      </span>
                      <span className="wst-search-title-text">
                        {renderHighlightedText(titleText, query)}
                      </span>
                    </div>
                    {item.snippet && (
                      <div className="wst-search-snippet">
                        <span className="wst-search-snippet-label">笔记匹配：</span>
                        <span>{renderHighlightedText(item.snippet, query)}</span>
                      </div>
                    )}
                  </div>
                  <div className="wst-search-item-meta">
                    {item.node.startAt && (
                      <span className="wst-search-date-pill">{item.node.startAt}</span>
                    )}
                    {item.node.tags && item.node.tags.length > 0 && (
                      <span className="wst-search-tag-pill">
                        #{item.node.tags[0]}
                        {item.node.tags.length > 1 ? ` +${item.node.tags.length - 1}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部按键指引 */}
        <div className="wst-search-footer">
          <div className="wst-search-hints">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> 切换选中
            </span>
            <span>
              <kbd>Enter</kbd> 定位到画布
            </span>
            <span>
              <kbd>Esc</kbd> 关闭
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
