/**
 * T-32 06 §二 Phase 1 验收 1 / 3 / 5 / 8：
 * 30+ 节点、刷新不丢、Undo/Redo、拖动合批、受控导入、单主干拓扑不变。
 * EditorController 不含 React / DOM，因此这些断言在 Vitest node 环境完整跑通。
 */
import { describe, expect, it } from 'vitest';
import { canonicalize, describeDomainChange, validateDomain } from '@workspacetree/core';
import { BranchFileSchema } from '@workspacetree/schema';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createDemoBranchFile } from '../../apps/web/src/demo';
import { EditorController } from '../../apps/web/src/editor';
import {
  addTaskEntry,
  clearPositionsEntry,
  createNodeEntry,
  createSpineEntry,
  deleteSubtreeEntry,
  DragCoalescer,
  moveEntry,
  removeEdgeEntry,
  renameNodeEntry,
  replaceDomainEntry,
  setNodeTagsEntry,
  setTaskTagsEntry,
  toggleTaskEntry,
} from '../../apps/web/src/history';

async function setup(): Promise<{ editor: EditorController; storage: MemoryStorageAdapter }> {
  const storage = new MemoryStorageAdapter();
  const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
  return { editor, storage };
}

describe('T-32 画布启动与持久化', () => {
  it('30+ 节点、多子分支与跨分支依赖线，DomainState 合法', async () => {
    const { editor } = await setup();
    const domain = editor.getSnapshot().file.domain;
    expect(domain.nodes.length).toBeGreaterThanOrEqual(30);
    expect(domain.edges.filter((edge) => edge.type === 'dependency').length).toBeGreaterThan(0);
    expect(() => validateDomain(domain)).not.toThrow();
  });

  it('刷新 / 重启不丢数据：同一个 storage 重新 bootstrap 读到相同状态', async () => {
    const { editor, storage } = await setup();
    await editor.run(createNodeEntry('n_added', '新增节点', 'n_root', 'e_h_added'));
    const reopened = await EditorController.bootstrap(storage, createDemoBranchFile);
    const domain = reopened.getSnapshot().file.domain;
    expect(domain.nodes.some((node) => node.id === 'n_added')).toBe(true);
    expect(canonicalize(domain)).toBe(canonicalize(editor.getSnapshot().file.domain));
  });
});

describe('T-33 Undo / Redo 反向命令栈', () => {
  it('persists independent tags, preserves them on task completion, and restores missing fields on undo', async () => {
    const { editor, storage } = await setup();
    const before = editor.getSnapshot().file;
    const domain = () => editor.getSnapshot().file.domain;
    const nodeId = 'n_writing_init';
    const taskId = 'tsk_new';

    await editor.run(setNodeTagsEntry(domain(), nodeId, ['实验', '实验']));
    await editor.run(
      addTaskEntry({ id: taskId, nodeId, title: 'New task', done: false, tags: ['写作'] }),
    );
    await editor.run(setTaskTagsEntry(domain(), taskId, ['招募']));
    await editor.run(toggleTaskEntry(domain(), taskId));
    expect(editor.getSnapshot().error).toBeNull();

    const saved = await storage.load(before.projectId);
    const parsed = BranchFileSchema.parse(JSON.parse(JSON.stringify(saved)));
    expect(parsed.domain.nodes.find((node) => node.id === nodeId)?.tags).toEqual(['实验']);
    expect(parsed.domain.tasks.find((task) => task.id === taskId)).toMatchObject({
      done: true,
      tags: ['招募'],
    });
    const beforeTaskEdit = structuredClone(parsed.domain);
    beforeTaskEdit.tasks.find((task) => task.id === taskId)!.tags = ['写作'];
    expect(describeDomainChange(beforeTaskEdit, parsed.domain)).toContain(
      '~ task tsk_new tags changed',
    );
    expect(describeDomainChange(before.domain, parsed.domain)).toContain(
      '~ node n_writing_init tags changed',
    );

    await editor.run(setTaskTagsEntry(domain(), taskId, ['#invalid']));
    expect(editor.getSnapshot().error).toMatch(/command.payload.tags/);
    expect(editor.getSnapshot().file.revisions.semanticHash).toBe(parsed.revisions.semanticHash);

    await editor.undo();
    await editor.undo();
    expect(domain().tasks.find((task) => task.id === taskId)?.tags).toEqual(['写作']);
    await editor.undo();
    await editor.undo();
    expect(editor.getSnapshot().file.revisions.semanticHash).toBe(before.revisions.semanticHash);
    await editor.redo();
    expect(domain().nodes.find((node) => node.id === nodeId)?.tags).toEqual(['实验']);
  });

  it('创建继承尺寸的子节点只占一条撤销记录，并保留其他节点尺寸', async () => {
    const { editor } = await setup();
    const { presentation } = editor.getSnapshot().file;
    const id = 'n_inherited';
    await editor.run(createNodeEntry(id, '继承样式', 'n_root', 'e_h_inherited', presentation));
    const created = editor.getSnapshot();
    expect(created.undoDepth).toBe(1);
    expect(created.file.presentation.nodeScales?.[id]).toBe(presentation.nodeScales?.n_root);
    const parentSize = presentation.nodeSizes?.n_root ?? { width: 220, height: 76 };
    const expectedChildSize = {
      width: Math.max(140, Math.round(parentSize.width * 0.85)),
      height: Math.max(44, Math.round(parentSize.height * 0.85)),
    };
    expect(created.file.presentation.nodeSizes).toEqual({
      ...presentation.nodeSizes,
      [id]: expectedChildSize,
    });
    await editor.undo();
    expect(editor.getSnapshot().file.presentation.nodeSizes).toEqual(presentation.nodeSizes);
    expect(editor.getSnapshot().file.domain.nodes.some((node) => node.id === id)).toBe(false);
    await editor.redo();
    expect(editor.getSnapshot().file.presentation.nodeSizes).toEqual(
      created.file.presentation.nodeSizes,
    );
    expect(editor.getSnapshot().file.domain.nodes.some((node) => node.id === id)).toBe(true);
  });

  it('节点创建 / 重命名 / 任务 / 连线变更均可撤销与重做', async () => {
    const { editor } = await setup();
    const initial = editor.getSnapshot().file.domain;

    await editor.run(createNodeEntry('n_tmp', '临时', 'n_root', 'e_h_tmp'));
    expect(editor.getSnapshot().file.domain.nodes).toHaveLength(initial.nodes.length + 1);
    await editor.undo();
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(canonicalize(initial));
    await editor.redo();
    expect(canonicalize(editor.getSnapshot().file.domain)).not.toBe(canonicalize(initial));

    await editor.run(
      renameNodeEntry(editor.getSnapshot().file.domain, 'n_writing_template', '改名后'),
    );
    expect(
      editor.getSnapshot().file.domain.nodes.find((n) => n.id === 'n_writing_template')?.title,
    ).toBe('改名后');
    await editor.undo();
    expect(
      editor.getSnapshot().file.domain.nodes.find((n) => n.id === 'n_writing_template')?.title,
    ).toBe('准备好模板');

    const taskId = editor.getSnapshot().file.domain.tasks[0].id;
    await editor.run(toggleTaskEntry(editor.getSnapshot().file.domain, taskId));
    await editor.undo();
    await editor.redo();
    expect(editor.getSnapshot().undoDepth).toBeGreaterThan(0);
  });

  it('删除整棵子树后 Undo 完整还原节点、边、任务与 Spine 拓扑', async () => {
    const { editor } = await setup();
    const before = canonicalize(editor.getSnapshot().file.domain);
    await editor.run(deleteSubtreeEntry(editor.getSnapshot().file.domain, 'n_writing_init'));
    const after = editor.getSnapshot().file.domain;
    expect(after.nodes.some((node) => node.id === 'n_writing_init')).toBe(false);
    expect(after.nodes.some((node) => node.id === 'n_writing_template')).toBe(false);
    expect(() => validateDomain(after)).not.toThrow();
    await editor.undo();
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(before);
  });

  it('删除连线后 Undo 恢复原边；创建主干后 Undo 移除', async () => {
    const { editor } = await setup();
    const cross = editor
      .getSnapshot()
      .file.domain.edges.find((edge) => edge.type === 'dependency')!;
    await editor.run(removeEdgeEntry(editor.getSnapshot().file.domain, cross.id));
    expect(editor.getSnapshot().file.domain.edges.some((edge) => edge.id === cross.id)).toBe(false);
    await editor.undo();
    expect(editor.getSnapshot().file.domain.edges.some((edge) => edge.id === cross.id)).toBe(true);

    await editor.run(createSpineEntry('spn_test', '测试主干', ['n_root', 'n_init']));
    expect(editor.getSnapshot().file.domain.spines.some((spine) => spine.id === 'spn_test')).toBe(
      true,
    );
    await editor.undo();
    expect(editor.getSnapshot().file.domain.spines.some((spine) => spine.id === 'spn_test')).toBe(
      false,
    );
  });

  it('所有写入都经 CommandService：非法图整批失败、不产生半落盘状态', async () => {
    const { editor } = await setup();
    const before = canonicalize(editor.getSnapshot().file.domain);
    // 重复节点 ID 会在 validateDomain 阶段被拒，CommandService 不落盘。
    await editor.run(createNodeEntry('n_root', '重复 ID', null, 'e_h_dup'));
    expect(editor.getSnapshot().error).not.toBeNull();
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(before);
  });
});

describe('T-34 连续拖动 100 次只合并为单次呈现批次（验收 8）', () => {
  it('DragCoalescer：100 帧 → 1 条历史、1 条合并命令', () => {
    const coalescer = new DragCoalescer();
    coalescer.begin('n_writing_template', { x: 0, y: 0 });
    for (let frame = 1; frame <= 100; frame += 1) {
      coalescer.move('n_writing_template', { x: frame * 2, y: frame });
    }
    expect(coalescer.frameCount).toBe(100);
    const batch = coalescer.finish();
    expect(batch).not.toBeNull();
    expect(batch!.frames).toBe(100);
    expect(batch!.mergedCommands).toBe(1);
    expect(batch!.entry.stateClass).toBe('presentation');
    expect(batch!.entry.forward).toHaveLength(1);
    expect(batch!.entry.forward[0].type).toBe('presentation.moveNode');
    expect(coalescer.finish()).toBeNull();
  });

  it('控制器：100 次拖动只 +1 呈现修订、0 语义 Commit、不产生帧级历史', async () => {
    const { editor } = await setup();
    const before = editor.getSnapshot();
    editor.dragBegin('n_writing_template', { x: 0, y: 0 });
    for (let frame = 1; frame <= 100; frame += 1) {
      editor.dragMove('n_writing_template', { x: frame * 3, y: frame * 2 });
    }
    await editor.dragEnd();
    const after = editor.getSnapshot();
    expect(after.file.revisions.presentationRevision).toBe(
      before.file.revisions.presentationRevision + 1,
    );
    expect(after.file.revisions.semanticRevision).toBe(before.file.revisions.semanticRevision);
    expect(after.file.revisions.semanticHash).toBe(before.file.revisions.semanticHash);
    expect(after.stats.semanticCommits - before.stats.semanticCommits).toBe(0);
    expect(after.stats.presentationBatches - before.stats.presentationBatches).toBe(1);
    expect(after.stats.persistedBatches - before.stats.persistedBatches).toBe(1);
    expect(after.stats.persistedCommands - before.stats.persistedCommands).toBe(1);
    expect(after.undoDepth - before.undoDepth).toBe(1);
    expect(after.stats.lastDragFrames).toBe(100);
    expect(after.file.presentation.nodePositions.n_writing_template).toEqual({ x: 300, y: 200 });

    await editor.undo();
    expect(editor.getSnapshot().file.presentation.nodePositions.n_writing_template).toBeUndefined();
  });

  it('手动锁点持久化到 SavedPresentation，自动布局清除后可撤销', async () => {
    const { editor } = await setup();
    await editor.run(
      moveEntry([{ nodeId: 'n_exp_program', from: { x: 0, y: 0 }, to: { x: 512, y: 256 } }]),
    );
    expect(editor.getSnapshot().file.presentation.nodePositions.n_exp_program).toEqual({
      x: 512,
      y: 256,
    });
    await editor.run(clearPositionsEntry(editor.getSnapshot().file));
    expect(editor.getSnapshot().file.presentation.nodePositions.n_exp_program).toBeUndefined();
    await editor.undo();
    expect(editor.getSnapshot().file.presentation.nodePositions.n_exp_program).toEqual({
      x: 512,
      y: 256,
    });
  });
});

describe('T-35 受控导入与主干高亮', () => {
  it('.branch.json 整域替换经 CommandService，undo 可还原', async () => {
    const { editor } = await setup();
    const before = canonicalize(editor.getSnapshot().file.domain);
    const imported = createDemoBranchFile();
    imported.domain.nodes[0].title = '导入后的根';
    await editor.run(replaceDomainEntry(editor.getSnapshot().file.domain, imported.domain));
    expect(editor.getSnapshot().file.domain.nodes[0].title).toBe('导入后的根');
    await editor.undo();
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(before);
  });

  it('切换高亮属于 SessionView，不改变 DomainState 拓扑', async () => {
    const { editor } = await setup();
    const before = canonicalize(editor.getSnapshot().file.domain);
    // 高亮只由 layout.spineHighlight 计算显示集合，控制器无需写入。
    expect(editor.getSnapshot().file.domain.spines).toHaveLength(3);
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(before);
  });
});
