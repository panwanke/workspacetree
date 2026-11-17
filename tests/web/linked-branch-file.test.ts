import { describe, expect, it } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import type { BranchFile } from '@workspacetree/schema';
import { EditorController } from '../../apps/web/src/editor';
import { renameNodeEntry } from '../../apps/web/src/history';
import { LinkedBranchFile } from '../../apps/web/src/linked-branch-file';

function diskFixture() {
  const original = createMinimalBranchFile();
  let content = JSON.stringify(original);
  let beforePublish: (() => void) | undefined;
  const handle = {
    name: 'test.branch.json',
    getFile: async () => new File([content], 'test.branch.json'),
    createWritable: async () => {
      let staged = '';
      return {
        write: async (value: string) => {
          staged = value;
          beforePublish?.();
        },
        close: async () => {
          content = staged;
        },
        abort: async () => {
          staged = '';
        },
      };
    },
  };
  return {
    original,
    handle,
    read: () => content,
    write: (value: string) => {
      content = value;
    },
    onStaged: (fn: () => void) => {
      beforePublish = fn;
    },
  };
}

describe('linked .branch.json', () => {
  it('writes editor changes to the source file and reads external changes with unchanged revisions', async () => {
    const disk = diskFixture();
    let backup: BranchFile | undefined;
    const linked = await LinkedBranchFile.open(disk.handle, async (file) => {
      backup = file;
    });
    const editor = new EditorController(linked, linked.snapshot);
    await editor.run(renameNodeEntry(linked.snapshot.domain, 'n_child', 'From the web'));
    const saved = JSON.parse(disk.read());
    expect(saved.domain.nodes[1].title).toBe('From the web');
    expect(backup).toEqual(saved);
    expect(editor.getSnapshot().undoDepth).toBe(1);

    saved.domain.nodes[1].title = 'From disk';
    disk.write(JSON.stringify(saved));
    await editor.refreshFromFile(() => linked.refresh(() => true));
    expect(editor.getSnapshot().file.domain.nodes[1].title).toBe('From disk');
    expect(backup?.domain.nodes[1].title).toBe('From disk');
    expect(editor.getSnapshot().undoDepth).toBe(0);

    await editor.run(renameNodeEntry(linked.snapshot.domain, 'n_child', 'Back to the web'));
    expect(JSON.parse(disk.read()).domain.nodes[1].title).toBe('Back to the web');
  });

  it('repairs the database on retry if the file was saved but the database write failed', async () => {
    const disk = diskFixture();
    let denied = false;
    let backup: BranchFile | undefined;
    const linked = await LinkedBranchFile.open(disk.handle, async (file) => {
      if (denied) throw new Error('database unavailable');
      backup = file;
    });
    const editor = new EditorController(linked, linked.snapshot);
    denied = true;
    await expect(
      editor.runFromLatest(({ domain }) => renameNodeEntry(domain, 'n_child', 'Saved to disk')),
    ).rejects.toThrow(/database unavailable/);
    expect(JSON.parse(disk.read()).domain.nodes[1].title).toBe('Saved to disk');
    expect(backup?.domain.nodes[1].title).not.toBe('Saved to disk');

    denied = false;
    await editor.saveCurrent();
    expect(editor.getSnapshot().file.domain.nodes[1].title).toBe('Saved to disk');
    expect(backup).toEqual(JSON.parse(disk.read()));
  });

  it.each(['before saving', 'while staging'])('guards an external write %s', async (timing) => {
    const disk = diskFixture();
    const linked = await LinkedBranchFile.open(disk.handle, async () => {});
    const editor = new EditorController(linked, linked.snapshot);
    const external = structuredClone(disk.original);
    external.domain.nodes[1].title = 'External edit';
    const editDisk = () => disk.write(JSON.stringify(external));
    if (timing === 'before saving') editDisk();
    else disk.onStaged(editDisk);

    await expect(
      editor.runFromLatest(({ domain }) => renameNodeEntry(domain, 'n_child', 'Web edit')),
    ).rejects.toThrow(/changed on disk/i);
    expect(disk.read()).toBe(JSON.stringify(external));
    expect(editor.getSnapshot().undoDepth).toBe(0);
    await editor.refreshFromFile(() => linked.refresh(() => true));
    expect(editor.getSnapshot().file.domain.nodes[1].title).toBe('External edit');
  });

  it('keeps the last valid snapshot when an external editor leaves incomplete JSON', async () => {
    const disk = diskFixture();
    const linked = await LinkedBranchFile.open(disk.handle, async () => {});
    const editor = new EditorController(linked, linked.snapshot);
    disk.write('{');
    await expect(editor.refreshFromFile(() => linked.refresh(() => true))).rejects.toThrow(
      /test\.branch\.json/,
    );
    expect(editor.getSnapshot().file).toEqual(linked.snapshot);
    expect(disk.read()).toBe('{');
  });
});
