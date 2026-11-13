import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import { resolveVisualGraph } from '@workspacetree/layout';
import { createDemoBranchFile } from '../../apps/web/src/demo';
import { EditorController } from '../../apps/web/src/editor';
import { reconnectEdgeEntry, setEdgeNoteEntry } from '../../apps/web/src/edge-editing';
import { removeEdgeEntry } from '../../apps/web/src/history';

async function setup() {
  const storage = new MemoryStorageAdapter();
  const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
  const domain = () => editor.getSnapshot().file.domain;
  const edge = domain().edges.find((item) => item.type !== 'hierarchy')!;
  return { storage, editor, domain, edge };
}

describe('canvas edge editing', () => {
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
});
