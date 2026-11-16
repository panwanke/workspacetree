import { describe, expect, it } from 'vitest';
import {
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  validateDomain,
} from '@workspacetree/core';
import { resolveLayoutDirection, resolveVisualGraph } from '@workspacetree/layout';
import type { BranchFile, LayoutDirection } from '@workspacetree/schema';
import {
  createMemoryKeyValueStore,
  IdbJsonStorageAdapter,
  MemoryStorageAdapter,
} from '@workspacetree/storage';
import { createDemoBranchFile, createEmptyBranchFile } from '../fixtures/phase1-demo';
import { transferBranch } from '../../apps/web/src/branch-editing';
import { EditorController } from '../../apps/web/src/editor';
import { clearPositionEntry, clearPositionsEntry } from '../../apps/web/src/history';
import { collectProjectTodos } from '../../apps/web/src/project-todos';

const sourceId = 'n_writing_init';
const targetId = 'n_analysis';
const subtree = ['n_writing_init', 'n_writing_template', 'n_writing_template_latex'];

class FailingStorage extends MemoryStorageAdapter {
  fail = false;
  writes = 0;

  override async save(file: BranchFile): Promise<void> {
    if (this.fail) throw new Error('save failed');
    await super.save(file);
    this.writes += 1;
  }
}

async function setup() {
  const storage = new FailingStorage();
  const editor = await EditorController.bootstrap(storage, () => {
    const file = createDemoBranchFile();
    file.presentation.collapsedByDefault = [sourceId, targetId];
    file.presentation.branchScales[targetId] = 0.1;
    file.presentation.branchScales[sourceId] = 0.5;
    file.presentation.nodePositions.n_writing_template_latex = { x: 380, y: 50 };
    file.presentation.verticalNodePositions!.n_writing_template_latex = { x: 25, y: 320 };
    const blockId = 'blk_branch_move_test';
    file.domain.blocks.push({
      id: blockId,
      kind: 'text',
      payload: { markdown: '- [ ] Maintain bibliography' },
    });
    file.domain.nodes.find((node) => node.id === 'n_writing_template')!.blockIds.push(blockId);
    file.domain.tasks.push({ id: 'tsk_inbox', title: 'Inbox', nodeId: null, done: false });
    file.domain.tasks.push({
      id: 'tsk_destination',
      title: 'At destination',
      nodeId: targetId,
      done: false,
    });
    file.revisions.presentationHash = computePresentationHash(file.presentation);
    file.revisions.semanticHash = computeSemanticHash(file.domain);
    file.revisions.fileHash = computeFileHash(file);
    return file;
  });
  return { storage, editor, current: () => editor.getSnapshot().file };
}

function layout(file: BranchFile, layoutDirection: LayoutDirection) {
  return resolveVisualGraph(file.domain, {
    ...file.presentation,
    layoutDirection,
    collapsedByDefault: [],
  });
}

describe('subtree movement', () => {
  it('copies across projects and moves atomically with shared undo and redo', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const source = await EditorController.bootstrap(storage, createDemoBranchFile);
    const target = await EditorController.bootstrap(storage, createEmptyBranchFile);
    const before = source.getSnapshot().file;
    const destination = target.getSnapshot().file;
    const parentId = destination.domain.project.rootNodeId;
    const makeEdit = () =>
      transferBranch(before, destination, sourceId, parentId, 'date-constrained');
    const copied = makeEdit();
    await target.run(copied.receive);
    expect(source.getSnapshot().file.domain).toEqual(before.domain);
    expect(
      target.getSnapshot().file.domain.nodes.find((node) => node.id === copied.id)?.parentId,
    ).toBe(parentId);
    await target.undo();

    const edit = transferBranch(
      before,
      target.getSnapshot().file,
      sourceId,
      parentId,
      'date-constrained',
    );
    await storage.setDenied(true);
    await target.moveBetween(edit.receive, source, edit.remove);
    expect(target.getSnapshot().error).toBeTruthy();
    expect((await storage.load(before.projectId))?.domain).toEqual(before.domain);
    expect((await storage.load(destination.projectId))?.domain).toEqual(destination.domain);
    await storage.setDenied(false);
    await target.moveBetween(edit.receive, source, edit.remove);
    expect(target.getSnapshot().error).toBeNull();
    const moved = target.getSnapshot().file;
    expect(source.getSnapshot().file.domain.nodes.some((node) => node.id === sourceId)).toBe(false);
    expect(moved.domain.nodes.find((node) => node.id === edit.id)?.parentId).toBe(parentId);
    expect(moved.domain.nodes.some((node) => node.title === 'LaTeX 模板配置')).toBe(true);
    expect(moved.domain.tasks.length).toBeGreaterThan(0);
    expect(moved.presentation.verticalNodePositions?.[edit.id]).toBeDefined();
    await source.undo();
    expect(source.getSnapshot().file.domain).toEqual(before.domain);
    expect(target.getSnapshot().file.domain).toEqual(destination.domain);
    await target.redo();
    expect(target.getSnapshot().file.domain).toEqual(moved.domain);
    expect(source.getSnapshot().file.domain.nodes.some((node) => node.id === sourceId)).toBe(false);
  });

  it('adds the complete recovered move to history after journal cleanup is interrupted', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
    const { reparentBranchEntry } = await import('../../apps/web/src/branch-editing');
    const before = editor.getSnapshot().file;
    storage.setCrash({ failAt: 'replace' });
    await editor.run(reparentBranchEntry(before, sourceId, targetId)!);
    expect(editor.getSnapshot()).toMatchObject({ undoDepth: 1, error: null });
    expect(
      editor.getSnapshot().file.domain.nodes.find((node) => node.id === sourceId)?.parentId,
    ).toBe(targetId);
    storage.clearCrash();
    await editor.undo();
    expect(editor.getSnapshot().file.domain).toEqual(before.domain);
  });

  it('keeps the legacy horizontal layout after clearing the final horizontal lock', async () => {
    const { editor, current } = await setup();
    const file = structuredClone(current());
    delete file.presentation.layoutDirection;
    await editor.importFile(file);
    const id = 'n_writing_template_latex';
    const { restoreBranchLayoutEntry } = await import('../../apps/web/src/branch-editing');
    for (const makeEntry of [
      () => clearPositionEntry(current(), id, 'horizontal'),
      () => clearPositionsEntry(current(), 'horizontal'),
      () => restoreBranchLayoutEntry(current(), id, 'horizontal')!,
    ]) {
      await editor.run(makeEntry());
      expect(current().presentation.nodePositions).toEqual({});
      expect(resolveLayoutDirection(current().presentation)).toBe('horizontal');
      await editor.undo();
      expect(current().presentation.layoutDirection).toBeUndefined();
      expect(current().presentation.nodePositions).toEqual(file.presentation.nodePositions);
    }
  });

  it('chooses an empty destination after the other automatic cards have reflowed', async () => {
    const { editor, current } = await setup();
    const file = structuredClone(current());
    const root = file.domain.project.rootNodeId;
    const nodes: [string, string, number][] = [
      ['a', root, 5],
      ['b', root, 3],
      ['c', 'a', 3],
      ['d', 'b', 7],
      ['e', 'c', 3],
      ['f', 'b', 5],
      ['g', 'd', 3],
      ['h', 'b', 3],
      ['i', root, 3],
      ['j', 'f', 5],
      ['k', root, 5],
      ['l', 'j', 7],
      ['m', 'i', 3],
    ];
    file.domain.nodes = [
      {
        id: root,
        title: root,
        parentId: null,
        startAt: '2026-03-01',
        blockIds: [],
        archived: false,
      },
      ...nodes.map(([id, parentId, day]) => ({
        id,
        title: id,
        parentId,
        startAt: `2026-03-0${day}`,
        blockIds: [],
        archived: false,
      })),
    ];
    file.domain.edges = nodes.map(([id, fromNodeId]) => ({
      id: `h-${id}`,
      fromNodeId,
      toNodeId: id,
      type: 'hierarchy',
    }));
    file.domain.blocks = [];
    file.domain.spines = [];
    file.domain.tasks = [];
    file.presentation = {
      nodePositions: {},
      branchScales: {},
      collapsedByDefault: [],
      savedSpineDisplay: null,
      layoutDirection: 'vertical',
    };
    await editor.importFile(file);
    const { reparentBranchEntry } = await import('../../apps/web/src/branch-editing');
    await editor.run(reparentBranchEntry(current(), 'b', 'm')!);
    expect(editor.getSnapshot().error).toBeNull();
    const graph = layout(current(), 'vertical');
    const moved = new Set(['b', 'd', 'f', 'g', 'h', 'j', 'l']);
    for (const a of graph.nodes.filter((node) => moved.has(node.id))) {
      for (const b of graph.nodes.filter((node) => !moved.has(node.id))) {
        expect(
          a.position.x + a.size.width <= b.position.x ||
            b.position.x + b.size.width <= a.position.x ||
            a.position.y + a.size.height <= b.position.y ||
            b.position.y + b.size.height <= a.position.y,
        ).toBe(true);
      }
    }
  });

  it('pastes a collapsed branch in one write, preserving descendant offsets and sizes in both layouts', async () => {
    const { reparentBranchEntry, restoreBranchLayoutEntry } =
      await import('../../apps/web/src/branch-editing');
    const { storage, editor, current } = await setup();
    const before = current();
    const writes = storage.writes;
    await editor.run(reparentBranchEntry(before, sourceId, targetId)!);
    expect(editor.getSnapshot().error).toBeNull();
    const after = current();
    expect(storage.writes).toBe(writes + 1);
    expect(after.revisions.semanticRevision).toBe(before.revisions.semanticRevision + 1);
    expect(after.revisions.presentationRevision).toBe(before.revisions.presentationRevision + 1);
    expect(after.revisions.fileWriteVersion).toBe(before.revisions.fileWriteVersion + 1);
    expect(after.domain.nodes.find((node) => node.id === sourceId)?.parentId).toBe(targetId);
    expect(after.domain.edges.find((edge) => edge.id === 'e_h_' + sourceId)?.fromNodeId).toBe(
      targetId,
    );
    expect(after.presentation.collapsedByDefault).toContain(sourceId);
    expect(after.presentation.collapsedByDefault).not.toContain(targetId);
    expect(() => validateDomain(after.domain)).not.toThrow();
    expect(after.domain.spines.find((spine) => spine.id === 'spn_demo_1')?.nodeIds).toContain(
      targetId,
    );
    for (const direction of ['horizontal', 'vertical'] as const) {
      const original = layout(before, direction);
      const moved = layout(after, direction);
      for (const id of subtree) {
        expect(moved.sizes[id]).toEqual(original.sizes[id]);
        expect(moved.positions[id].x - moved.positions[sourceId].x).toBeCloseTo(
          original.positions[id].x - original.positions[sourceId].x,
        );
        expect(moved.positions[id].y - moved.positions[sourceId].y).toBeCloseTo(
          original.positions[id].y - original.positions[sourceId].y,
        );
        expect(moved.locked).toContain(id);
      }
    }

    const groups = collectProjectTodos(after.domain);
    const targetGroup = groups.find((group) =>
      group.items.some((item) => item.nodeId === targetId),
    );
    expect(targetGroup?.items).toContainEqual(
      expect.objectContaining({
        nodeId: 'n_writing_template',
        title: 'Maintain bibliography',
        source: 'markdown',
      }),
    );
    expect(groups[0].items[0].id).toBe('tsk_inbox');

    await editor.undo();
    expect(current().domain).toEqual(before.domain);
    expect(current().revisions.presentationHash).toBe(before.revisions.presentationHash);
    await editor.redo();
    expect(current().domain).toEqual(after.domain);
    expect(current().revisions.presentationHash).toBe(after.revisions.presentationHash);
    expect(await storage.load(after.projectId)).toEqual(current());

    await editor.run(restoreBranchLayoutEntry(current(), sourceId, 'vertical')!);
    expect(layout(current(), 'vertical').locked).not.toContain('n_writing_template_latex');
    expect(layout(current(), 'horizontal').locked).toContain('n_writing_template_latex');
  });

  it('moves folded descendants and a selected companion in one undoable drag', async () => {
    const { editor, current } = await setup();
    const before = current();
    const direction = 'vertical';
    const graph = resolveVisualGraph(before.domain, before.presentation);
    const visibleRoot = graph.positions[sourceId];
    const companionId = before.domain.project.rootNodeId;
    const companionStart = graph.positions[companionId];
    const companionEnd = { x: companionStart.x + 31, y: companionStart.y - 52 };
    const beforeExpanded = layout(before, direction);
    editor.dragBegin(sourceId, visibleRoot, direction, [
      { id: companionId, position: companionStart },
    ]);
    editor.dragMove(sourceId, { x: visibleRoot.x + 31, y: visibleRoot.y - 52 }, direction, [
      { id: companionId, position: companionEnd },
    ]);
    await editor.dragEnd(direction);

    const moved = layout(current(), direction);
    expect(moved.positions[sourceId]).toEqual({ x: visibleRoot.x + 31, y: visibleRoot.y - 52 });
    expect(moved.positions[companionId]).toEqual(companionEnd);
    expect(current().revisions.presentationRevision).toBe(
      before.revisions.presentationRevision + 1,
    );
    for (const id of subtree) {
      expect(moved.positions[id].x - moved.positions[sourceId].x).toBeCloseTo(
        beforeExpanded.positions[id].x - beforeExpanded.positions[sourceId].x,
      );
      expect(moved.positions[id].y - moved.positions[sourceId].y).toBeCloseTo(
        beforeExpanded.positions[id].y - beforeExpanded.positions[sourceId].y,
      );
    }
    expect(current().revisions.semanticHash).toBe(before.revisions.semanticHash);
    await editor.undo();
    expect(current().revisions.presentationHash).toBe(before.revisions.presentationHash);
  });

  it('keeps topology, coordinates and history intact when paste, undo or redo cannot save', async () => {
    const { reparentBranchEntry } = await import('../../apps/web/src/branch-editing');
    const { storage, editor, current } = await setup();
    const before = current();
    const paste = reparentBranchEntry(before, sourceId, targetId)!;
    storage.fail = true;
    await editor.run(paste);
    expect(editor.getSnapshot()).toMatchObject({
      undoDepth: 0,
      redoDepth: 0,
      error: 'save failed',
    });
    expect(await storage.load(before.projectId)).toEqual(before);

    storage.fail = false;
    await editor.run(paste);
    const moved = current();
    storage.fail = true;
    await editor.undo();
    expect(editor.getSnapshot()).toMatchObject({
      undoDepth: 1,
      redoDepth: 0,
      error: 'save failed',
    });
    expect(await storage.load(before.projectId)).toEqual(moved);

    storage.fail = false;
    await editor.undo();
    const undone = current();
    storage.fail = true;
    await editor.redo();
    expect(editor.getSnapshot()).toMatchObject({
      undoDepth: 0,
      redoDepth: 1,
      error: 'save failed',
    });
    expect(await storage.load(before.projectId)).toEqual(undone);
  });

  it('detaches a subtree without losing descendant paths and rejects roots and cycles', async () => {
    const { reparentBranchEntry } = await import('../../apps/web/src/branch-editing');
    const { editor, current } = await setup();
    const before = current();
    expect(() => reparentBranchEntry(before, 'n_root', targetId)).toThrow();
    expect(() => reparentBranchEntry(before, 'deleted', targetId)).toThrow(/source/i);
    expect(() => reparentBranchEntry(before, sourceId, 'n_writing_template_latex')).toThrow();
    expect(() => reparentBranchEntry(before, sourceId, 'deleted')).toThrow();
    expect(reparentBranchEntry(before, sourceId, 'n_init')).toBeNull();
    await editor.run(reparentBranchEntry(before, sourceId, null)!);
    const detached = current();
    expect(detached.domain.nodes.find((node) => node.id === sourceId)?.parentId).toBeNull();
    expect(detached.domain.spines.find((spine) => spine.id === 'spn_demo_1')?.nodeIds[0]).toBe(
      sourceId,
    );
    expect(detached.domain.nodes).toHaveLength(before.domain.nodes.length);
    expect(detached.domain.tasks).toEqual(before.domain.tasks);
    await editor.undo();
    expect(current().domain).toEqual(before.domain);
  });

  it('改挂分支时以侧向入口接入（role=branch），并保持内部角色，撤销完整还原', async () => {
    const { reparentBranchEntry } = await import('../../apps/web/src/branch-editing');
    const storage = new MemoryStorageAdapter();
    const editor = await EditorController.bootstrap(storage, () => {
      const file = createDemoBranchFile();
      const internalCont = file.domain.edges.find((e) => e.toNodeId === 'n_writing_template');
      if (internalCont) internalCont.role = 'continuation';
      const internalLeaf = file.domain.edges.find((e) => e.toNodeId === 'n_writing_template_latex');
      if (internalLeaf) internalLeaf.role = 'leaf';
      return file;
    });

    const current = () => editor.getSnapshot().file;

    // Reparent sourceId (n_writing_init) to targetId (n_analysis)
    const entry = reparentBranchEntry(current(), sourceId, targetId)!;
    await editor.run(entry);

    const moved = current();
    const incomingEdge = moved.domain.edges.find(
      (e) => e.type === 'hierarchy' && e.toNodeId === sourceId,
    );
    expect(incomingEdge?.fromNodeId).toBe(targetId);
    expect(incomingEdge?.role).toBe('branch'); // 侧向入口接入，避免占用目标已有的延续位置

    // Verify internal roles are preserved
    const movedInternalCont = moved.domain.edges.find((e) => e.toNodeId === 'n_writing_template');
    expect(movedInternalCont?.role).toBe('continuation');
    const movedInternalLeaf = moved.domain.edges.find(
      (e) => e.toNodeId === 'n_writing_template_latex',
    );
    expect(movedInternalLeaf?.role).toBe('leaf');

    // Undo restores previous hierarchy edge and role
    await editor.undo();
    const restored = current();
    const restoredIncoming = restored.domain.edges.find(
      (e) => e.type === 'hierarchy' && e.toNodeId === sourceId,
    );
    expect(restoredIncoming?.fromNodeId).toBe('n_init');
    expect(restoredIncoming?.role).toBeUndefined();
  });
});
