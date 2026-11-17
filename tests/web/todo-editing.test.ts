import { describe, expect, it } from 'vitest';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { createDemoBranchFile } from '../fixtures/phase1-demo';
import { EditorController } from '../../apps/web/src/editor';
import { getNodeNote, replaceDomainEntry, setNodeNoteEntry } from '../../apps/web/src/history';
import { collectProjectTodos, filterProjectTodos } from '../../apps/web/src/project-todos';
import { deleteTodoEntry, saveTodoEntry, updateTodoEntry } from '../../apps/web/src/todo-editing';

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
    expect(saved.domain.tasks.some((task) => task.id === item.id)).toBe(false);
    const created = saved.domain.nodes.find((node) => node.title === '核对实验数据')!;
    expect(getNodeNote(saved.domain, created.id)).toContain(
      '- [x] 核对实验数据 #实验 📅 2026-11-20',
    );
    expect(created).toMatchObject({
      parentId: 'n_exp',
      title: '核对实验数据',
      startAt: '2026-11-20',
    });
    expect(saved.domain.edges).toContainEqual(
      expect.objectContaining({ type: 'hierarchy', fromNodeId: 'n_exp', toNodeId: created.id }),
    );
    await editor.undo();
    expect(file().revisions.semanticHash).toBe(before);
    await editor.redo();
    expect(file().revisions.semanticHash).toBe(saved.revisions.semanticHash);
  });

  it('creates a node TODO in its note and restores the absent note on undo', async () => {
    const { editor, file } = await setup();
    const nodeId = 'n_init';
    await editor.run(setNodeNoteEntry(file().domain, nodeId, ''));
    const before = file().domain;
    await editor.run(
      saveTodoEntry(file(), null, {
        title: 'Write here',
        status: 'open',
        tags: [],
        scheduledAt: null,
        target: { mode: 'existing', nodeId },
      }),
    );
    expect(getNodeNote(file().domain, nodeId)).toBe('- [ ] Write here');
    expect(file().domain.tasks).toEqual(before.tasks);
    await editor.undo();
    expect(file().domain).toEqual(before);
  });

  it('converts an edited legacy node task while preserving its data and original position on undo', async () => {
    const { editor, file } = await setup();
    const before = file().domain;
    const legacy = collectProjectTodos(before)
      .flatMap((group) => group.items)
      .find((item) => item.source === 'task' && item.nodeId === 'n_writing_template')!;
    await editor.run(
      saveTodoEntry(
        file(),
        legacy,
        {
          title: legacy.title,
          status: 'done',
          tags: ['writing'],
          scheduledAt: '2026-11-21',
          target: { mode: 'existing', nodeId: legacy.nodeId! },
        },
        '2026-11-17',
      ),
    );
    expect(file().domain.tasks.some((task) => task.id === legacy.id)).toBe(false);
    expect(getNodeNote(file().domain, legacy.nodeId!)).toContain('📅 2026-11-21');
    await editor.undo();
    expect(file().domain).toEqual(before);
  });

  it('edits a Markdown line in place, moves it to an existing node, and restores both notes on undo', async () => {
    const { editor, file } = await setup();
    const sourceId = 'n_exp_program';
    const targetId = 'n_analysis_summary';
    const before = 'Keep this\r\n  1. [?] Check data #质控\r\n## Keep this too';
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
      saveTodoEntry(
        file(),
        sourceItem(),
        {
          ...draft,
          target: { mode: 'existing', nodeId: sourceId },
        },
        '2026-11-17',
      ),
    );
    const updated =
      'Keep this\r\n  1. [x] Check more data #质控 📅 2026-11-21 ✅ 2026-11-17\r\n## Keep this too';
    expect(getNodeNote(file().domain, sourceId)).toBe(updated);
    expect(sourceItem()).toMatchObject({ scheduledAt: '2026-11-21', title: 'Check more data' });
    const targetBefore = getNodeNote(file().domain, targetId);
    await editor.run(
      saveTodoEntry(file(), sourceItem(), {
        ...draft,
        target: { mode: 'existing', nodeId: targetId },
      }),
    );
    expect(getNodeNote(file().domain, sourceId)).toBe('Keep this\r\n## Keep this too');
    const separator = targetBefore.includes('\r\n') ? '\r\n\r\n' : '\n\n';
    expect(getNodeNote(file().domain, targetId)).toBe(
      '- [x] Check more data #质控 📅 2026-11-21 ✅ 2026-11-17' + separator + targetBefore,
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

  it('removes a parent TODO while retaining its text, continuation, and child task', async () => {
    const { editor, file } = await setup();
    const nodeId = 'n_root';
    const before =
      '- [ ] Parent 📅 2026-11-21\r\n  Keep the explanation.\r\n  - [?] Child\r\n- [ ] Sibling';
    await editor.run(setNodeNoteEntry(file().domain, nodeId, before));
    const parent = collectProjectTodos(file().domain)
      .flatMap((group) => group.items)
      .find((item) => item.title === 'Parent')!;
    await editor.run(deleteTodoEntry(file(), parent));
    expect(getNodeNote(file().domain, nodeId)).toBe(
      '- Parent\r\n  Keep the explanation.\r\n  - [?] Child\r\n- [ ] Sibling',
    );
    await editor.undo();
    expect(getNodeNote(file().domain, nodeId)).toBe(before);
  });

  it('serializes rapid checkmarks in the same note and catches stale identical lines', async () => {
    const { editor, file } = await setup();
    const nodeId = 'n_root';
    await editor.run(setNodeNoteEntry(file().domain, nodeId, '- [ ] One\n- [ ] Two\n- [ ] One'));
    const items = collectProjectTodos(file().domain)
      .flatMap((group) => group.items)
      .filter((item) => item.source === 'markdown' && item.nodeId === nodeId);
    const check = (i: number) =>
      editor.runFromLatest((snapshot) =>
        updateTodoEntry(snapshot, items[i], { status: 'done' }, '2026-11-17'),
      );
    await Promise.all([check(0), check(1)]);
    expect(getNodeNote(file().domain, nodeId)).toBe(
      '- [x] One ✅ 2026-11-17\n- [x] Two ✅ 2026-11-17\n- [ ] One',
    );
    await expect(check(2)).rejects.toThrow('原笔记已变化');
    expect(getNodeNote(file().domain, nodeId)).toContain('\n- [ ] One');
  });

  it('keeps completion and scheduled dates distinct for an inbox TODO after reload', async () => {
    const { editor, file, storage } = await setup();
    await editor.run(
      saveTodoEntry(file(), null, {
        title: 'Inbox date',
        status: 'open',
        scheduledAt: '2026-11-21',
        tags: [],
        target: { mode: 'inbox' },
      }),
    );
    const load = async () => BranchFileSchema.parse(await storage.load(file().projectId));
    const inboxItem = (domain: ReturnType<typeof file>['domain']) =>
      collectProjectTodos(domain)[0].items.find((item) => item.title === 'Inbox date')!;
    await editor.run(
      updateTodoEntry(file(), inboxItem(file().domain), { status: 'done' }, '2026-11-17'),
    );
    expect(inboxItem((await load()).domain)).toMatchObject({
      status: 'done',
      scheduledAt: '2026-11-21',
      completedAt: '2026-11-17',
    });
    await editor.run(updateTodoEntry(file(), inboxItem(file().domain), { status: 'open' }));
    expect(inboxItem((await load()).domain)).toMatchObject({
      status: 'open',
      scheduledAt: '2026-11-21',
      completedAt: undefined,
    });
  });

  it('rejects a prepared workspace replacement after a queued TODO write changes its base', async () => {
    const { editor, file } = await setup();
    const original = file().domain;
    const next = structuredClone(original);
    next.project.title = 'Prepared paste';
    const replacement = replaceDomainEntry(original, next);
    const creation = editor.runFromLatest((snapshot) =>
      saveTodoEntry(snapshot, null, {
        title: 'Concurrent task',
        status: 'open',
        tags: [],
        scheduledAt: null,
        target: { mode: 'existing', nodeId: 'n_root' },
      }),
    );
    await Promise.all([creation, editor.run(replacement)]);
    expect(getNodeNote(file().domain, 'n_root')).toContain('Concurrent task');
    expect(editor.getSnapshot().error).toBeTruthy();
  });

  it('preserves literal title metadata during the legacy task Markdown round trip', async () => {
    const { editor, file } = await setup();
    const title = 'Issue #123 📅 2026-11-21';
    await editor.run(
      saveTodoEntry(file(), null, {
        title,
        status: 'open',
        tags: ['study'],
        scheduledAt: null,
        target: { mode: 'inbox' },
      }),
    );
    const inbox = collectProjectTodos(file().domain)[0].items.find((item) => item.title === title)!;
    await editor.run(
      updateTodoEntry(file(), inbox, { target: { mode: 'existing', nodeId: 'n_root' } }),
    );
    const assigned = collectProjectTodos(file().domain)[0].items.find((item) =>
      item.todoTags.includes('study'),
    )!;
    expect(assigned).toMatchObject({
      source: 'markdown',
      todoTags: ['study'],
      scheduledAt: undefined,
    });
    await editor.run(updateTodoEntry(file(), assigned, { target: { mode: 'inbox' } }));
    expect(collectProjectTodos(file().domain)[0].items.at(0)?.title).toBe(title);
  });

  it('places newly added TODOs at the top of their note and the inbox', async () => {
    const { editor, file } = await setup();
    const nodeId = 'n_init';
    await editor.run(setNodeNoteEntry(file().domain, nodeId, '- [ ] Existing'));
    await editor.run(
      saveTodoEntry(file(), null, {
        title: 'Fresh note item',
        status: 'open',
        tags: [],
        scheduledAt: null,
        target: { mode: 'existing', nodeId },
      }),
    );
    expect(getNodeNote(file().domain, nodeId)).toBe('- [ ] Fresh note item\n\n- [ ] Existing');
    await editor.run(
      saveTodoEntry(file(), null, {
        title: 'Fresh inbox item',
        status: 'open',
        tags: [],
        scheduledAt: null,
        target: { mode: 'inbox' },
      }),
    );
    expect(file().domain.tasks[0]).toMatchObject({ title: 'Fresh inbox item' });
    expect(collectProjectTodos(file().domain)[0].items[0]).toMatchObject({
      title: 'Fresh inbox item',
    });
  });

  it('can undo a successful deletion even when a subsequent storage read would fail', async () => {
    class ReadAfterWriteFailure extends MemoryStorageAdapter {
      blockNextRead = false;
      failAfterSave = false;

      override async load(projectId: string) {
        if (this.blockNextRead) throw new Error('Temporary storage read failure');
        return super.load(projectId);
      }

      override async save(file: BranchFile) {
        await super.save(file);
        this.blockNextRead = this.failAfterSave;
      }
    }
    const storage = new ReadAfterWriteFailure();
    const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
    const before = editor.getSnapshot().file;
    const todo = collectProjectTodos(before.domain).flatMap((group) => group.items)[0];
    storage.failAfterSave = true;
    await editor.run(deleteTodoEntry(before, todo));
    expect(editor.getSnapshot()).toMatchObject({ error: null, undoDepth: 1 });
    storage.blockNextRead = false;
    storage.failAfterSave = false;
    await editor.undo();
    expect(editor.getSnapshot().file.domain).toEqual(before.domain);
  });
});
