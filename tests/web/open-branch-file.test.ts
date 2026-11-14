import { describe, expect, it } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { computeFileHash, computeSemanticHash, validateDomain } from '@workspacetree/core';
import type { BranchFile } from '@workspacetree/schema';
import { BranchFileSchema } from '@workspacetree/schema';
import { resolveVisualGraph } from '@workspacetree/layout';
import { createMemoryKeyValueStore, IdbJsonStorageAdapter } from '@workspacetree/storage';
import { EditorController } from '../../apps/web/src/editor';
import { createNodeEntry, renameNodeEntry } from '../../apps/web/src/history';
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

  it('旧项目文件无 role 时成功打开并往返保存，保留历史尺寸和坐标，并正确推导延续与分支角色', async () => {
    const storage = new IdbJsonStorageAdapter(createMemoryKeyValueStore());
    const file = createMinimalBranchFile();
    // 构造旧文件场景：添加同级节点，所有边均不带 role，并设置自定义历史尺寸与坐标
    const rootId = file.domain.project.rootNodeId;
    file.domain.nodes.push(
      { id: 'n_child_b', title: 'Child B', parentId: rootId, blockIds: [], archived: false },
      { id: 'n_sub_b', title: 'Sub B', parentId: 'n_child_b', blockIds: [], archived: false },
    );
    file.domain.edges = [
      { id: 'e_1', fromNodeId: rootId, toNodeId: 'n_child', type: 'hierarchy' },
      { id: 'e_2', fromNodeId: rootId, toNodeId: 'n_child_b', type: 'hierarchy' },
      { id: 'e_3', fromNodeId: 'n_child_b', toNodeId: 'n_sub_b', type: 'hierarchy' },
    ];
    for (const edge of file.domain.edges) {
      delete (edge as any).role;
    }
    file.presentation.nodeSizes = {
      [rootId]: { width: 260, height: 110 },
      n_child: { width: 200, height: 80 },
    };
    file.presentation.nodePositions = {
      n_child: { x: 400, y: 300 },
    };
    file.revisions.semanticHash = computeSemanticHash(file.domain);
    file.revisions.fileHash = computeFileHash(file);

    // 1. 打开旧文件
    const opened = await openBranchFile(branchInput(file), storage);
    expect(opened.readOnly).toBe(false);
    expect(opened.file.presentation.nodeSizes?.[rootId]).toEqual({ width: 260, height: 110 });
    expect(opened.file.presentation.nodePositions.n_child).toEqual({ x: 400, y: 300 });

    // 2. 视觉布局自动推导延续与分支角色（n_child 为延续，n_child_b 有孩子被推导为分支）
    const graph = resolveVisualGraph(opened.file.domain, opened.file.presentation);
    expect(graph.positions.n_child).toEqual({ x: 400, y: 300 }); // 保留历史手动坐标
    expect(graph.sizes[rootId]).toEqual({ width: 260, height: 110 }); // 保留历史尺寸
    const edgeB = graph.edges.find((e) => e.targetId === 'n_child_b');
    expect(edgeB?.color).toBeDefined(); // 分支有色

    // 3. 在旧项目上新建节点并往返保存
    const editor = await EditorController.bootstrap(storage, () => opened.file);
    const newId = 'n_new_leaf';
    const entry = createNodeEntry(
      newId,
      'New Leaf',
      'n_child',
      'e_new_leaf',
      'leaf',
      editor.getSnapshot().file.presentation,
    );
    await editor.run(entry);
    const modified = editor.getSnapshot().file;

    // 新建节点继承父节点 85% 尺寸：Math.max(140, Math.round(200 * 0.85)) = 170, Math.max(44, Math.round(80 * 0.85)) = 68
    expect(modified.presentation.nodeSizes?.[newId]).toEqual({ width: 170, height: 68 });
    const newEdge = modified.domain.edges.find((e) => e.toNodeId === newId);
    expect(newEdge?.role).toBe('leaf');

    // 4. 再次导出并重新载入（往返验证）
    const exportedRaw = JSON.stringify(modified);
    const reloaded = await openBranchFile(
      { name: 'roundtrip.branch.json', text: async () => exportedRaw },
      new IdbJsonStorageAdapter(createMemoryKeyValueStore()),
    );
    expect(reloaded.readOnly).toBe(false);
    expect(BranchFileSchema.safeParse(reloaded.file).success).toBe(true);
    expect(() => validateDomain(reloaded.file.domain)).not.toThrow();
    expect(reloaded.file.presentation.nodeSizes?.[rootId]).toEqual({ width: 260, height: 110 });
    expect(reloaded.file.presentation.nodeSizes?.[newId]).toEqual({ width: 170, height: 68 });
    expect(reloaded.file.domain.edges.find((e) => e.toNodeId === newId)?.role).toBe('leaf');
  });
});
