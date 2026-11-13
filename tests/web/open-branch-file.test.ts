import { describe, expect, it } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { computeFileHash, computeSemanticHash } from '@workspacetree/core';
import type { BranchFile } from '@workspacetree/schema';
import { createMemoryKeyValueStore, IdbJsonStorageAdapter } from '@workspacetree/storage';
import { EditorController } from '../../apps/web/src/editor';
import { renameNodeEntry } from '../../apps/web/src/history';
import { openBranchFile } from '../../apps/web/src/open-branch-file';

function branchInput(file: BranchFile) {
  return { name: 'test.branch.json', text: async () => JSON.stringify(file) };
}

describe('open a branch file', () => {
  it('stores consistent hashes when a newly opened file has stale revision hashes', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const file = createMinimalBranchFile();
    file.domain.project.title = 'Edited externally';
    const result = await openBranchFile(branchInput(file), storage);
    expect(result.readOnly).toBe(false);
    expect(result.file.revisions.semanticHash).toBe(computeSemanticHash(file.domain));
    expect(result.file.revisions.fileHash).toBe(computeFileHash(result.file));
    expect(await storage.load(file.projectId)).toEqual(result.file);
  });

  it('reuses the persisted snapshot and previews a newer divergent file without overwriting', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const file = createMinimalBranchFile();

    const first = await openBranchFile(branchInput(file), storage);
    expect(first.readOnly).toBe(false);
    expect(await openBranchFile(branchInput(file), storage)).toMatchObject({
      readOnly: false,
      snapshotHash: first.snapshotHash,
    });

    const divergent = structuredClone(file);
    divergent.activeBranch = 'other';
    divergent.revisions.fileWriteVersion += 10;
    divergent.domain.project.title = 'Conflicting branch';
    const opened = await openBranchFile(branchInput(divergent), storage);

    expect(opened).toMatchObject({
      readOnly: true,
      file: { activeBranch: 'other', domain: { project: { title: 'Conflicting branch' } } },
    });
    expect(await storage.load(file.projectId)).toEqual(file);
  });

  it('uses the effective layout direction when identifying snapshots', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const file = createMinimalBranchFile();
    const first = await openBranchFile(branchInput(file), storage);
    const vertical = structuredClone(file);
    vertical.presentation.layoutDirection = 'vertical';
    expect(await openBranchFile(branchInput(vertical), storage)).toMatchObject({
      readOnly: false,
      snapshotHash: first.snapshotHash,
    });
    const horizontal = structuredClone(file);
    horizontal.presentation.layoutDirection = 'horizontal';
    expect(await openBranchFile(branchInput(horizontal), storage)).toMatchObject({
      readOnly: true,
    });
  });

  it('preserves the pending journal of a project being created', async () => {
    const store = createMemoryKeyValueStore();
    const original = new IdbJsonStorageAdapter(store, { crash: { failAt: 'intent' } });
    const opener = new IdbJsonStorageAdapter(store);
    const file = createMinimalBranchFile();
    const divergent = structuredClone(file);
    divergent.revisions.fileWriteVersion += 10;
    await expect(original.save(file)).rejects.toThrow(/simulated crash/);

    await expect(openBranchFile(branchInput(divergent), opener)).rejects.toThrow(/concurrent/);
    expect(await opener.load(file.projectId)).toEqual(file);
    expect(await openBranchFile(branchInput(divergent), opener)).toMatchObject({ readOnly: true });
  });

  it('rejects malformed files and invalid graph references before persisting', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const file = createMinimalBranchFile();
    const invalid = structuredClone(file);
    invalid.domain.nodes[1].parentId = 'missing';

    await expect(
      openBranchFile({ name: 'broken.branch.json', text: async () => '{' }, storage),
    ).rejects.toThrow(/broken\.branch\.json/);
    await expect(openBranchFile(branchInput(invalid), storage)).rejects.toThrow(/missing node/);
    expect(await storage.load(file.projectId)).toBeNull();
  });

  it('keeps only one editable winner when two versions are opened concurrently', async () => {
    const store = createMemoryKeyValueStore();
    const first = new IdbJsonStorageAdapter(store, { queueKey: 'file-open-first' });
    const second = new IdbJsonStorageAdapter(store, { queueKey: 'file-open-second' });
    const file = createMinimalBranchFile();
    const divergent = structuredClone(file);
    divergent.activeBranch = 'other';
    divergent.revisions.fileWriteVersion += 1;

    const results = await Promise.all([
      openBranchFile(branchInput(file), first),
      openBranchFile(branchInput(divergent), second),
    ]);
    expect(results.filter((item) => !item.readOnly)).toHaveLength(1);
    expect(await first.load(file.projectId)).toEqual(results.find((item) => !item.readOnly)?.file);
  });

  it('blocks edits in the preview controller while allowing temporary expansion', async () => {
    const file = createMinimalBranchFile();
    file.presentation.collapsedByDefault = ['n_root'];
    const preview = EditorController.preview(file);

    expect(preview.isReadOnly).toBe(true);
    await preview.run(renameNodeEntry(file.domain, 'n_child', 'Rejected'));
    expect(preview.getSnapshot().error).toMatch(/只读|read-only/i);
    expect(preview.getSnapshot().undoDepth).toBe(0);

    preview.expandPreviewAncestors(['n_root']);
    preview.expandPreviewAncestors(['n_root']);
    expect(preview.getSnapshot().previewExpandedNodeIds).toEqual(['n_root']);
    expect(preview.getSnapshot().file).toEqual(file);
  });
});
