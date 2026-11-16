import { useLayoutEffect } from 'react';

export function createMarkdownStyleSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  // Insert a single rule so extra top-level rules cannot escape the Markdown scope.
  sheet.insertRule(`@scope (.wst-markdown-preview, .wst-markdown-editor-container) {\n${css}\n}`);
  return sheet;
}

export function useMarkdownCss(css: string): void {
  useLayoutEffect(() => {
    if (!css.trim()) return;
    let sheet: CSSStyleSheet;
    try {
      sheet = createMarkdownStyleSheet(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      return;
    }
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
    };
  }, [css]);
}
