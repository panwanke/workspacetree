import { describe, expect, it } from 'vitest';
import type { DomainState } from '@workspacetree/schema';
import { resolveVisualGraph, visualEdgeAnchors, visualEdgePath } from '@workspacetree/layout';
import { createDemoDomain } from '../fixtures/phase1-demo';

function presentation(overrides: Record<string, unknown> = {}) {
  return {
    nodePositions: {},
    verticalNodePositions: {},
    branchScales: {},
    nodeScales: {},
    collapsedByDefault: [],
    savedSpineDisplay: null,
    layoutDirection: 'horizontal' as const,
    ...overrides,
  };
}

describe('Phase 2 统一视觉几何', () => {
  it('counts Markdown and legacy tasks on nodes and in collapsed branches', () => {
    const domain = createDemoDomain();
    const nodeId = 'n_exp_program';
    const node = domain.nodes.find((item) => item.id === nodeId)!;
    const ownTasks = domain.tasks.filter((item) => item.nodeId === nodeId);
    const childBlock = 'blk_extra_tasks';
    const root = resolveVisualGraph(domain, presentation({ collapsedByDefault: ['n_exp'] }));
    node.blockIds.push(childBlock, childBlock);
    domain.blocks.push({
      id: childBlock,
      kind: 'checklist',
      payload: {
        markdown: '- [x] Done\n- [~] Paused\n\n~~~md\n- [ ] Example\n~~~',
      },
    });
    const expanded = resolveVisualGraph(domain, presentation());
    expect(expanded.nodeById[nodeId]).toMatchObject({
      taskDone: ownTasks.filter((item) => item.done).length + 1,
      taskTotal: ownTasks.length + 2,
    });
    const folded = resolveVisualGraph(domain, presentation({ collapsedByDefault: ['n_exp'] }));
    const before = root.nodeById.n_exp;
    expect(folded.nodeById.n_exp.taskDone).toBe(before.taskDone + 1);
    expect(folded.nodeById.n_exp.taskTotal).toBe(before.taskTotal + 2);
  });
  it('reserves Markdown preview space for existing compact boxes and restores their size when the note is removed', () => {
    const domain = createDemoDomain();
    const root = domain.nodes.find((node) => node.id === domain.project.rootNodeId)!;
    const blockId = `blk_note_${root.id}`;
    domain.blocks = domain.blocks.filter((block) => block.id !== blockId);
    root.blockIds = root.blockIds.filter((id) => id !== blockId);
    const saved = { ...presentation(), nodeSizes: { [root.id]: { width: 200, height: 60 } } };
    const size = () => resolveVisualGraph(domain, saved).sizes[root.id];
    expect(size()).toEqual({ width: 200, height: 60 });

    root.blockIds.push(blockId);
    domain.blocks.push({ id: blockId, kind: 'text', payload: { markdown: 'A **note**.' } });
    expect(size()).toEqual({ width: 200, height: 124 });
    expect(saved.nodeSizes[root.id]).toEqual({ width: 200, height: 60 });
    const larger = presentation({ nodeSizes: { [root.id]: { width: 250, height: 180 } } });
    expect(resolveVisualGraph(domain, larger).sizes[root.id]).toEqual({ width: 250, height: 180 });

    domain.blocks.pop();
    root.blockIds.pop();
    expect(size()).toEqual({ width: 200, height: 60 });
  });

  it.each(['date-constrained', 'date-priority'] as const)(
    'places an undated parent near its earliest dated descendant in %s',
    (strategy) => {
      const domain = createDemoDomain();
      const ids = new Set(['n_root', 'n_init', 'n_exp', 'n_writing_init', 'n_writing_outline']);
      domain.nodes = domain.nodes.filter((node) => ids.has(node.id));
      const parent = domain.nodes.find((node) => node.id === 'n_writing_init')!;
      const child = domain.nodes.find((node) => node.id === 'n_writing_outline')!;
      parent.startAt = null;
      child.startAt = '2027-01-01';
      const arrange = () =>
        resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), { strategy });
      const late = arrange();
      expect(late.nodeById[parent.id].startAt).toBeNull();
      expect(late.positions[child.id].y - late.positions[parent.id].y).toBeLessThan(160);
      expect(late.positions[parent.id].y).toBeGreaterThan(late.positions.n_exp.y);
      const folded = resolveVisualGraph(
        domain,
        presentation({ layoutDirection: 'vertical', collapsedByDefault: [parent.id] }),
        { strategy },
      );
      expect(folded.positions[parent.id]).toEqual(late.positions[parent.id]);
      child.startAt = '2026-01-08';
      const early = arrange();
      expect(early.positions[parent.id].y).toBeLessThan(late.positions[parent.id].y);
      expect(early.positions[parent.id].y).toBeLessThan(early.positions[child.id].y);
    },
  );

  it('keeps date bands ordered while separating the experiment and writing branches', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
      strategy: 'date-priority',
    });
    expect(Math.abs(graph.positions.n_exp.x - graph.positions.n_writing_init.x)).toBeGreaterThan(
      280,
    );
    expect(graph.positions.n_exp.x).toBe(graph.positions.n_exp_collect.x);
    const anchors = graph.dateAnchors;
    expect(anchors.map((anchor) => anchor.date)).toEqual(
      anchors.map((anchor) => anchor.date).sort(),
    );
    for (const [i, anchor] of anchors.entries()) {
      const next = anchors[i + 1];
      if (!next) continue;
      const bottom = Math.max(
        ...anchor.nodeIds.map((id) => graph.positions[id].y + graph.sizes[id].height),
      );
      expect(bottom).toBeLessThan(graph.positions[next.nodeIds[0]].y);
    }
  });

  it('keeps dated nodes more than a week apart in chronological order despite reversed ancestry', () => {
    const domain = createDemoDomain();
    const node = (id: string) => domain.nodes.find((item) => item.id === id)!;
    node('n_exp_program').startAt = '2027-11-01';
    node('n_exp_collect').startAt = '2025-11-01';
    const graph = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
      strategy: 'date-constrained',
    });
    expect(graph.positions.n_exp_collect.y).toBeLessThan(graph.positions.n_root.y);
    expect(graph.positions.n_exp_program.y).toBeGreaterThan(graph.positions.n_analysis_report.y);
    const dated = graph.nodes.filter((item) => item.startAt);
    for (const earlier of dated) {
      for (const later of dated) {
        const days = (Date.parse(later.startAt!) - Date.parse(earlier.startAt!)) / 86_400_000;
        if (days > 7) expect(earlier.position.y).toBeLessThan(later.position.y);
      }
    }
  });

  it('avoids card collisions when tall dated ancestors cannot fit in their date window', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(
      domain,
      presentation({
        layoutDirection: 'vertical',
        nodeSizes: { n_init: { width: 280, height: 850 } },
      }),
      { strategy: 'date-constrained' },
    );
    expect(graph.positions.n_exp.y).toBeLessThan(graph.positions.n_init.y + 850);
    for (const [index, first] of graph.nodes.entries()) {
      for (const second of graph.nodes.slice(index + 1)) {
        const dx = second.position.x - first.position.x;
        const dy = second.position.y - first.position.y;
        expect(
          dx >= first.size.width ||
            -dx >= second.size.width ||
            dy >= first.size.height ||
            -dy >= second.size.height,
          `${first.id} overlaps ${second.id}`,
        ).toBe(true);
      }
    }
  });

  it('keeps long branches apart and their main paths aligned in structure mode', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
      strategy: 'structure',
    });
    const centerX = (id: string) => graph.positions[id].x + graph.sizes[id].width / 2;
    expect(centerX('n_exp')).toBe(centerX('n_exp_collect'));
    expect(centerX('n_writing_outline')).toBe(centerX('n_writing_ch1'));
    expect(Math.abs(centerX('n_exp') - centerX('n_writing_init'))).toBeGreaterThan(280);
    for (const [index, first] of graph.nodes.entries()) {
      const { x, y } = first.position;
      for (const second of graph.nodes.slice(index + 1)) {
        const other = second.position;
        const overlaps =
          x < other.x + second.size.width &&
          x + first.size.width > other.x &&
          y < other.y + second.size.height &&
          y + first.size.height > other.y;
        expect(overlaps, `${first.id} overlaps ${second.id}`).toBe(false);
      }
    }
    expect(graph.dateAnchors).toEqual([]);
  });

  it('keeps undated children near their parent and increases distance for later dates', () => {
    const domain = createDemoDomain();
    const ids = new Set(['n_root', 'n_init', 'n_exp', 'n_writing_init']);
    domain.nodes = domain.nodes.filter((node) => ids.has(node.id));
    const exp = domain.nodes.find((node) => node.id === 'n_exp')!;
    exp.startAt = null;
    const saved = presentation({
      layoutDirection: 'vertical',
      verticalNodePositions: { n_writing_init: { x: 480, y: -100 } },
    });
    const layout = () => resolveVisualGraph(domain, saved, { strategy: 'structure' });
    const initial = layout();
    expect(initial.positions.n_exp.y - initial.positions.n_init.y).toBeLessThan(170);
    expect(initial.positions.n_writing_init).toEqual({ x: 480, y: -100 });
    expect(initial.locked).toContain('n_writing_init');
    exp.startAt = '2027-02-01';
    expect(layout().positions.n_exp.y).toBeGreaterThan(initial.positions.n_exp.y);
  });

  it.each(['horizontal', 'vertical'] as const)(
    'orders auto nodes from every branch by complete date bands in %s',
    (layoutDirection) => {
      const domain = createDemoDomain();
      const parent = domain.nodes.find((node) => node.id === 'n_exp')!;
      parent.startAt = '2027-01-01';
      const graph = resolveVisualGraph(domain, presentation({ layoutDirection }));
      const vertical = layoutDirection === 'vertical';
      const dated = graph.nodes.filter((node) => node.startAt);
      for (const first of dated) {
        for (const second of dated) {
          if (first.startAt! >= second.startAt!) continue;
          const end = vertical
            ? first.position.y + first.size.height
            : first.position.x + first.size.width;
          expect(end).toBeLessThan(vertical ? second.position.y : second.position.x);
        }
      }
    },
  );

  it('wraps dense dates to three cards per row and keeps date anchors stable under free placement', () => {
    const domain = createDemoDomain();
    const root = domain.nodes.find((node) => node.id === domain.project.rootNodeId)!;
    root.startAt = null;
    const date = '2026-04-01';
    for (const node of domain.nodes) if (node !== root) node.startAt = date;
    const automatic = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }));
    const rows = new Map<number, number>();
    for (const node of automatic.nodes.filter((item) => item.startAt === date)) {
      rows.set(node.position.y, (rows.get(node.position.y) ?? 0) + 1);
    }
    expect(rows.size).toBeGreaterThan(1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(3);
    expect(automatic.positions[root.id].y).toBeLessThan(Math.min(...rows.keys()));
    const manual = resolveVisualGraph(
      domain,
      presentation({
        layoutDirection: 'vertical',
        verticalNodePositions: { n_exp: { x: 50, y: -500 } },
      }),
    );
    expect(manual.positions.n_exp).toEqual({ x: 50, y: -500 });
    expect(manual.dateAnchors).toEqual(automatic.dateAnchors);
    expect(manual.dateAnchors[0]).toMatchObject({
      date,
      nodeIds: expect.arrayContaining(['n_exp']),
    });
  });

  it('uses the facing sides of reverse and same-row edges', () => {
    const graph = resolveVisualGraph(
      createDemoDomain(),
      presentation({ layoutDirection: 'vertical' }),
    );
    const source = { ...graph.nodeById.n_exp, position: { x: 0, y: 400 } };
    const target = { ...graph.nodeById.n_init, position: { x: 0, y: 0 } };
    const reverse = visualEdgeAnchors(source, target, 'vertical');
    expect(reverse).toMatchObject({ sourceSide: 'top', targetSide: 'bottom' });
    expect(reverse.source.y).toBe(400);
    expect(reverse.target.y).toBe(target.size.height);
    const side = { ...target, position: { x: 400, y: 400 } };
    expect(visualEdgeAnchors(source, side, 'vertical')).toMatchObject({
      sourceSide: 'right',
      targetSide: 'left',
    });
    expect(visualEdgePath(source, target, 'vertical')).toMatch(/^M .* C /);
  });

  it('retains a bounded cross-axis lane for different branches on distinct dates', () => {
    const graph = resolveVisualGraph(
      createDemoDomain(),
      presentation({ layoutDirection: 'vertical' }),
    );
    const branches = ['n_writing_init', 'n_exp', 'n_analysis'];
    const columns = new Set(branches.map((id) => graph.positions[id].x));
    expect(columns.size).toBeGreaterThan(1);
    expect(graph.bounds.maxX - graph.bounds.minX).toBeLessThan(850);
  });

  it('同层节点按日期排序，无日期置后，ID 保证同日期稳定', () => {
    const domain = createDemoDomain();
    domain.nodes = domain.nodes.filter((node) =>
      ['n_root', 'n_init', 'n_writing_init', 'n_exp'].includes(node.id),
    );
    domain.edges = domain.edges.filter(
      (edge) => edge.type === 'hierarchy' && domain.nodes.some((node) => node.id === edge.toNodeId),
    );
    domain.nodes.find((node) => node.id === 'n_writing_init')!.startAt = '2026-03-01';
    domain.nodes.find((node) => node.id === 'n_exp')!.startAt = null;
    const graph = resolveVisualGraph(domain, presentation());
    const siblings = graph.order.filter((id) => graph.nodeById[id].depth === 2);
    expect(siblings).toEqual(['n_writing_init', 'n_exp']);
  });

  it('横向与纵向共用排序且分别保存手动位置', () => {
    const domain = createDemoDomain();
    const horizontal = resolveVisualGraph(
      domain,
      presentation({ nodePositions: { n_writing_init: { x: 900, y: 800 } } }),
    );
    const vertical = resolveVisualGraph(
      domain,
      presentation({
        layoutDirection: 'vertical',
        verticalNodePositions: { n_writing_init: { x: 100, y: 200 } },
      }),
    );
    expect(horizontal.positions.n_writing_init).toEqual({ x: 900, y: 800 });
    expect(vertical.positions.n_writing_init).toEqual({ x: 100, y: 200 });
    expect(horizontal.locked).toEqual(['n_writing_init']);
    expect(vertical.locked).toEqual(['n_writing_init']);
    expect(vertical.order).toEqual(horizontal.order);
    expect(vertical.positions.n_exp.y).toBeGreaterThan(vertical.positions.n_root.y);
    expect(horizontal.positions.n_exp.x).toBeGreaterThan(horizontal.positions.n_root.x);
  });

  it('keeps legacy horizontal locks and defaults unlocked files to vertical', () => {
    const domain = createDemoDomain();
    const legacy = resolveVisualGraph(
      domain,
      presentation({ layoutDirection: undefined, nodePositions: { n_exp: { x: 75, y: 90 } } }),
    );
    expect(legacy.direction).toBe('horizontal');
    expect(legacy.positions.n_exp).toEqual({ x: 75, y: 90 });
    expect(legacy.locked).toContain('n_exp');
    const unlocked = resolveVisualGraph(domain, presentation({ layoutDirection: undefined }));
    expect(unlocked.direction).toBe('vertical');
  });

  it('单节点缩放只改自身，分支缩放影响整棵后代几何', () => {
    const domain = createDemoDomain();
    const base = resolveVisualGraph(domain, presentation());
    const scaled = resolveVisualGraph(
      domain,
      presentation({ branchScales: { n_writing_init: 0.5 }, nodeScales: { n_exp: 2 } }),
    );
    expect(scaled.sizes.n_writing_init.width).toBe(base.sizes.n_writing_init.width * 0.5);
    expect(scaled.sizes.n_writing_template.width).toBe(base.sizes.n_writing_template.width * 0.5);
    expect(scaled.sizes.n_exp.width).toBe(base.sizes.n_exp.width * 2);
    expect(scaled.sizes.n_exp_program.width).toBe(base.sizes.n_exp_program.width);
    expect(scaled.sizes.n_init).toEqual(base.sizes.n_init);
  });

  it('折叠隐藏后代、聚合摘要与跨分支连线，展开可完整恢复', () => {
    const domain = createDemoDomain();
    const collapsed = resolveVisualGraph(
      domain,
      presentation({ collapsedByDefault: ['n_writing_init', 'n_analysis'] }),
    );
    expect(collapsed.nodeById.n_writing_init.collapsedCount).toBe(13);
    expect(collapsed.nodeById.n_writing_init.taskTotal).toBe(8);
    expect(collapsed.nodeById.n_writing_init.externalConnectionCount).toBeGreaterThan(0);
    expect(collapsed.positions.n_writing_template).toBeUndefined();
    expect(collapsed.hiddenNodeIds).toContain('n_writing_template_latex');
    expect(
      collapsed.edges.some(
        (edge) =>
          edge.type === 'dependency' &&
          edge.sourceId === 'n_analysis' &&
          edge.targetId === 'n_writing_init',
      ),
    ).toBe(true);
    const restored = resolveVisualGraph(domain, presentation());
    expect(restored.nodes).toHaveLength(domain.nodes.length);
    expect(restored.positions.n_writing_template_latex).toBeDefined();
  });

  it('3D 投影不改变 2D 坐标与尺寸来源', () => {
    const domain = createDemoDomain();
    const graph = resolveVisualGraph(domain, presentation());
    for (const node of graph.nodes) {
      expect(graph.positions[node.id]).toEqual(node.position);
      expect(graph.sizes[node.id]).toEqual(node.size);
      expect(Number.isFinite(node.scale)).toBe(true);
    }
  });

  describe('四大树形布局场景（延续居中、普通叶子错开、单孩子显式侧枝、不同日期与同日过密）', () => {
    it('场景 1：延续居中（纵向与横向）', () => {
      const domain: DomainState = {
        project: { id: 'prj_t', title: 'Test', rootNodeId: 'n_root' },
        nodes: [
          {
            id: 'n_root',
            title: 'Root',
            parentId: null,
            blockIds: [],
            archived: false,
            startAt: null,
          },
          {
            id: 'n_cont',
            title: 'Continuation',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: null,
          },
        ],
        edges: [
          {
            id: 'e_cont',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_cont',
            role: 'continuation',
          },
        ],
        tasks: [],
        blocks: [],
        spines: [],
        projectRefs: [],
        archived: false,
        archiveMeta: null,
      };
      // Vertical: continuation child centers under parent (centerX equals)
      const vert = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
        strategy: 'structure',
      });
      const vertCenter = (id: string) => vert.positions[id].x + vert.sizes[id].width / 2;
      expect(vertCenter('n_cont')).toBeCloseTo(vertCenter('n_root'), 1);
      expect(vert.positions.n_cont.y).toBeGreaterThan(vert.positions.n_root.y);

      // Horizontal: continuation child centers to right of parent (centerY equals)
      const horiz = resolveVisualGraph(domain, presentation({ layoutDirection: 'horizontal' }), {
        strategy: 'structure',
      });
      const horizCenter = (id: string) => horiz.positions[id].y + horiz.sizes[id].height / 2;
      expect(horizCenter('n_cont')).toBeCloseTo(horizCenter('n_root'), 1);
      expect(horiz.positions.n_cont.x).toBeGreaterThan(horiz.positions.n_root.x);
    });

    it('场景 2：普通叶子错开（左右错开、留出高差，纵向与横向）', () => {
      const domain: DomainState = {
        project: { id: 'prj_t', title: 'Test', rootNodeId: 'n_root' },
        nodes: [
          {
            id: 'n_root',
            title: 'Root',
            parentId: null,
            blockIds: [],
            archived: false,
            startAt: null,
          },
          {
            id: 'n_cont',
            title: 'A 延续',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: null,
          },
          {
            id: 'n_leaf_b',
            title: 'B 叶子',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: null,
          },
          {
            id: 'n_leaf_c',
            title: 'C 叶子',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: null,
          },
        ],
        edges: [
          {
            id: 'e_cont',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_cont',
            role: 'continuation',
          },
          {
            id: 'e_leaf_b',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_leaf_b',
            role: 'leaf',
          },
          {
            id: 'e_leaf_c',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_leaf_c',
            role: 'leaf',
          },
        ],
        tasks: [],
        blocks: [],
        spines: [],
        projectRefs: [],
        archived: false,
        archiveMeta: null,
      };
      // Vertical
      const vert = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
        strategy: 'structure',
      });
      const vertCenterX = (id: string) => vert.positions[id].x + vert.sizes[id].width / 2;
      expect(vertCenterX('n_cont')).toBeCloseTo(vertCenterX('n_root'), 1);
      expect(vertCenterX('n_leaf_b')).toBeLessThan(vertCenterX('n_root'));
      expect(vertCenterX('n_leaf_c')).toBeGreaterThan(vertCenterX('n_root'));
      expect(vert.positions.n_leaf_b.y).not.toBe(vert.positions.n_leaf_c.y);
      expect(
        Math.abs(vert.positions.n_leaf_c.y - vert.positions.n_leaf_b.y),
      ).toBeGreaterThanOrEqual(16);

      // Horizontal
      const horiz = resolveVisualGraph(domain, presentation({ layoutDirection: 'horizontal' }), {
        strategy: 'structure',
      });
      const horizCenterY = (id: string) => horiz.positions[id].y + horiz.sizes[id].height / 2;
      expect(horizCenterY('n_cont')).toBeCloseTo(horizCenterY('n_root'), 1);
      expect(horizCenterY('n_leaf_b')).toBeLessThan(horizCenterY('n_root'));
      expect(horizCenterY('n_leaf_c')).toBeGreaterThan(horizCenterY('n_root'));
      expect(horiz.positions.n_leaf_b.x).not.toBe(horiz.positions.n_leaf_c.x);
      expect(
        Math.abs(horiz.positions.n_leaf_c.x - horiz.positions.n_leaf_b.x),
      ).toBeGreaterThanOrEqual(16);
    });

    it('场景 3：只有一个孩子且显式创建的是侧枝（保留横向偏移，纵向与横向）', () => {
      const domain: DomainState = {
        project: { id: 'prj_t', title: 'Test', rootNodeId: 'n_root' },
        nodes: [
          {
            id: 'n_root',
            title: 'Root',
            parentId: null,
            blockIds: [],
            archived: false,
            startAt: null,
          },
          {
            id: 'n_branch',
            title: 'Branch',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: null,
          },
        ],
        edges: [
          {
            id: 'e_branch',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_branch',
            role: 'branch',
          },
        ],
        tasks: [],
        blocks: [],
        spines: [],
        projectRefs: [],
        archived: false,
        archiveMeta: null,
      };
      // Vertical: even though it's the only child, it must have clear horizontal offset
      const vert = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
        strategy: 'structure',
      });
      const vertCenterX = (id: string) => vert.positions[id].x + vert.sizes[id].width / 2;
      expect(Math.abs(vertCenterX('n_branch') - vertCenterX('n_root'))).toBeGreaterThanOrEqual(50);
      expect(vert.edges[0].color).toBeDefined();

      // Horizontal: vertical offset maintained
      const horiz = resolveVisualGraph(domain, presentation({ layoutDirection: 'horizontal' }), {
        strategy: 'structure',
      });
      const horizCenterY = (id: string) => horiz.positions[id].y + horiz.sizes[id].height / 2;
      expect(Math.abs(horizCenterY('n_branch') - horizCenterY('n_root'))).toBeGreaterThanOrEqual(
        50,
      );
    });

    it('场景 4：不同日期与同日过密（时间顺序与同日无碰撞，纵向与横向）', () => {
      const domain: DomainState = {
        project: { id: 'prj_t', title: 'Test', rootNodeId: 'n_root' },
        nodes: [
          {
            id: 'n_root',
            title: 'Root',
            parentId: null,
            blockIds: [],
            archived: false,
            startAt: '2026-01-01',
          },
          {
            id: 'n_day1_a',
            title: 'Day 1 A',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: '2026-02-01',
          },
          {
            id: 'n_day1_b',
            title: 'Day 1 B',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: '2026-02-01',
          },
          {
            id: 'n_day2',
            title: 'Day 2',
            parentId: 'n_root',
            blockIds: [],
            archived: false,
            startAt: '2026-03-01',
          },
        ],
        edges: [
          {
            id: 'e_1',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_day1_a',
            role: 'continuation',
          },
          {
            id: 'e_2',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_day1_b',
            role: 'leaf',
          },
          {
            id: 'e_3',
            type: 'hierarchy',
            fromNodeId: 'n_root',
            toNodeId: 'n_day2',
            role: 'branch',
          },
        ],
        tasks: [],
        blocks: [],
        spines: [],
        projectRefs: [],
        archived: false,
        archiveMeta: null,
      };
      // Vertical
      const vert = resolveVisualGraph(domain, presentation({ layoutDirection: 'vertical' }), {
        strategy: 'date-constrained',
      });
      expect(vert.positions.n_day1_a.y).toBeLessThan(vert.positions.n_day2.y);
      const a = { ...vert.positions.n_day1_a, ...vert.sizes.n_day1_a };
      const b = { ...vert.positions.n_day1_b, ...vert.sizes.n_day1_b };
      const overlapsVert =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlapsVert).toBe(false);

      // Horizontal
      const horiz = resolveVisualGraph(domain, presentation({ layoutDirection: 'horizontal' }), {
        strategy: 'date-constrained',
      });
      expect(horiz.positions.n_day1_a.x).toBeLessThan(horiz.positions.n_day2.x);
      const ha = { ...horiz.positions.n_day1_a, ...horiz.sizes.n_day1_a };
      const hb = { ...horiz.positions.n_day1_b, ...horiz.sizes.n_day1_b };
      const overlapsHoriz =
        ha.x < hb.x + hb.width &&
        ha.x + ha.width > hb.x &&
        ha.y < hb.y + hb.height &&
        ha.y + ha.height > hb.y;
      expect(overlapsHoriz).toBe(false);
    });
  });
});
