import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  Compartment,
  EditorState,
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  IMAGE_TAG_REGEX,
  formatImageTag,
  parseCalloutHeader,
  parseImageMeta,
  TASK_STATUS_CONFIG,
  type MarkdownTaskStatus,
  type MarkdownImageMeta,
} from '@workspacetree/markdown';
import type { AssetRecord } from '@workspacetree/schema';
import { render } from 'pele';
import { assetBlobUrls } from '../images/image-assets.js';
import { editorTasks, toggleTaskAtLine } from './commands';

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

export const assetsFacet = Facet.define<Record<string, AssetRecord>, Record<string, AssetRecord>>({
  combine(values) {
    const combined: Record<string, AssetRecord> = {};
    for (const val of values) {
      if (val) Object.assign(combined, val);
    }
    return combined;
  },
});

export const assetsCompartment = new Compartment();

/**
 * 可点击的任务复选框 Widget
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    public readonly status: MarkdownTaskStatus,
    public readonly from: number,
    public readonly to: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return this.status === other.status && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `wst-live-checkbox is-${this.status}`;
    wrap.contentEditable = 'false';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.status === 'done';
    input.tabIndex = -1;
    input.setAttribute('aria-label', TASK_STATUS_CONFIG[this.status].label);

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
      toggleTaskAtLine(view, view.state.doc.lineAt(this.from).number);
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
    return this.type === other.type && this.title === other.title && this.fold === other.fold;
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
 * 实时预览图片 Widget
 */
export class ImageWidget extends WidgetType {
  constructor(
    public readonly meta: MarkdownImageMeta,
    public readonly from: number,
    public readonly to: number,
    public readonly resolvedUrl: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      this.meta.url === other.meta.url &&
      this.meta.alt === other.meta.alt &&
      this.meta.widthPercent === other.meta.widthPercent &&
      this.from === other.from &&
      this.to === other.to &&
      this.resolvedUrl === other.resolvedUrl
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wst-image-container is-interactive nodrag nopan';
    wrap.contentEditable = 'false';
    const initialPercent = this.meta.widthPercent ?? 50;
    wrap.style.width = `${initialPercent}%`;

    if (this.meta.isAsset && (!this.resolvedUrl || this.resolvedUrl === '')) {
      const err = document.createElement('div');
      err.className = 'wst-md-img-missing';
      err.textContent = `⚠️ 缺失图片资产 (${this.meta.url})`;
      wrap.appendChild(err);
      return wrap;
    }

    const img = document.createElement('img');
    img.src = this.resolvedUrl || this.meta.url;
    img.alt = this.meta.alt || '插图';
    img.className = 'wst-md-img';
    img.loading = 'lazy';
    img.onload = () => {
      view.requestMeasure();
    };

    // 点击图片聚焦展开源码
    img.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from },
      });
      view.focus();
    });

    // 拖动柄
    const handle = document.createElement('div');
    handle.className = 'wst-image-resize-handle';
    handle.title = `拖动调整尺寸 (${initialPercent}%)`;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const editorEl = (view.dom.querySelector('.cm-content') as HTMLElement) || view.dom;
      const parentWidth =
        editorEl.getBoundingClientRect().width ||
        wrap.parentElement?.getBoundingClientRect().width ||
        400;
      let currentPercent = initialPercent;
      handle.classList.add('is-dragging');

      const onPointerMove = (moveEvt: PointerEvent) => {
        const deltaX = moveEvt.clientX - startX;
        const deltaPercent = (deltaX / parentWidth) * 100;
        currentPercent = Math.max(10, Math.min(100, Math.round(initialPercent + deltaPercent)));
        wrap.style.width = `${currentPercent}%`;
        handle.title = `拖动调整尺寸 (${currentPercent}%)`;
        view.requestMeasure();
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        handle.classList.remove('is-dragging');

        const newTag = formatImageTag({
          alt: this.meta.alt,
          url: this.meta.url,
          widthPercent: currentPercent,
        });
        view.dispatch({
          changes: { from: this.from, to: this.to, insert: newTag },
        });
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    wrap.appendChild(img);
    wrap.appendChild(handle);
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'click';
  }
}

/**
 * 实时预览 Pele / Mermaid 代码块 Widget
 */
export class PeleWidget extends WidgetType {
  constructor(
    public readonly code: string,
    public readonly from: number,
    public readonly to: number,
  ) {
    super();
  }

  eq(other: PeleWidget): boolean {
    return this.code === other.code && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wst-pele-live-container nodrag nopan';
    wrap.contentEditable = 'false';

    try {
      const res = render(this.code.trim(), {
        fontFamily:
          '"Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        responsive: true,
      });
      wrap.innerHTML = res.svg;
    } catch (err: unknown) {
      wrap.className += ' is-error';
      const msg = err instanceof Error ? err.message : String(err);
      wrap.textContent = `⚠️ Pele 语法错误: ${msg}`;
    }

    // 点击展开源码聚焦
    wrap.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from },
      });
      view.focus();
    });

    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'click';
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

interface DecorationItem {
  from: number;
  to: number;
  deco: Decoration;
}

/**
 * 构建实时预览装饰集
 */
export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const isSourceMode = state.field(sourceModeState, false);
  if (isSourceMode) {
    return Decoration.none;
  }

  const items: DecorationItem[] = [];
  const doc = state.doc;
  const lineCount = doc.lines;
  const assets = state.facet(assetsFacet);
  const tasks = editorTasks(doc);

  // 1. 行级解析：标题样式与任务复选框
  for (let l = 1; l <= lineCount; l++) {
    const line = doc.line(l);
    const text = line.text;

    // 标题样式
    const headingMatch = /^(#{1,6})\s+/.exec(text);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      items.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({ class: `wst-live-heading wst-live-h${level}` }),
      });
    }

    // 任务复选框
    const task = tasks.get(l);
    if (task) {
      const markerFrom = line.from + task.prefix.length;
      const markerTo = markerFrom + 3; // `[x]` 长度为 3

      // 若光标不在 `[x]` 内部，用 CheckboxWidget 替换显示
      if (!selectionOverlaps(state, markerFrom, markerTo)) {
        items.push({
          from: markerFrom,
          to: markerTo,
          deco: Decoration.replace({
            widget: new CheckboxWidget(task.status, markerFrom, markerTo),
            inclusive: false,
          }),
        });
      }
    }

    // Callout 标题行
    const calloutMatch = /^>\s*\[!([a-zA-Z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/.exec(text);
    if (calloutMatch) {
      if (!selectionOverlaps(state, line.from, line.to)) {
        const meta = parseCalloutHeader(text.replace(/^>\s*/, ''));
        if (meta) {
          items.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: `wst-live-callout-line is-${meta.normalizedType}` }),
          });
        }
      }
    }
  }

  // 2. 图片解析：![alt](url){width=...}
  const replacedRanges: { from: number; to: number }[] = [];
  const fullText = state.doc.toString();
  const imgRegex = new RegExp(IMAGE_TAG_REGEX.source, 'g');
  let imgMatch: RegExpExecArray | null;

  while ((imgMatch = imgRegex.exec(fullText)) !== null) {
    const [raw, alt = '', url = '', widthStr] = imgMatch;
    const from = imgMatch.index;
    const to = from + raw.length;

    if (!selectionOverlaps(state, from, to)) {
      const meta = parseImageMeta(alt, url, widthStr ? `{width=${widthStr}%}` : undefined);
      const resolvedUrl =
        meta.isAsset && meta.assetId
          ? assetBlobUrls.getUrl(meta.assetId, assets[meta.assetId])
          : meta.url;

      items.push({
        from,
        to,
        deco: Decoration.replace({
          widget: new ImageWidget(meta, from, to, resolvedUrl),
          inclusive: false,
        }),
      });
      replacedRanges.push({ from, to });
    }
  }

  // 3. Pele / Mermaid 流程图代码块实时预览
  const peleBlockRegex = /^```(?:mermaid|pele)[ \t]*\r?\n([\s\S]*?)\r?\n```$/gm;
  let peleMatch: RegExpExecArray | null;

  while ((peleMatch = peleBlockRegex.exec(fullText)) !== null) {
    const from = peleMatch.index;
    const to = from + peleMatch[0].length;
    const code = peleMatch[1]!;

    if (!selectionOverlaps(state, from, to)) {
      items.push({
        from,
        to,
        deco: Decoration.replace({
          widget: new PeleWidget(code, from, to),
          inclusive: false,
          block: true,
        }),
      });
      replacedRanges.push({ from, to });
    }
  }

  // 4. 语法树级解析：粗体、斜体、代码
  try {
    const tree = syntaxTree(state);
    tree.iterate({
      enter(node) {
        const name = node.name;
        const from = node.from;
        const to = node.to;

        // 如果该区域已被图片整段替换，跳过内部行内装饰
        if (replacedRanges.some((r) => from >= r.from && to <= r.to)) {
          return;
        }

        // 粗体
        if (name === 'StrongEmphasis') {
          if (!selectionOverlaps(state, from, to)) {
            const text = state.sliceDoc(from, to);
            if (text.startsWith('**') && text.endsWith('**') && text.length >= 4) {
              items.push({ from, to: from + 2, deco: Decoration.replace({ inclusive: false }) });
              items.push({
                from: from + 2,
                to: to - 2,
                deco: Decoration.mark({ class: 'wst-live-strong' }),
              });
              items.push({ from: to - 2, to, deco: Decoration.replace({ inclusive: false }) });
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
              items.push({ from, to: from + 1, deco: Decoration.replace({ inclusive: false }) });
              items.push({
                from: from + 1,
                to: to - 1,
                deco: Decoration.mark({ class: 'wst-live-em' }),
              });
              items.push({ from: to - 1, to, deco: Decoration.replace({ inclusive: false }) });
            }
          }
        }

        // 行内代码
        if (name === 'InlineCode') {
          if (!selectionOverlaps(state, from, to)) {
            items.push({ from, to, deco: Decoration.mark({ class: 'wst-live-code' }) });
          }
        }
      },
    });
  } catch {
    // 容错
  }

  // 排序：先按 from 升序；若 from 相同，行装饰排在行内装饰前面
  items.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    const aIsLine = (a.deco as any).spec?.line ?? false;
    const bIsLine = (b.deco as any).spec?.line ?? false;
    if (aIsLine && !bIsLine) return -1;
    if (!aIsLine && bIsLine) return 1;
    return a.to - b.to;
  });

  const builder = new RangeSetBuilder<Decoration>();
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
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
