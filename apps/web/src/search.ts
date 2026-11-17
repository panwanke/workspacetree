import { getNodeNote } from './history';
import type { DomainState, Edge } from '@workspacetree/schema';

export type WorkspaceSearchResult =
  | {
      kind: 'node';
      id: string;
      title: string;
      matchedInTitle: boolean;
      matchedInNote: boolean;
      snippet?: string;
    }
  | {
      kind: 'edge';
      id: string;
      edge: Edge;
      fromTitle: string;
      toTitle: string;
      note: string;
      snippet: string;
    };

function snippetOf(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + queryLength + 32);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${
    end < text.length ? '...' : ''
  }`;
}

/** 纯搜索：节点标题/可选 Markdown 正文，加上连线备注。空查询只列节点。 */
export function searchWorkspace(
  domain: DomainState,
  query: string,
  includeMarkdown: boolean,
): WorkspaceSearchResult[] {
  const q = query.trim().toLowerCase();
  const names = new Map(domain.nodes.map((node) => [node.id, node.title || node.id]));
  const results: WorkspaceSearchResult[] = [];
  for (const node of domain.nodes) {
    const title = node.title || '未命名节点';
    const note = getNodeNote(domain, node.id);
    if (!q) {
      results.push({
        kind: 'node',
        id: node.id,
        title,
        matchedInTitle: true,
        matchedInNote: false,
      });
      continue;
    }
    const inTitle = title.toLowerCase().includes(q);
    const noteIndex = includeMarkdown ? note.toLowerCase().indexOf(q) : -1;
    if (!inTitle && noteIndex < 0) continue;
    results.push({
      kind: 'node',
      id: node.id,
      title,
      matchedInTitle: inTitle,
      matchedInNote: noteIndex >= 0,
      ...(noteIndex >= 0 ? { snippet: snippetOf(note, noteIndex, q.length) } : {}),
    });
  }
  if (!q) return results;
  for (const edge of domain.edges) {
    const note = edge.note?.trim();
    if (!note) continue;
    const index = note.toLowerCase().indexOf(q);
    if (index < 0) continue;
    results.push({
      kind: 'edge',
      id: edge.id,
      edge,
      fromTitle: names.get(edge.fromNodeId) ?? edge.fromNodeId,
      toTitle: names.get(edge.toNodeId) ?? edge.toNodeId,
      note,
      snippet: snippetOf(note, index, q.length),
    });
  }
  return results;
}
