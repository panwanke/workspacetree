import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
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
  type CommandTarget,
} from '../../apps/web/src/markdown/commands';
import {
  livePreviewField,
  setSourceModeEffect,
  sourceModeState,
} from '../../apps/web/src/markdown/live-preview';
import { editorSessionStore } from '../../apps/web/src/markdown/editor-session';

function createTestTarget(
  doc: string,
  selection?: { from: number; to: number },
): CommandTarget & { docString: () => string } {
  let state = EditorState.create({
    doc,
    selection: selection ? EditorSelection.single(selection.from, selection.to) : undefined,
    extensions: [markdown({ base: markdownLanguage }), sourceModeState, livePreviewField],
  });
  return {
    get state() {
      return state;
    },
    dispatch(tr: TransactionSpec) {
      state = state.update(tr).state;
    },
    docString() {
      return state.doc.toString();
    },
  };
}

describe('Markdown 快捷键与命令处理 (commands.ts)', () => {
  it('toggleBold 包裹与解包粗体语法', () => {
    // 1. 包裹选中文字
    const target1 = createTestTarget('Hello world', { from: 6, to: 11 });
    expect(toggleBold(target1)).toBe(true);
    expect(target1.docString()).toBe('Hello **world**');

    // 2. 解包已有粗体（选区在 ** 内部）
    const target2 = createTestTarget('Hello **world**', { from: 8, to: 13 });
    expect(toggleBold(target2)).toBe(true);
    expect(target2.docString()).toBe('Hello world');
  });

  it('toggleItalic 包裹与解包斜体语法', () => {
    const target = createTestTarget('Hello text', { from: 6, to: 10 });
    expect(toggleItalic(target)).toBe(true);
    expect(target.docString()).toBe('Hello *text*');

    const unwrapTarget = createTestTarget('Hello *text*', { from: 7, to: 11 });
    expect(toggleItalic(unwrapTarget)).toBe(true);
    expect(unwrapTarget.docString()).toBe('Hello text');
  });

  it('insertLink 插入 Markdown 链接结构', () => {
    const target = createTestTarget('查看文档', { from: 2, to: 4 });
    expect(insertLink(target)).toBe(true);
    expect(target.docString()).toBe('查看[文档](https://)');
  });

  it('toggleUnorderedList 与 toggleOrderedList 切换列表前缀并将光标置于右侧', () => {
    // 1. 在非空行首触发无序列表
    const target = createTestTarget('我的列表条目', { from: 0, to: 0 });
    expect(toggleUnorderedList(target)).toBe(true);
    expect(target.docString()).toBe('- 我的列表条目');
    expect(target.state.selection.main.from).toBe(2); // 光标在 '- ' 右侧而非左侧

    // 再次触发取消列表
    expect(toggleUnorderedList(target)).toBe(true);
    expect(target.docString()).toBe('我的列表条目');
    expect(target.state.selection.main.from).toBe(0);

    // 2. 在空行触发无序列表
    const emptyTarget = createTestTarget('', { from: 0, to: 0 });
    expect(toggleUnorderedList(emptyTarget)).toBe(true);
    expect(emptyTarget.docString()).toBe('- ');
    expect(emptyTarget.state.selection.main.from).toBe(2);

    // 3. 在空行触发有序列表
    const emptyOrd = createTestTarget('', { from: 0, to: 0 });
    expect(toggleOrderedList(emptyOrd)).toBe(true);
    expect(emptyOrd.docString()).toBe('1. ');
    expect(emptyOrd.state.selection.main.from).toBe(3);

    // 4. 再次触发取消
    expect(toggleOrderedList(emptyOrd)).toBe(true);
    expect(emptyOrd.docString()).toBe('');
    expect(emptyOrd.state.selection.main.from).toBe(0);
  });

  it('toggleTaskList 与 toggleTaskCheck 切换任务标记与完成状态并将光标置于右侧', () => {
    // 1. 空行插入任务
    const emptyTask = createTestTarget('', { from: 0, to: 0 });
    expect(toggleTaskList(emptyTask)).toBe(true);
    expect(emptyTask.docString()).toBe('- [ ] ');
    expect(emptyTask.state.selection.main.from).toBe(6); // 光标在 '- [ ] ' 右侧而非左侧

    // 2. 非空行转换为任务
    const target = createTestTarget('开发新功能', { from: 0, to: 0 });
    expect(toggleTaskList(target)).toBe(true);
    expect(target.docString()).toBe('- [ ] 开发新功能');
    expect(target.state.selection.main.from).toBe(6);

    // 切换勾选状态（[ ] -> [x]）
    expect(toggleTaskCheck(target, '2026-11-17')).toBe(true);
    expect(target.docString()).toBe('- [x] 开发新功能 ✅ 2026-11-17');

    // 再次切换勾选状态（[x] -> [ ]）
    expect(toggleTaskCheck(target)).toBe(true);
    expect(target.docString()).toBe('- [ ] 开发新功能');
  });

  it('insertCallout 包装 Callout 块', () => {
    const target = createTestTarget('这是一段重要信息', { from: 0, to: 8 });
    expect(insertCallout(target, 'warning')).toBe(true);
    expect(target.docString()).toBe('> [!warning]\n> 这是一段重要信息');
  });

  it('leaves fenced checklist examples unchanged', () => {
    const doc = '~~~md\n- [ ] Example\n~~~';
    const target = createTestTarget(doc, {
      from: doc.indexOf('Example'),
      to: doc.indexOf('Example'),
    });
    expect(toggleTaskCheck(target)).toBe(false);
    expect(target.docString()).toBe(doc);
    expect(target.state.field(livePreviewField).size).toBe(0);
  });

  it('handleListEnter 智能延续列表前缀与回车退出', () => {
    // 1. 无序列表延续
    const target1 = createTestTarget('- 第一项', { from: 5, to: 5 });
    expect(handleListEnter(target1)).toBe(true);
    expect(target1.docString()).toBe('- 第一项\n- ');

    // 2. 空列表项回车退出
    const target2 = createTestTarget('- ', { from: 2, to: 2 });
    expect(handleListEnter(target2)).toBe(true);
    expect(target2.docString()).toBe('');

    // 3. 有序列表自动序号递增
    const target3 = createTestTarget('1. 第一步', { from: 6, to: 6 });
    expect(handleListEnter(target3)).toBe(true);
    expect(target3.docString()).toBe('1. 第一步\n2. ');

    // 4. 任务列表延续
    const doc4 = '- [x] 已完成任务';
    const target4 = createTestTarget(doc4, { from: doc4.length, to: doc4.length });
    expect(handleListEnter(target4)).toBe(true);
    expect(target4.docString()).toBe('- [x] 已完成任务\n- [ ] ');
  });
});

describe('实时预览装饰与源码模式 (live-preview.ts)', () => {
  it('非编辑位置生成装饰，光标进入时展开源码，源码模式禁用装饰', () => {
    const doc = '# 一级标题\n- [ ] 任务一\n**粗体文本**';
    const target = createTestTarget(doc, { from: doc.length, to: doc.length });

    const decos = target.state.field(livePreviewField);
    expect(decos.size).toBeGreaterThan(0);

    // 切换到源码模式
    target.dispatch({ effects: setSourceModeEffect.of(true) });
    const sourceDecos = target.state.field(livePreviewField);
    expect(sourceDecos.size).toBe(0);

    // 切回实时预览
    target.dispatch({ effects: setSourceModeEffect.of(false) });
    expect(target.state.field(livePreviewField).size).toBeGreaterThan(0);
  });
});

describe('草稿会话管理器 (editor-session.ts)', () => {
  it('正确跟踪草稿创建、编辑更新、脏状态与清理', () => {
    const prj = 'prj_session_test';
    const node = 'n_1';
    const block = 'blk_1';

    const session = editorSessionStore.getOrCreate(prj, node, block, '初始笔记');
    expect(session.isDirty).toBe(false);
    expect(editorSessionStore.hasDirtyDrafts()).toBe(false);

    // 更新内容
    editorSessionStore.updateMarkdown(prj, node, '修改后的笔记');
    const updated = editorSessionStore.get(prj, node)!;
    expect(updated.currentMarkdown).toBe('修改后的笔记');
    expect(updated.isDirty).toBe(true);
    expect(editorSessionStore.hasDirtyDrafts()).toBe(true);

    // 切换源码模式
    const mode = editorSessionStore.toggleSourceMode(prj, node);
    expect(mode).toBe(true);
    expect(editorSessionStore.get(prj, node)!.sourceMode).toBe(true);

    // 关闭会话
    editorSessionStore.close(prj, node);
    expect(editorSessionStore.get(prj, node)).toBeUndefined();
    expect(editorSessionStore.hasDirtyDrafts()).toBe(false);
  });
});
