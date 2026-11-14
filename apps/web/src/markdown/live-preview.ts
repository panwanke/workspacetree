import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { parseCalloutHeader } from '@workspacetree/markdown';

export const setSourceModeEffect = StateEffect.define<boolean>();

export const sourceModeState = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSourceModeEffect)) return effect.value;
    }
    return value;
  },
});

/**
 * 可点击的任务复选框 Widget
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    public readonly status: 'open' | 'done' | 'discarded' | 'paused' | 'pending',
    public readonly from: number,
    public readonly to: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return (
      this.status === other.status && this.from === other.from && this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `wst-live-checkbox is-${this.status}`;
    wrap.contentEditable = 'false';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.status === 'done';
    input.tabIndex = -1;

    // 状态标记提示
    const badge = document.createElement('span');
    badge.className = 'wst-live-checkbox-badge';
    if (this.status === 'discarded') badge.textContent = '—';
    else if (this.status === 'paused') badge.textContent = '~';
    else if (this.status === 'pending') badge.textContent = '?';

    wrap.appendChild(input);
    if (badge.textContent) wrap.appendChild(badge);

    wrap.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextMarker = this.status === 'done' ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: nextMarker },
      });
    });

    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'click';
  }
}

/**
 * Callout 标题横条 Widget
 */
export class CalloutHeaderWidget extends WidgetType {
  constructor(
    public readonly type: string,
    public readonly title: string,
    public readonly fold?: '+' | '-',
  ) {
    super();
  }

  eq(other: CalloutHeaderWidget): boolean {
    return (
      this.type === other.type &&
      this.title === other.title &&
      this.fold === other.fold
    );
  }

  toDOM(): HTMLElement {
    const banner = document.createElement('div');
    banner.className = `wst-live-callout-header is-${this.type.toLowerCase()}`;
    banner.contentEditable = 'false';

    const icon = document.createElement('span');
    icon.className = 'wst-live-callout-icon';
    icon.textContent = this.type.toUpperCase();

    const titleSpan = document.createElement('span');
    titleSpan.className = 'wst-live-callout-title';
    titleSpan.textContent = this.title;

    banner.appendChild(icon);
    banner.appendChild(titleSpan);
    return banner;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * 判断指定区间 [from, to] 是否与当前选区发生重叠（光标在内则不隐藏源码，方便编辑）
 */
function selectionOverlaps(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    // 光标紧贴边缘或在区间内，都视为处于编辑态
    if (range.from <= to && range.to >= from) {
      return true;
    }
  }
  return false;
}

/**
 * 构建实时预览装饰集
 */
export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const isSourceMode = state.field(sourceModeState, false);
  if (isSourceMode) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const lineCount = doc.lines;

  // 1. 行级解析：标题样式与任务复选框
  for (let l = 1; l <= lineCount; l++) {
    const line = doc.line(l);
    const text = line.text;

    // 标题样式
    const headingMatch = /^(#{1,6})\s+/.exec(text);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: `wst-live-heading wst-live-h${level}` }),
      );
    }

    // 任务复选框
    const taskMatch = /^(\s*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX\-~?])\]/.exec(text);
    if (taskMatch) {
      const prefix = taskMatch[1]!;
      const markerChar = taskMatch[2]!;
      const markerFrom = line.from + prefix.length;
      const markerTo = markerFrom + 3; // `[x]` 长度为 3

      // 若光标不在 `[x]` 内部，用 CheckboxWidget 替换显示
      if (!selectionOverlaps(state, markerFrom, markerTo)) {
        let status: 'open' | 'done' | 'discarded' | 'paused' | 'pending' = 'open';
        if (markerChar === 'x' || markerChar === 'X') status = 'done';
        else if (markerChar === '-') status = 'discarded';
        else if (markerChar === '~') status = 'paused';
        else if (markerChar === '?') status = 'pending';

        builder.add(
          markerFrom,
          markerTo,
          Decoration.replace({
            widget: new CheckboxWidget(status, markerFrom, markerTo),
            inclusive: false,
          }),
        );
      }
    }

    // Callout 标题行
    const calloutMatch = /^>\s*\[!([a-zA-Z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/.exec(text);
    if (calloutMatch) {
      if (!selectionOverlaps(state, line.from, line.to)) {
        const meta = parseCalloutHeader(text.replace(/^>\s*/, ''));
        if (meta) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: `wst-live-callout-line is-${meta.normalizedType}` }),
          );
        }
      }
    }
  }

  // 2. 语法树级解析：粗体、斜体、代码、高亮与颜色
  try {
    const tree = syntaxTree(state);
    tree.iterate({
      enter(node) {
        const name = node.name;
        const from = node.from;
        const to = node.to;

        // 粗体
        if (name === 'StrongEmphasis') {
          if (!selectionOverlaps(state, from, to)) {
            const text = state.sliceDoc(from, to);
            if (text.startsWith('**') && text.endsWith('**') && text.length >= 4) {
              builder.add(from, from + 2, Decoration.replace({ inclusive: false }));
              builder.add(
                from + 2,
                to - 2,
                Decoration.mark({ class: 'wst-live-strong' }),
              );
              builder.add(to - 2, to, Decoration.replace({ inclusive: false }));
            }
          }
        }

        // 斜体
        if (name === 'Emphasis') {
          if (!selectionOverlaps(state, from, to)) {
            const text = state.sliceDoc(from, to);
            if (
              (text.startsWith('*') && text.endsWith('*')) ||
              (text.startsWith('_') && text.endsWith('_'))
            ) {
              builder.add(from, from + 1, Decoration.replace({ inclusive: false }));
              builder.add(
                from + 1,
                to - 1,
                Decoration.mark({ class: 'wst-live-em' }),
              );
              builder.add(to - 1, to, Decoration.replace({ inclusive: false }));
            }
          }
        }

        // 行内代码
        if (name === 'InlineCode') {
          if (!selectionOverlaps(state, from, to)) {
            builder.add(from, to, Decoration.mark({ class: 'wst-live-code' }));
          }
        }
      },
    });
  } catch {
    // 容错
  }

  return builder.finish();
}

/**
 * 实时预览 StateField
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildLivePreviewDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setSourceModeEffect))) {
      return buildLivePreviewDecorations(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 编辑器 IME 与视图事件监控插件
 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.view.requestMeasure();
      }
    }
  },
);
