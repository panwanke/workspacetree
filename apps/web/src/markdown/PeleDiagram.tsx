import { useMemo, useState } from 'react';
import { render, PeleError, type RenderResult } from 'pele';

export interface PeleDiagramProps {
  code: string;
  className?: string;
  showToolbar?: boolean;
}

export function PeleDiagram({ code, className = '', showToolbar = true }: PeleDiagramProps) {
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const { result, error } = useMemo<{
    result: RenderResult | null;
    error: string | null;
  }>(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      return { result: null, error: '空白图表内容' };
    }
    try {
      const res = render(trimmed, {
        fontFamily:
          '"Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        responsive: true,
      });
      return { result: res, error: null };
    } catch (err: unknown) {
      if (err instanceof PeleError) {
        const lineInfo = err.line ? `第 ${err.line} 行` : '';
        const colInfo = err.column ? `第 ${err.column} 列` : '';
        const loc = [lineInfo, colInfo].filter(Boolean).join('，');
        const snippet = err.snippet ? `\n> ${err.snippet}` : '';
        return {
          result: null,
          error: `${err.message} (${loc || err.code})${snippet}`,
        };
      }
      return {
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback ignore
    }
  };

  if (error) {
    return (
      <div className={`wst-pele-container is-error nodrag nopan ${className}`}>
        <div className="wst-pele-toolbar">
          <span className="wst-pele-badge is-error">⚠️ Pele 语法错误</span>
          <button type="button" className="wst-pele-btn" onClick={() => setShowCode(!showCode)}>
            {showCode ? '隐藏代码' : '查看代码'}
          </button>
        </div>
        <div className="wst-pele-error-message">{error}</div>
        {showCode && (
          <pre className="wst-pele-raw-code">
            <code>{code}</code>
          </pre>
        )}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className={`wst-pele-container nodrag nopan ${className}`}>
      {showToolbar && (
        <div className="wst-pele-toolbar">
          <span className="wst-pele-badge" title="Pele Mermaid 渲染器">
            🌋 {result.type || 'pele'}
          </span>
          <div className="wst-pele-toolbar-actions">
            <button
              type="button"
              className="wst-pele-btn"
              onClick={handleCopy}
              title="复制 Mermaid 源码"
            >
              {copied ? '✓ 已复制' : '复制'}
            </button>
          </div>
        </div>
      )}
      <div className="wst-pele-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
    </div>
  );
}
