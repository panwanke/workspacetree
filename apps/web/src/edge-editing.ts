import type { DomainState } from '@workspacetree/schema';
import type { HistoryEntry } from './history';

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
