import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
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
  livePreviewField,
  livePreviewPlugin,
  setSourceModeEffect,
  sourceModeState,
} from './live-preview.js';
import './markdown.css';

export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  sourceModeDefault?: boolean;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  autoFocus = true,
  placeholder = '输入 Markdown 笔记...',
  readOnly = false,
  sourceModeDefault = false,
  className = '',
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [sourceMode, setSourceMode] = useState(sourceModeDefault);

  useEffect(() => {
    if (!containerRef.current) return;

    const editorKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onSave?.();
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
        key: 'Mod-Shift-7',
        run: (view) => toggleUnorderedList(view),
      },
      {
        key: 'Mod-Shift-8',
        run: (view) => toggleOrderedList(view),
      },
      {
        key: 'Mod-Shift-9',
        run: (view) => toggleTaskList(view),
      },
      {
        key: 'Mod-Shift-Enter',
        run: (view) => toggleTaskCheck(view),
      },
      {
        key: 'Mod-Shift-c',
        run: (view) => insertCallout(view, 'note'),
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
        sourceModeState.init(() => sourceMode),
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
    <div className={`wst-markdown-editor-container ${className}`}>
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
            title="无序列表 (Ctrl/Cmd+Shift+7)"
            onClick={() => viewRef.current && toggleUnorderedList(viewRef.current)}
          >
            • 列表
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="数字列表 (Ctrl/Cmd+Shift+8)"
            onClick={() => viewRef.current && toggleOrderedList(viewRef.current)}
          >
            1. 列表
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="任务复选框 (Ctrl/Cmd+Shift+9)"
            onClick={() => viewRef.current && toggleTaskList(viewRef.current)}
          >
            ☑ 任务
          </button>
          <button
            type="button"
            className="wst-markdown-toolbar-btn"
            title="Callout 引用 (Ctrl/Cmd+Shift+C)"
            onClick={() => viewRef.current && insertCallout(viewRef.current, 'note')}
          >
            💡 提示
          </button>
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
          {onSave && (
            <button
              type="button"
              className="wst-markdown-toolbar-btn"
              title="保存笔记 (Ctrl/Cmd+Enter)"
              onClick={onSave}
            >
              保存
            </button>
          )}
          {onCancel && (
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
