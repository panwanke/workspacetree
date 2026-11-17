import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { resolveVisualGraph } from '@workspacetree/layout';
import { createDemoBranchFile } from '../fixtures/phase1-demo';
import { EditorController } from '../../apps/web/src/editor';
import {
  orientConnection,
  reconnectEdgeEntry,
  saveRelationEntry,
  setEdgeNoteEntry,
} from '../../apps/web/src/edge-editing';
import {
  addEdgeEntry,
  removeEdgeEntry,
  setEdgeStyleEntry,
  setEdgeStylesEntry,
} from '../../apps/web/src/history';

async function setup() {
  const storage = new MemoryStorageAdapter();
  const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
  const domain = () => editor.getSnapshot().file.domain;
  const edge = domain().edges.find((item) => item.type !== 'hierarchy')!;
  return { storage, editor, domain, edge };
}

describe('canvas edge editing', () => {
  it('keeps the drag start as source even when Loose mode swaps the connection endpoints', () => {
    // 从 A 拖到 B 通常得到 A→B
    expect(orientConnection({ source: 'A', target: 'B' }, 'A')).toEqual({
      fromNodeId: 'A',
      toNodeId: 'B',
    });
    // 命中 A 的 target handle 时 React Flow 会把连接重排为 B→A，需按起点校正回 A→B
    expect(orientConnection({ source: 'B', target: 'A' }, 'A')).toEqual({
      fromNodeId: 'A',
      toNodeId: 'B',
    });
    // 起点是终点节点时应尊重原始 connection（例如程序化触发，无明确拖拽起点）
    expect(orientConnection({ source: 'B', target: 'A' }, 'B')).toEqual({
      fromNodeId: 'B',
      toNodeId: 'A',
    });
    expect(orientConnection({ source: 'A', target: 'B' }, null)).toEqual({
      fromNodeId: 'A',
      toNodeId: 'B',
    });
  });

  it('edits both endpoints, type and note in one undoable change', async () => {
    const { editor, domain, edge } = await setup();
    const before = domain().edges;
    const [source, target] = domain().nodes.filter(
      (node) => node.id !== edge.fromNodeId && node.id !== edge.toNodeId,
    );
    const changes = {
      fromNodeId: source.id,
      toNodeId: target.id,
      type: 'custom' as const,
      note: 'new note',
    };
    await editor.runFromLatest(({ domain }) => saveRelationEntry(domain, changes, edge.id));
    expect(domain().edges.find((item) => item.id === edge.id)).toMatchObject(changes);
    expect(editor.getSnapshot().undoDepth).toBe(1);
    await editor.undo();
    expect(domain().edges).toEqual(before);
  });

  it('rejects duplicate relation creation while allowing different relation types', async () => {
    const { editor, edge } = await setup();
    if (edge.type === 'hierarchy') throw new Error('Expected a relation');
    const relation = { ...edge, type: edge.type };
    await expect(
      editor.runFromLatest(({ domain }) => saveRelationEntry(domain, relation)),
    ).rejects.toThrow(/already exists/i);
    expect(editor.getSnapshot().error).toMatch(/already exists/i);
    expect(editor.getSnapshot().undoDepth).toBe(0);
    const type = edge.type === 'custom' ? 'reference' : 'custom';
    await editor.runFromLatest(({ domain }) => saveRelationEntry(domain, { ...edge, type }));
    expect(editor.getSnapshot()).toMatchObject({ error: null, undoDepth: 1 });
  });
  it('edits one original edge without changing the other edge in a collapsed projection', async () => {
    const { editor, domain } = await setup();
    const file = structuredClone(editor.getSnapshot().file);
    file.presentation.collapsedByDefault = ['n_writing_init'];
    const first = {
      id: 'projection-1',
      type: 'reference' as const,
      fromNodeId: 'n_analysis_prelim',
      toNodeId: 'n_writing_template',
    };
    const second = { ...first, id: 'projection-2', toNodeId: 'n_writing_template_latex' };
    file.domain.edges.push(first, second);
    await editor.importFile(file);
    const graph = resolveVisualGraph(domain(), file.presentation);
    const proxy = graph.edges.find((edge) => edge.originalEdgeIds.includes(first.id))!;
    expect(proxy.originalEdgeIds).toEqual([first.id, second.id]);
    await editor.run(setEdgeNoteEntry(domain(), second.id, '只改这条'));
    expect(domain().edges.find((edge) => edge.id === first.id)).toEqual(first);
    expect(domain().edges.find((edge) => edge.id === second.id)?.note).toBe('只改这条');
  });

  it('preserves a note and edge order across reconnect, delete and undo', async () => {
    const { storage, editor, domain, edge } = await setup();
    const edgeIds = domain().edges.map((item) => item.id);
    await editor.run(setEdgeNoteEntry(domain(), edge.id, '查看 <依据>'));
    const noted = editor.getSnapshot().file;
    expect(noted.domain.edges.find((item) => item.id === edge.id)?.note).toBe('查看 <依据>');
    const destination = domain().nodes.find(
      (node) =>
        node.id !== edge.fromNodeId &&
        node.id !== edge.toNodeId &&
        !domain().edges.some(
          (item) =>
            item.type === edge.type &&
            item.fromNodeId === edge.fromNodeId &&
            item.toNodeId === node.id,
        ),
    )!;
    await editor.run(reconnectEdgeEntry(domain(), edge.id, edge.fromNodeId, destination.id));
    expect(domain().edges.find((item) => item.id === edge.id)).toMatchObject({
      note: '查看 <依据>',
      toNodeId: destination.id,
    });
    expect(domain().edges.map((item) => item.id)).toEqual(edgeIds);
    await editor.run(removeEdgeEntry(domain(), edge.id));
    expect(domain().edges.some((item) => item.id === edge.id)).toBe(false);
    await editor.undo();
    await editor.undo();
    const restored = await storage.load(noted.projectId);
    expect(restored?.revisions.semanticHash).toBe(noted.revisions.semanticHash);
    await editor.run(setEdgeNoteEntry(domain(), edge.id, '  '));
    expect(domain().edges.find((item) => item.id === edge.id)).not.toHaveProperty('note');
  });

  it('rejects an invalid reconnect without changing the original connection', async () => {
    const { editor, domain, edge } = await setup();
    await editor.run(reconnectEdgeEntry(domain(), edge.id, edge.fromNodeId, edge.fromNodeId));
    expect(editor.getSnapshot().error).toMatch(/same node/i);
    expect(editor.getSnapshot().undoDepth).toBe(0);
    expect(domain().edges.find((item) => item.id === edge.id)).toEqual(edge);
  });

  it('adds a new relation edge between nodes, supporting undo and redo', async () => {
    const { editor, domain } = await setup();
    const sourceNode = domain().nodes[0]!;
    const targetNode = domain().nodes[1]!;
    const newEdgeId = 'e_test_new_relation';

    await editor.run(
      addEdgeEntry({
        id: newEdgeId,
        type: 'dependency',
        fromNodeId: sourceNode.id,
        toNodeId: targetNode.id,
      }),
    );

    const created = domain().edges.find((e) => e.id === newEdgeId);
    expect(created).toBeDefined();
    expect(created).toMatchObject({
      id: newEdgeId,
      type: 'dependency',
      fromNodeId: sourceNode.id,
      toNodeId: targetNode.id,
    });

    // Undo should remove the edge
    await editor.undo();
    expect(domain().edges.some((e) => e.id === newEdgeId)).toBe(false);

    // Redo should restore the edge
    await editor.redo();
    expect(domain().edges.some((e) => e.id === newEdgeId)).toBe(true);
  });

  it('stores one undoable edge style change without touching the domain', async () => {
    const { editor, edge } = await setup();
    const beforeSemantic = editor.getSnapshot().file.revisions.semanticHash;
    const style = {
      color: '#123abc',
      width: 3,
      lineStyle: 'dotted' as const,
      arrow: 'both' as const,
    };

    await editor.run(setEdgeStyleEntry(editor.getSnapshot().file, edge.id, style)!);
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[edge.id]).toEqual(style);
    expect(editor.getSnapshot().file.revisions.semanticHash).toBe(beforeSemantic);

    await editor.undo();
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[edge.id]).toBeUndefined();
    await editor.redo();
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[edge.id]).toEqual(style);
  });

  it('applies and undoes a batch of edge styles in one step', async () => {
    const { editor, domain } = await setup();
    const [first, second] = domain().edges.filter((edge) => edge.type !== 'hierarchy');
    if (!first || !second) throw new Error('demo file needs two non-hierarchy edges');
    const style = {
      color: '#ab12cd',
      width: 5,
      lineStyle: 'solid' as const,
      arrow: 'start' as const,
    };

    await editor.run(
      setEdgeStylesEntry(editor.getSnapshot().file, [
        { edgeId: first.id, style },
        { edgeId: second.id, style },
      ])!,
    );
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[first.id]).toEqual(style);
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[second.id]).toEqual(style);
    expect(editor.getSnapshot().undoDepth).toBe(1);

    await editor.undo();
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[first.id]).toBeUndefined();
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[second.id]).toBeUndefined();
  });

  it('restores an edge style when deleting the edge is undone', async () => {
    const { editor, edge } = await setup();
    const style = { color: '#ff8800', width: 2.5, arrow: 'both' as const };
    await editor.run(setEdgeStyleEntry(editor.getSnapshot().file, edge.id, style)!);
    await editor.run(removeEdgeEntry(editor.getSnapshot().file, edge.id));

    expect(editor.getSnapshot().file.domain.edges.some((item) => item.id === edge.id)).toBe(false);
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[edge.id]).toBeUndefined();

    await editor.undo();
    expect(editor.getSnapshot().file.domain.edges.some((item) => item.id === edge.id)).toBe(true);
    expect(editor.getSnapshot().file.presentation.edgeStyles?.[edge.id]).toEqual(style);
  });
});
