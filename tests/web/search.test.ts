import { describe, expect, it } from 'vitest';
import { searchWorkspace } from '../../apps/web/src/search';
import { createDemoDomain } from '../fixtures/phase1-demo';

describe('workspace search', () => {
  it('empty query only lists nodes', () => {
    const domain = createDemoDomain();
    const results = searchWorkspace(domain, '', false);
    expect(results.length).toBe(domain.nodes.length);
    expect(results.every((item) => item.kind === 'node')).toBe(true);
  });

  it('finds an edge note and keeps a stable node-then-edge order', () => {
    const domain = createDemoDomain();
    const from = domain.nodes[0]!;
    const to = domain.nodes[1]!;
    domain.edges.push({
      id: 'e_search_unique',
      type: 'dependency',
      fromNodeId: from.id,
      toNodeId: to.id,
      note: 'zzunique 关系备注命中',
    });
    const results = searchWorkspace(domain, 'zzunique', false);
    expect(results.some((item) => item.kind === 'node')).toBe(false);
    const edgeResult = results.find(
      (item) => item.kind === 'edge' && item.id === 'e_search_unique',
    );
    expect(edgeResult).toMatchObject({
      kind: 'edge',
      fromTitle: from.title || from.id,
      toTitle: to.title || to.id,
    });
    expect(edgeResult?.kind === 'edge' && edgeResult.snippet).toContain('zzunique');
  });

  it('still searches node titles', () => {
    const domain = createDemoDomain();
    const title = domain.nodes[0]!.title;
    const results = searchWorkspace(domain, title, false);
    expect(results.some((item) => item.kind === 'node' && item.id === domain.nodes[0]!.id)).toBe(
      true,
    );
  });
});
