import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainState } from '@workspacetree/schema';
import { relationLabels } from './ConnectionDialog';
import { searchWorkspace, type WorkspaceSearchResult } from './search';
import { WorkspaceIcon } from './WorkspaceIcon';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  domain: DomainState;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

export default function SearchModal({
  open,
  onClose,
  domain,
  onSelectNode,
  onSelectEdge,
}: SearchModalProps) {
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

  const results = useMemo(
    () => (open ? searchWorkspace(domain, query, includeMarkdown) : []),
    [open, query, includeMarkdown, domain],
  );
  const nodeCount = results.filter((item) => item.kind === 'node').length;
  const edgeCount = results.length - nodeCount;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, includeMarkdown]);

  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector<HTMLElement>('.wst-search-item.is-selected');
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  function commitSelect(item: WorkspaceSearchResult): void {
    if (item.kind === 'node') onSelectNode(item.id);
    else onSelectEdge(item.edge.id);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((previous) => (results.length > 0 ? (previous + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((previous) =>
        results.length > 0 ? (previous - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[selectedIndex];
      if (item) commitSelect(item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  function renderHighlightedText(text: string, highlight: string): React.ReactNode {
    if (!highlight.trim()) return text;
    const q = highlight.trim().toLowerCase();
    const parts: React.ReactNode[] = [];
    let current = text;
    let key = 0;
    while (current) {
      const index = current.toLowerCase().indexOf(q);
      if (index === -1) {
        parts.push(current);
        break;
      }
      if (index > 0) parts.push(current.slice(0, index));
      parts.push(
        <mark key={key++} className="wst-search-mark">
          {current.slice(index, index + q.length)}
        </mark>,
      );
      current = current.slice(index + q.length);
    }
    return parts;
  }

  return (
    <div
      className="wst-modal-backdrop wst-search-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="搜索项目节点与连线"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wst-search-modal" onKeyDown={handleKeyDown}>
        <div className="wst-search-header">
          <span className="wst-search-icon" aria-hidden="true">
            <WorkspaceIcon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            className="wst-search-input"
            type="text"
            value={query}
            placeholder="搜索节点标题或连线备注... (支持键盘上下键切换，按 Enter 直达)"
            aria-label="搜索关键词"
            onChange={(event) => setQuery(event.target.value)}
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

        <div className="wst-search-toolbar">
          <label className="wst-search-scope-toggle">
            <input
              type="checkbox"
              checked={includeMarkdown}
              onChange={(event) => setIncludeMarkdown(event.target.checked)}
            />
            <span>同时检索 Markdown 笔记正文</span>
          </label>
          <span className="wst-search-count">
            {query.trim()
              ? `找到 ${nodeCount} 个节点、${edgeCount} 条连线`
              : `共 ${domain.nodes.length} 个节点`}
          </span>
        </div>

        <div className="wst-search-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="wst-search-empty">
              <p>未找到包含「{query}」的节点或连线</p>
              <span className="wst-search-empty-hint">
                提示：可勾选「同时检索 Markdown 笔记正文」扩大节点搜索范围
              </span>
            </div>
          ) : (
            results.map((item, index) => {
              const isSelected = index === selectedIndex;
              if (item.kind === 'edge') {
                return (
                  <div
                    key={`edge-${item.id}`}
                    className={`wst-search-item${isSelected ? ' is-selected' : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => commitSelect(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="wst-search-item-main">
                      <div className="wst-search-item-title">
                        <span className="wst-search-node-icon" aria-hidden="true">
                          <WorkspaceIcon name="arrow" size={14} />
                        </span>
                        <span className="wst-search-title-text">
                          {relationLabels[item.edge.type]} · {item.fromTitle} → {item.toTitle}
                        </span>
                      </div>
                      <div className="wst-search-snippet">
                        <span className="wst-search-snippet-label">连线备注：</span>
                        <span>{renderHighlightedText(item.snippet, query)}</span>
                      </div>
                    </div>
                    <div className="wst-search-item-meta">
                      <span className="wst-search-tag-pill">连线</span>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={`node-${item.id}`}
                  className={`wst-search-item${isSelected ? ' is-selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => commitSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="wst-search-item-main">
                    <div className="wst-search-item-title">
                      <span className="wst-search-node-icon" aria-hidden="true">
                        <WorkspaceIcon name="tree" size={14} />
                      </span>
                      <span className="wst-search-title-text">
                        {renderHighlightedText(item.title, query)}
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
                    {item.matchedInTitle && <span className="wst-search-tag-pill">标题</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>

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
