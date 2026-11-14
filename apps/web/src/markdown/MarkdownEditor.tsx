import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { AssetRecord } from '@workspacetree/schema';
import {
  handleListEnter,
  insertCallout,
  insertLink,
  toggleBold,
  toggleItalic,
  toggleOrderedList,
  toggleTaskCheck,
  toggleTaskList,
  toggleUnorderedList,
} from './commands.js';
import {
  assetsFacet,
  livePreviewField,
  livePreviewPlugin,
  setSourceModeEffect,
  sourceModeState,
} from './live-preview.js';
import {
  extractFilesFromClipboard,
  extractFilesFromDrop,
  formatPlaceholder,
  generatePlaceholderToken,
  handlePastedContent,
  processFileToAsset,
} from '../images/image-input.js';
import './markdown.css';

export interface MarkdownEditorProps {
  value: string;
  assets?: Record<string, AssetRecord>;
  onChange?: (value: string) => void;
  onSave?: (newAssets?: Record<string, AssetRecord>) => void;
  onCancel?: () => void;
  onAssetsChange?: (assets: Record<string, AssetRecord>) => void;
  autoFocus?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  sourceModeDefault?: boolean;
  showToolbarActions?: boolean;
  className?: string;
}

export function MarkdownEditor({
  value,
  assets,
  onChange,
  onSave,
  onCancel,
  onAssetsChange,
  autoFocus = true,
  placeholder = '输入 Markdown 笔记...',
  readOnly = false,
  sourceModeDefault = false,
  showToolbarActions = false,
  className = '',
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newAssetsRef = useRef<Record<string, AssetRecord>>({});
  const [sourceMode, setSourceMode] = useState(sourceModeDefault);

  const insertFiles = async (files: File[]) => {
    if (!viewRef.current || files.length === 0) return;
    const view = viewRef.current;

    for (const file of files) {
      const token = generatePlaceholderToken();
      const placeholder = `\n${formatPlaceholder(token, `处理图片: ${file.name}...`)}\n`;
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: placeholder },
        selection: { anchor: sel.from + placeholder.length },
      });

      try {
        const { id, record, markdown } = await processFileToAsset(file);
        newAssetsRef.current[id] = record;
        onAssetsChange?.(newAssetsRef.current);

        const currentDoc = view.state.doc.toString();
        const tokenIdx = currentDoc.indexOf(token);
        if (tokenIdx !== -1) {
          const lineStart = currentDoc.lastIndexOf('\n', tokenIdx);
          const lineEnd = currentDoc.indexOf('\n', tokenIdx);
          const from = lineStart === -1 ? 0 : lineStart + 1;
          const to = lineEnd === -1 ? currentDoc.length : lineEnd;
          view.dispatch({
            changes: { from, to, insert: markdown },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '图片处理失败';
        const currentDoc = view.state.doc.toString();
        const tokenIdx = currentDoc.indexOf(token);
        if (tokenIdx !== -1) {
          const lineStart = currentDoc.lastIndexOf('\n', tokenIdx);
          const lineEnd = currentDoc.indexOf('\n', tokenIdx);
          const from = lineStart === -1 ? 0 : lineStart + 1;
          const to = lineEnd === -1 ? currentDoc.length : lineEnd;
          view.dispatch({
            changes: { from, to, insert: `> [!warning] ${errMsg}` },
          });
        }
      }
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const files = extractFilesFromClipboard(event.nativeEvent);
    if (files.length > 0) {
      event.preventDefault();
      await insertFiles(files);
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) {
      const result = await handlePastedContent(text, []);
      if (result.type === 'image-url') {
        event.preventDefault();
        if (viewRef.current) {
          const view = viewRef.current;
          const sel = view.state.selection.main;
          const insertText = `\n${result.markdown}\n`;
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: insertText },
            selection: { anchor: sel.from + insertText.length },
          });
        }
      }
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    const files = extractFilesFromDrop(event.nativeEvent);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      await insertFiles(files);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const editorKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onSave?.(newAssetsRef.current);
          return true;
        },
      },
      {
        key: 'Escape',
        run: () => {
          onCancel?.();
          return true;
        },
      },
      {
        key: 'Mod-b',
        run: (view) => toggleBold(view),
      },
      {
        key: 'Mod-i',
        run: (view) => toggleItalic(view),
      },
      {
        key: 'Mod-k',
        run: (view) => insertLink(view),
      },
      {
        key: 'Alt-1',
        run: (view) => toggleUnorderedList(view),
      },
      {
        key: 'Mod-Shift-7',
        run: (view) => toggleUnorderedList(view),
      },
      {
        key: 'Alt-2',
        run: (view) => toggleOrderedList(view),
      },
      {
        key: 'Mod-Shift-8',
        run: (view) => toggleOrderedList(view),
      },
      {
        key: 'Alt-3',
        run: (view) => toggleTaskList(view),
      },
      {
        key: 'Mod-Shift-9',
        run: (view) => toggleTaskList(view),
      },
      {
        key: 'Alt-4',
        run: (view) => insertCallout(view, 'note'),
      },
      {
        key: 'Mod-Shift-c',
        run: (view) => insertCallout(view, 'note'),
      },
      {
        key: 'Mod-Shift-Enter',
        run: (view) => toggleTaskCheck(view),
      },
      {
        key: 'Enter',
        run: (view) => handleListEnter(view),
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        editorKeymap,
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        sourceModeState.init(() => sourceMode),
        assetsFacet.of({ ...assets, ...newAssetsRef.current }),
        livePreviewField,
        livePreviewPlugin,
        cmPlaceholder(placeholder),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange?.(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 切换源码模式
  const handleToggleSourceMode = () => {
    const next = !sourceMode;
    setSourceMode(next);
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: setSourceModeEffect.of(next),
      });
    }
  };

  return (
    <div
      className={`wst-markdown-editor-container ${className}`}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="wst-markdown-toolbar">
        <div className="wst-markdown-toolbar-tools">
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="粗体 (Ctrl/Cmd+B)"
            onClick={() => viewRef.current && toggleBold(viewRef.current)}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="斜体 (Ctrl/Cmd+I)"
            onClick={() => viewRef.current && toggleItalic(viewRef.current)}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="链接 (Ctrl/Cmd+K)"
            onClick={() => viewRef.current && insertLink(viewRef.current)}
          >
            🔗
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="无序列表 (Alt+1)"
            onClick={() => viewRef.current && toggleUnorderedList(viewRef.current)}
          >
            •
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="有序列表 (Alt+2)"
            onClick={() => viewRef.current && toggleOrderedList(viewRef.current)}
          >
            1.
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="任务列表 (Alt+3)"
            onClick={() => viewRef.current && toggleTaskList(viewRef.current)}
          >
            ☑
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="Callout 引用 (Alt+4)"
            onClick={() => viewRef.current && insertCallout(viewRef.current, 'note')}
          >
            💡
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="插入图片 (支持粘贴与拖放)"
            onClick={() => fileInputRef.current?.click()}
          >
            📷
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) {
                insertFiles(files);
              }
              e.target.value = '';
            }}
          />
        </div>
        <div className="wst-markdown-toolbar-actions">
          <button
            type="button"
            className={`wst-markdown-toolbar-btn ${sourceMode ? 'is-active' : ''}`}
            title="切换源码模式 / 实时预览"
            onClick={handleToggleSourceMode}
          >
            {sourceMode ? '预览' : '源码'}
          </button>
          {showToolbarActions && onSave && (
            <button
              type="button"
              className="wst-markdown-toolbar-btn"
              title="保存笔记 (Ctrl/Cmd+Enter)"
              onClick={() => onSave(newAssetsRef.current)}
            >
              保存
            </button>
          )}
          {showToolbarActions && onCancel && (
            <button
              type="button"
              className="wst-markdown-toolbar-btn"
              title="取消编辑 (Esc)"
              onClick={onCancel}
            >
              取消
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="wst-cm-editor-view" />
    </div>
  );
}
