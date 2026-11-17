import { makeId } from '@workspacetree/core';
import type { DomainState, Edge, EdgeType } from '@workspacetree/schema';
import { addEdgeEntry, type HistoryEntry } from './history';

export type RelationDraft = Pick<Edge, 'fromNodeId' | 'toNodeId' | 'note'> & {
  type: Exclude<EdgeType, 'hierarchy'>;
};

export function saveRelationEntry(
  domain: DomainState,
  draft: RelationDraft,
  id?: string,
): HistoryEntry | undefined {
  const { fromNodeId, toNodeId, type } = draft;
  const note = draft.note?.trim() || undefined;
  const index = domain.edges.findIndex((edge) => edge.id === id);
  const previous = domain.edges[index];
  if (id !== undefined && (!previous || previous.type === 'hierarchy')) {
    throw new Error('Unknown relation');
  }
  if (fromNodeId === toNodeId) throw new Error('Cannot connect a node to the same node');
  const matches = (edge: Edge) =>
    edge.type === type && edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId;
  if (previous && matches(previous)) {
    return previous.note === note ? undefined : setEdgeNoteEntry(domain, previous.id, note ?? '');
  }
  if (domain.edges.some(matches)) throw new Error('This connection already exists');
  const next: Edge = { id: id ?? makeId('e_'), fromNodeId, toNodeId, type, note };
  if (!previous) return addEdgeEntry(next);
  const remove = { type: 'edge.remove', payload: { id } };
  return {
    label: '编辑关联',
    stateClass: 'domain',
    actorKind: 'human',
    forward: [remove, { type: 'edge.add', payload: { ...next, index } }],
    inverse: [remove, { type: 'edge.add', payload: { ...previous, index } }],
  };
}

export function setEdgeNoteEntry(domain: DomainState, id: string, text: string): HistoryEntry {
  const edge = domain.edges.find((item) => item.id === id);
  if (!edge) throw new Error('Unknown edge');
  return {
    label: '编辑连线备注',
    stateClass: 'domain',
    actorKind: 'human',
    forward: [{ type: 'edge.setNote', payload: { id, note: text.trim() || null } }],
    inverse: [{ type: 'edge.setNote', payload: { id, note: edge.note ?? null } }],
  };
}

export function reconnectEdgeEntry(
  domain: DomainState,
  id: string,
  fromNodeId: string,
  toNodeId: string,
): HistoryEntry {
  const index = domain.edges.findIndex((item) => item.id === id);
  const edge = domain.edges[index];
  if (!edge) throw new Error('Unknown edge');
  return {
    label: '重连连线',
    stateClass: 'domain',
    actorKind: 'human',
    forward: [{ type: 'edge.reconnect', payload: { id, fromNodeId, toNodeId } }],
    inverse: [
      { type: 'edge.remove', payload: { id } },
      { type: 'edge.add', payload: { ...edge, index } },
    ],
  };
}
