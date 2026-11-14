import { EditorSelection, EditorState, type ChangeSpec, type TransactionSpec } from '@codemirror/state';

export interface CommandTarget {
  state: EditorState;
  dispatch: (tr: TransactionSpec) => void;
}

/**
 * 包装或解包行内标记（如粗体 **、斜体 * 等）
 */
export function toggleInlineMark(view: CommandTarget, marker: string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const selectionRanges = state.selection.ranges;
  const markerLen = marker.length;

  for (const range of selectionRanges) {
    const from = range.from;
    const to = range.to;
    const text = state.sliceDoc(from, to);

    // 检查选区外部是否已被标记包裹
    const beforeFrom = Math.max(0, from - markerLen);
    const afterTo = Math.min(state.doc.length, to + markerLen);
    const outerBefore = state.sliceDoc(beforeFrom, from);
    const outerAfter = state.sliceDoc(to, afterTo);

    if (outerBefore === marker && outerAfter === marker) {
      // 解包选区外部的标记
      changes.push(
        { from: beforeFrom, to: from, insert: '' },
        { from: to, to: afterTo, insert: '' },
      );
      continue;
    }

    // 检查选区内部是否以标记开头并结尾
    if (text.startsWith(marker) && text.endsWith(marker) && text.length >= markerLen * 2) {
      // 解包选区内部
      changes.push({
        from,
        to,
        insert: text.slice(markerLen, text.length - markerLen),
      });
      continue;
    }

    // 包裹标记
    changes.push({
      from,
      to,
      insert: `${marker}${text}${marker}`,
    });
  }

  if (changes.length > 0) {
    view.dispatch({ changes, scrollIntoView: true });
    return true;
  }
  return false;
}

export function toggleBold(view: CommandTarget): boolean {
  return toggleInlineMark(view, '**');
}

export function toggleItalic(view: CommandTarget): boolean {
  return toggleInlineMark(view, '*');
}

export function insertLink(view: CommandTarget): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const text = selected || '链接文本';
  const insert = `[${text}](https://)`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + text.length + 3), // 光标定位在 https:// 后面
    scrollIntoView: true,
  });
  return true;
}

/**
 * 转换行前缀（列表、数字列表、任务复选框等）
 */
export function toggleLinePrefix(
  view: CommandTarget,
  prefix: string,
  regexToRemove?: RegExp,
): boolean {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const lineText = line.text;
  const pattern = regexToRemove ?? /^(\s*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX\-~?]\][ \t]+)?)/;

  const match = pattern.exec(lineText);
  if (match) {
    const existingPrefix = match[1]!;
    if (existingPrefix.trim() === prefix.trim()) {
      // 移除现有前缀
      view.dispatch({
        changes: { from: line.from, to: line.from + existingPrefix.length, insert: '' },
      });
      return true;
    }
    // 替换为新前缀
    view.dispatch({
      changes: { from: line.from, to: line.from + existingPrefix.length, insert: prefix },
    });
    return true;
  }

  // 插入前缀
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: prefix },
  });
  return true;
}

export function toggleUnorderedList(view: CommandTarget): boolean {
  return toggleLinePrefix(view, '- ');
}

export function toggleOrderedList(view: CommandTarget): boolean {
  return toggleLinePrefix(view, '1. ');
}

export function toggleTaskList(view: CommandTarget): boolean {
  return toggleLinePrefix(view, '- [ ] ');
}

/**
 * 在任务行切换勾选状态（[ ] <-> [x]）
 */
export function toggleTaskCheck(view: CommandTarget): boolean {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const lineText = line.text;
  const match = /^(\s*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX\-~?])\](.*)$/.exec(lineText);
  if (!match) return false;

  const prefix = match[1]!;
  const markerChar = match[2]!;
  const rest = match[3]!;
  const isDone = markerChar === 'x' || markerChar === 'X';
  const nextMarker = isDone ? '[ ]' : '[x]';

  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: `${prefix}${nextMarker}${rest}`,
    },
  });
  return true;
}

/**
 * 插入 Callout（如 `> [!note] 标题\n> `）
 */
export function insertCallout(view: CommandTarget, type = 'note'): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);

  let insert = '';
  if (selected.trim()) {
    const lines = selected.split(/\r?\n/);
    insert = `> [!${type}]\n` + lines.map((l) => `> ${l}`).join('\n');
  } else {
    insert = `> [!${type}] 注意\n> `;
  }

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    scrollIntoView: true,
  });
  return true;
}

/**
 * 回车键处理列表与引用延续：
 * 1. 若当前行是空列表项（如仅 `- ` 或 `- [ ] `），按回车清除该前缀退出列表；
 * 2. 若是非空列表项，按回车延续前缀（如果是数字列表则自动序号递增，任务复选框延续为 `- [ ] `）。
 */
export function handleListEnter(view: CommandTarget): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.from);
  const lineText = line.text;

  // 1. 任务行
  const taskMatch = /^(\s*(?:>[ \t]*)*[-+*][ \t]+\[[ xX\-~?]\][ \t]*)(.*)$/.exec(lineText);
  if (taskMatch) {
    const prefix = taskMatch[1]!;
    const content = taskMatch[2]!;
    if (!content.trim() && range.from === line.to) {
      // 空任务行：清空该行前缀
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
      });
      return true;
    }
    // 延续前缀，新行默认为未完成 - [ ] 
    const baseIndent = /^(\s*(?:>[ \t]*)*)/.exec(prefix)?.[1] ?? '';
    const nextPrefix = `${baseIndent}- [ ] `;
    view.dispatch({
      changes: { from: range.from, insert: `\n${nextPrefix}` },
      selection: EditorSelection.cursor(range.from + nextPrefix.length + 1),
    });
    return true;
  }

  // 2. 有序列表
  const numMatch = /^(\s*)(\d+)([.)][ \t]+)(.*)$/.exec(lineText);
  if (numMatch) {
    const indent = numMatch[1]!;
    const num = parseInt(numMatch[2]!, 10);
    const delimiter = numMatch[3]!;
    const content = numMatch[4]!;
    if (!content.trim() && range.from === line.to) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
      });
      return true;
    }
    const nextPrefix = `${indent}${num + 1}${delimiter}`;
    view.dispatch({
      changes: { from: range.from, insert: `\n${nextPrefix}` },
      selection: EditorSelection.cursor(range.from + nextPrefix.length + 1),
    });
    return true;
  }

  // 3. 无序列表与引用
  const listMatch = /^(\s*(?:>[ \t]*)*[-+*][ \t]+)(.*)$/.exec(lineText);
  if (listMatch) {
    const prefix = listMatch[1]!;
    const content = listMatch[2]!;
    if (!content.trim() && range.from === line.to) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
      });
      return true;
    }
    view.dispatch({
      changes: { from: range.from, insert: `\n${prefix}` },
      selection: EditorSelection.cursor(range.from + prefix.length + 1),
    });
    return true;
  }

  return false;
}
