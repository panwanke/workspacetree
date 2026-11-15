import { describe, expect, it } from 'vitest';
import {
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  validateDomain,
} from '@workspacetree/core';
import { computeTreeLayout, hasOverlap, resolveVisualGraph } from '@workspacetree/layout';
import { BranchFileSchema, DomainStateSchema } from '@workspacetree/schema';
import { createDemoBranchFile, createDemoDomain, DEMO_PROJECT_ID } from '../../apps/web/src/demo';

describe('WorkspaceTree 官方演示项目（新版复杂全景样例）', () => {
  it('生成完整且符合 Zod Schema 契约的领域模型与分支文件', () => {
    const domain = createDemoDomain();
    expect(DomainStateSchema.safeParse(domain).success).toBe(true);
    expect(() => validateDomain(domain)).not.toThrow();

    const file = createDemoBranchFile();
    expect(BranchFileSchema.safeParse(file).success).toBe(true);
    expect(file.projectId).toBe(DEMO_PROJECT_ID);
    expect(file.revisions.semanticHash).toBe(computeSemanticHash(file.domain));
    expect(file.revisions.presentationHash).toBe(computePresentationHash(file.presentation));
    expect(file.revisions.fileHash).toBe(computeFileHash(file));
  });

  it('包含 30+ 节点、4 大业务支柱、4 条研发主干与多种跨分支边', () => {
    const domain = createDemoDomain();
    expect(domain.nodes.length).toBeGreaterThanOrEqual(30);

    // 4 大业务支柱
    const rootChildren = domain.edges
      .filter((e) => e.type === 'hierarchy' && e.fromNodeId === domain.project.rootNodeId)
      .map((e) => e.toNodeId);
    expect(rootChildren).toEqual([
      'n_branch_ui',
      'n_branch_layout',
      'n_branch_storage',
      'n_branch_ecosystem',
    ]);

    // 4 条全链路主干
    expect(domain.spines).toHaveLength(4);
    for (const spine of domain.spines) {
      expect(spine.nodeIds[0]).toBe(domain.project.rootNodeId);
      expect(spine.nodeIds.length).toBeGreaterThanOrEqual(4);
    }

    // 跨分支关联边
    const crossEdges = domain.edges.filter((e) => e.type !== 'hierarchy');
    expect(crossEdges.length).toBeGreaterThanOrEqual(4);
    const edgeTypes = new Set(crossEdges.map((e) => e.type));
    expect(edgeTypes.has('dependency')).toBe(true);
    expect(edgeTypes.has('reference')).toBe(true);
    expect(edgeTypes.has('custom')).toBe(true);
    for (const edge of crossEdges) {
      expect(edge.note).toBeTruthy();
    }
  });

  it('展现 5 态任务体系与 Markdown 富文本标记（Callout / Pele / Mermaid）', () => {
    const domain = createDemoDomain();
    expect(domain.tasks.length).toBeGreaterThan(15);
    const hasPending = domain.tasks.some((t) => t.status === 'pending');
    expect(hasPending).toBe(true);

    const hasTags = domain.nodes.some((n) => n.tags && n.tags.length > 0);
    expect(hasTags).toBe(true);

    const markdownBlocks = domain.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => (b.payload as { markdown: string }).markdown);

    const allMarkdown = markdownBlocks.join('\n');
    expect(allMarkdown).toContain('> [!IMPORTANT]');
    expect(allMarkdown).toContain('> [!TIP]');
    expect(allMarkdown).toContain('> [!NOTE]');
    expect(allMarkdown).toContain('```mermaid');
    expect(allMarkdown).toContain('- [x]');
    expect(allMarkdown).toContain('- [~]');
    expect(allMarkdown).toContain('- [?]');
    expect(allMarkdown).toContain('- [-]');
    expect(allMarkdown).toContain('{color:');
    expect(allMarkdown).toContain('==');
  });

  it('时间树与视觉排布引擎在纵向与横向布局下均无重叠', () => {
    const file = createDemoBranchFile();
    const domain = file.domain;

    const baseTreeLayout = computeTreeLayout(
      domain.nodes,
      domain.edges,
      {},
      domain.project.rootNodeId,
    );
    expect(hasOverlap(baseTreeLayout.positions, file.presentation.nodeSizes ?? {})).toBe(false);

    const verticalGraph = resolveVisualGraph(domain, {
      ...file.presentation,
      layoutDirection: 'vertical',
    });
    expect(hasOverlap(verticalGraph.positions, verticalGraph.sizes)).toBe(false);

    const horizontalGraph = resolveVisualGraph(domain, {
      ...file.presentation,
      layoutDirection: 'horizontal',
    });
    expect(hasOverlap(horizontalGraph.positions, horizontalGraph.sizes)).toBe(false);

    expect(verticalGraph.hiddenNodeIds.length).toBeGreaterThan(0);
    expect(verticalGraph.nodeById.n_storage_assets.collapsed).toBe(true);
    expect(verticalGraph.nodeById.n_storage_assets.collapsedCount).toBeGreaterThan(0);
  });
});
