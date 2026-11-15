import { describe, expect, it } from 'vitest';
import { BranchFileSchema } from '@workspacetree/schema';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createDemoBranchFile } from '../fixtures/phase1-demo';
import { EditorController } from '../../apps/web/src/editor';
import { getNodeNote, setNodeNoteEntry } from '../../apps/web/src/history';
import { collectProjectTodos, filterProjectTodos } from '../../apps/web/src/project-todos';
import { saveTodoEntry } from '../../apps/web/src/todo-editing';

async function setup() {
  const storage = new MemoryStorageAdapter();
  const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
  return { editor, file: () => editor.getSnapshot().file, storage };
}

describe('TODO editor', () => {
  it('saves an untitled unassigned item and atomically creates its dated branch node', async () => {
    const { editor, file, storage } = await setup();
    await editor.run(
      saveTodoEntry(file(), null, {
        title: '',
        status: 'pending',
        tags: ['实验'],
        scheduledAt: '2026-11-19',
        target: { mode: 'inbox' },
      }),
    );
    const inbox = filterProjectTodos(collectProjectTodos(file().domain), 'inbox', 'pending');
    const item = inbox[0]?.items[0];
    expect(item).toMatchObject({ nodeId: null, title: '', scheduledAt: '2026-11-19' });
    const before = file().revisions.semanticHash;
    await editor.run(
      saveTodoEntry(file(), item, {
        title: '核对实验数据',
        status: 'done',
        tags: ['实验'],
        scheduledAt: '2026-11-20',
        target: { mode: 'new', parentId: 'n_exp' },
      }),
    );
    expect(editor.getSnapshot().error).toBeNull();
    const saved = BranchFileSchema.parse(await storage.load(file().projectId));
    const task = saved.domain.tasks.find((task) => task.id === item.id)!;
    expect(task).toMatchObject({ title: '核对实验数据', done: true, scheduledAt: '2026-11-20' });
    expect(saved.domain.nodes.find((node) => node.id === task.nodeId)).toMatchObject({
      parentId: 'n_exp',
      title: '核对实验数据',
      startAt: '2026-11-20',
    });
    expect(saved.domain.edges).toContainEqual(
      expect.objectContaining({ type: 'hierarchy', fromNodeId: 'n_exp', toNodeId: task.nodeId }),
    );
    await editor.undo();
    expect(file().revisions.semanticHash).toBe(before);
    await editor.redo();
    expect(file().revisions.semanticHash).toBe(saved.revisions.semanticHash);
  });

  it('edits a Markdown line in place, moves it to an existing node, and restores both notes on undo', async () => {
    const { editor, file } = await setup();
    const sourceId = 'n_exp_program';
    const targetId = 'n_analysis_summary';
    const before = 'Keep this\r\n  1. [?] Check data #质控\r\nKeep this too';
    await editor.run(setNodeNoteEntry(file().domain, sourceId, before));
    const sourceItem = () =>
      collectProjectTodos(file().domain)
        .flatMap((group) => group.items)
        .find((item) => item.source === 'markdown' && item.nodeId === sourceId)!;
    const draft = {
      title: 'Check more data',
      status: 'done',
      tags: ['质控'],
      scheduledAt: '2026-11-21',
    } as const;
    await editor.run(
      saveTodoEntry(file(), sourceItem(), {
        ...draft,
        target: { mode: 'existing', nodeId: sourceId },
      }),
    );
    const updated = 'Keep this\r\n  1. [x] Check more data #质控 📅 2026-11-21\r\nKeep this too';
    expect(getNodeNote(file().domain, sourceId)).toBe(updated);
    expect(sourceItem()).toMatchObject({ scheduledAt: '2026-11-21', title: 'Check more data' });
    const targetBefore = getNodeNote(file().domain, targetId);
    await editor.run(
      saveTodoEntry(file(), sourceItem(), {
        ...draft,
        target: { mode: 'existing', nodeId: targetId },
      }),
    );
    expect(getNodeNote(file().domain, sourceId)).toBe('Keep this\r\nKeep this too');
    expect(getNodeNote(file().domain, targetId)).toBe(
      targetBefore + '\n- [x] Check more data #质控 📅 2026-11-21',
    );
    await editor.undo();
    expect(getNodeNote(file().domain, sourceId)).toBe(updated);
    expect(getNodeNote(file().domain, targetId)).toBe(targetBefore);
  });

  it('rejects a stale Markdown selection and invalid assignment without saving a partial change', async () => {
    const { editor, file } = await setup();
    const source = collectProjectTodos(file().domain)
      .flatMap((group) => group.items)
      .find((item) => item.source === 'markdown' && item.nodeId === 'n_root')!;
    await editor.run(setNodeNoteEntry(file().domain, 'n_root', '- [ ] A different item'));
    const before = file().revisions.semanticHash;
    const draft = { title: 'Renamed', status: 'open', tags: [], scheduledAt: null } as const;
    expect(() => saveTodoEntry(file(), source, { ...draft, target: { mode: 'inbox' } })).toThrow();
    await editor.run(
      saveTodoEntry(file(), null, {
        ...draft,
        target: { mode: 'existing', nodeId: 'n_missing' },
      }),
    );
    expect(editor.getSnapshot().error).toBeTruthy();
    expect(file().revisions.semanticHash).toBe(before);
  });

  it('moves a Markdown item to a note ending inside a code fence without losing existing text', async () => {
    const { editor, file } = await setup();
    const destination = 'n_exp_program';
    const previousNote = '原笔记\r\n~~~md\r\n- [ ] Example';
    await editor.run(setNodeNoteEntry(file().domain, destination, previousNote));
    const source = collectProjectTodos(file().domain)
      .flatMap((group) => group.items)
      .find((item) => item.source === 'markdown' && item.nodeId === 'n_root')!;
    await editor.run(
      saveTodoEntry(file(), source, {
        title: 'Moved',
        status: 'open',
        tags: [],
        scheduledAt: null,
        target: { mode: 'existing', nodeId: destination },
      }),
    );
    expect(getNodeNote(file().domain, destination)).toBe('- [ ] Moved\r\n\r\n' + previousNote);
    await editor.undo();
    expect(getNodeNote(file().domain, destination)).toBe(previousNote);
  });
});
