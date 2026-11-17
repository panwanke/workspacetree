import { describe, expect, it, vi } from 'vitest';
import {
  applyCommand,
  canonicalize,
  CommandService,
  computePresentationHash,
  computeSemanticHash,
  validatePresentation,
} from '@workspacetree/core';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import {
  BranchFileSchema,
  NodeSchema,
  SavedPresentationSchema,
  type BranchFile,
  type Command,
  type CommandEnvelope,
  type StateClass,
} from '@workspacetree/schema';
import { EditorController } from '../../apps/web/src/editor';
import {
  clearPositionEntry,
  clearPositionsEntry,
  DragCoalescer,
  moveEntry,
  setBranchScaleEntry,
  setCollapsedEntry,
  setLayoutDirectionEntry,
  setNodeScaleEntry,
  setStartAtEntry,
} from '../../apps/web/src/history';

let operationCounter = 0;

function envelope(command: Command, stateClass: StateClass = 'presentation'): CommandEnvelope {
  operationCounter += 1;
  return {
    operationId: `op_phase2_${operationCounter}`,
    projectId: 'prj_fixture_0001',
    stateClass,
    expectedRevision: 0,
    actor: { kind: 'human', id: 'phase2-test' },
    command,
  };
}

function reduce(
  file: BranchFile,
  type: string,
  payload: Record<string, unknown>,
  stateClass: StateClass = 'presentation',
) {
  return applyCommand(file.domain, file.presentation, envelope({ type, payload }, stateClass));
}

async function setupEditor() {
  const storage = new MemoryStorageAdapter();
  const file = createMinimalBranchFile();
  await storage.save(file);
  const service = new CommandService(storage);
  const editor = new EditorController(storage, file, service);
  return { storage, file, service, editor };
}

describe('Phase 2 schema 与领域日期', () => {
  it('旧文件解析不注入新键，呈现消费端可回退默认值，startAt 严格使用 YYYY-MM-DD', () => {
    const file = createMinimalBranchFile();
    const parsed = BranchFileSchema.parse(structuredClone(file));

    expect(parsed).toEqual(file);
    expect(parsed.presentation.layoutDirection ?? 'horizontal').toBe('horizontal');
    expect(parsed.presentation.verticalNodePositions ?? {}).toEqual({});
    expect(parsed.presentation.nodeScales ?? {}).toEqual({});
    expect(parsed.domain.nodes[0]!.startAt).toBeUndefined();

    const node = { ...file.domain.nodes[0]! };
    expect(NodeSchema.safeParse({ ...node, startAt: '2026-11-12' }).success).toBe(true);
    expect(NodeSchema.safeParse({ ...node, startAt: null }).success).toBe(true);
    expect(NodeSchema.safeParse({ ...node, startAt: '2026-2-3' }).success).toBe(false);
    expect(NodeSchema.safeParse({ ...node, startAt: '2026-02-30' }).success).toBe(false);
  });

  it('node.add 接收 startAt，node.setStartAt 可修改与清空且产生语义 Commit', () => {
    const file = createMinimalBranchFile();
    const added = reduce(
      file,
      'node.add',
      { id: 'n_dated', title: 'Dated', startAt: '2026-11-12' },
      'domain',
    );
    expect(added.domain.nodes.find((node) => node.id === 'n_dated')?.startAt).toBe('2026-11-12');
    expect(added.commit).not.toBeNull();

    const changed = applyCommand(
      added.domain,
      added.presentation,
      envelope(
        {
          type: 'node.setStartAt',
          payload: { id: 'n_dated', startAt: '2027-01-02' },
        },
        'domain',
      ),
    );
    expect(changed.domain.nodes.find((node) => node.id === 'n_dated')?.startAt).toBe('2027-01-02');

    const cleared = applyCommand(
      changed.domain,
      changed.presentation,
      envelope({ type: 'node.setStartAt', payload: { id: 'n_dated', startAt: null } }, 'domain'),
    );
    expect(cleared.domain.nodes.find((node) => node.id === 'n_dated')?.startAt).toBeNull();
    expect(() =>
      reduce(file, 'node.add', { id: 'n_bad', title: 'Bad', startAt: '11/12/2026' }, 'domain'),
    ).toThrow('YYYY-MM-DD');
  });
});

describe('Phase 2 呈现命令', () => {
  it('横纵坐标、方向、节点/分支缩放与折叠互不污染 DomainState', () => {
    const file = createMinimalBranchFile();
    const semanticBefore = canonicalize(file.domain);
    let current = file;

    current = {
      ...current,
      ...reduce(current, 'presentation.moveNode', { nodeId: 'n_child', x: 1, y: 2 }),
    };
    current = {
      ...current,
      ...reduce(current, 'presentation.moveNode', {
        nodeId: 'n_child',
        x: 10,
        y: 20,
        direction: 'vertical',
      }),
    };
    current = {
      ...current,
      ...reduce(current, 'presentation.setLayoutDirection', { direction: 'vertical' }),
    };
    current = {
      ...current,
      ...reduce(current, 'presentation.setNodeScale', { nodeId: 'n_child', scale: 2 }),
    };
    current = {
      ...current,
      ...reduce(current, 'presentation.setScale', { nodeId: 'n_child', scale: 0.5 }),
    };
    const collapsed = reduce(current, 'presentation.collapse', {
      nodeId: 'n_child',
      collapsed: true,
    });

    expect(collapsed.commit).toBeNull();
    expect(collapsed.operations.every((operation) => operation.stateClass === 'presentation')).toBe(
      true,
    );
    expect(canonicalize(collapsed.domain)).toBe(semanticBefore);
    expect(collapsed.presentation.nodePositions.n_child).toEqual({ x: 1, y: 2 });
    expect(collapsed.presentation.verticalNodePositions?.n_child).toEqual({ x: 10, y: 20 });
    expect(collapsed.presentation.layoutDirection).toBe('vertical');
    expect(collapsed.presentation.nodeScales?.n_child).toBe(2);
    expect(collapsed.presentation.branchScales.n_child).toBe(0.5);
    expect(collapsed.presentation.collapsedByDefault).toContain('n_child');
    expect(file.presentation.nodePositions).toEqual({});
  });

  it('单节点恢复只清当前方向，缺省全部重置清两个方向', () => {
    const file = createMinimalBranchFile();
    const withPositions = {
      ...file.presentation,
      nodePositions: { n_root: { x: 1, y: 2 }, n_child: { x: 3, y: 4 } },
      verticalNodePositions: { n_root: { x: 5, y: 6 }, n_child: { x: 7, y: 8 } },
    };
    const base = { ...file, presentation: withPositions };
    const single = reduce(base, 'presentation.clearManualPosition', {
      nodeId: 'n_root',
      direction: 'vertical',
    });
    expect(single.presentation.verticalNodePositions).toEqual({ n_child: { x: 7, y: 8 } });
    expect(single.presentation.nodePositions.n_root).toEqual({ x: 1, y: 2 });

    const verticalOnly = reduce(base, 'presentation.clearManualPositions', {
      direction: 'vertical',
    });
    expect(verticalOnly.presentation.verticalNodePositions).toEqual({});
    expect(verticalOnly.presentation.nodePositions).toEqual(withPositions.nodePositions);

    const all = reduce(base, 'presentation.clearManualPositions', {});
    expect(all.presentation.nodePositions).toEqual({});
    expect(all.presentation.verticalNodePositions).toEqual({});
  });

  it('节点缩放限制为 0.35–2.00，分支兼容旧下限并支持 2.00', () => {
    const file = createMinimalBranchFile();
    for (const scale of [0.35, 2]) {
      expect(() =>
        reduce(file, 'presentation.setNodeScale', { nodeId: 'n_child', scale }),
      ).not.toThrow();
    }
    for (const scale of [0.34, 2.01, Number.NaN]) {
      expect(() =>
        reduce(file, 'presentation.setNodeScale', { nodeId: 'n_child', scale }),
      ).toThrow();
    }
    expect(() =>
      reduce(file, 'presentation.setScale', { nodeId: 'n_child', scale: 1.01 }),
    ).not.toThrow();
    expect(() =>
      reduce(file, 'presentation.setScale', { nodeId: 'n_child', scale: 2.01 }),
    ).toThrow();
    expect(() =>
      validatePresentation({ ...file.presentation, nodeScales: { n_child: 0.34 } }),
    ).toThrow();
  });

  it('presentation.replace 导入完整状态，规范哈希覆盖非默认新字段且兼容旧哈希', () => {
    const file = createMinimalBranchFile();
    const legacyHash = computePresentationHash(file.presentation);
    const parsedDefaults = SavedPresentationSchema.parse(file.presentation);
    expect(computePresentationHash(parsedDefaults)).toBe(legacyHash);

    const replacement = {
      ...parsedDefaults,
      layoutDirection: 'vertical' as const,
      verticalNodePositions: { n_root: { x: 80, y: 90 } },
      nodeScales: { n_root: 1.5 },
    };
    const result = reduce(file, 'presentation.replace', { presentation: replacement });
    expect(result.presentation).toMatchObject(replacement);
    expect(computePresentationHash(result.presentation)).not.toBe(legacyHash);

    result.presentation.verticalNodePositions!.n_root.x = 999;
    result.presentation.nodeScales!.n_root = 0.5;
    expect(replacement.verticalNodePositions.n_root).toEqual({ x: 80, y: 90 });
    expect(replacement.nodeScales.n_root).toBe(1.5);
  });

  it('删除节点清理两个方向的位置、缩放与折叠引用', () => {
    const file = createMinimalBranchFile();
    const presentation = {
      ...file.presentation,
      nodePositions: { n_child: { x: 1, y: 2 } },
      verticalNodePositions: { n_child: { x: 3, y: 4 } },
      branchScales: { n_child: 0.5 },
      nodeScales: { n_child: 1.5 },
      collapsedByDefault: ['n_child'],
    };
    const result = reduce({ ...file, presentation }, 'node.remove', { id: 'n_child' }, 'domain');
    expect(result.presentation.nodePositions.n_child).toBeUndefined();
    expect(result.presentation.verticalNodePositions?.n_child).toBeUndefined();
    expect(result.presentation.branchScales.n_child).toBeUndefined();
    expect(result.presentation.nodeScales?.n_child).toBeUndefined();
    expect(result.presentation.collapsedByDefault).not.toContain('n_child');
  });
});

describe('Phase 2 history 与 EditorController', () => {
  it('历史条目支持日期、方向、横纵拖动、缩放、折叠与方向化恢复', async () => {
    const { editor } = await setupEditor();
    await editor.run(setStartAtEntry(editor.getSnapshot().file.domain, 'n_child', '2026-11-12'));
    expect(editor.getSnapshot().file.domain.nodes[1]!.startAt).toBe('2026-11-12');
    await editor.undo();
    expect(editor.getSnapshot().file.domain.nodes[1]!.startAt).toBeNull();
    const semanticAfterDateUndo = editor.getSnapshot().file.revisions.semanticHash;

    await editor.run(setLayoutDirectionEntry(editor.getSnapshot().file, 'vertical'));
    await editor.run(moveEntry([{ nodeId: 'n_child', from: { x: 0, y: 0 }, to: { x: 4, y: 5 } }]));
    await editor.run(
      moveEntry([{ nodeId: 'n_child', from: { x: 0, y: 0 }, to: { x: 40, y: 50 } }], 'vertical'),
    );
    await editor.run(setNodeScaleEntry(editor.getSnapshot().file, 'n_child', 1.5));
    await editor.run(setBranchScaleEntry(editor.getSnapshot().file, 'n_child', 2));
    await editor.run(setCollapsedEntry(editor.getSnapshot().file, 'n_child', true));

    let current = editor.getSnapshot().file;
    expect(current.presentation.layoutDirection).toBe('vertical');
    expect(current.presentation.nodePositions.n_child).toEqual({ x: 4, y: 5 });
    expect(current.presentation.verticalNodePositions?.n_child).toEqual({ x: 40, y: 50 });
    expect(current.presentation.nodeScales?.n_child).toBe(1.5);
    expect(current.presentation.branchScales.n_child).toBe(2);
    expect(current.presentation.collapsedByDefault).toContain('n_child');

    await editor.run(clearPositionEntry(editor.getSnapshot().file, 'n_child', 'vertical'));
    expect(editor.getSnapshot().file.presentation.verticalNodePositions?.n_child).toBeUndefined();
    expect(editor.getSnapshot().file.presentation.nodePositions.n_child).toEqual({ x: 4, y: 5 });
    await editor.undo();
    expect(editor.getSnapshot().file.presentation.verticalNodePositions?.n_child).toEqual({
      x: 40,
      y: 50,
    });

    await editor.run(clearPositionsEntry(editor.getSnapshot().file, 'vertical'));
    expect(editor.getSnapshot().file.presentation.verticalNodePositions).toEqual({});
    expect(editor.getSnapshot().file.presentation.nodePositions.n_child).toEqual({ x: 4, y: 5 });
    await editor.undo();
    current = editor.getSnapshot().file;
    expect(current.presentation.verticalNodePositions?.n_child).toEqual({ x: 40, y: 50 });
    expect(current.revisions.semanticHash).toBe(semanticAfterDateUndo);
  });

  it('DragCoalescer 在 begin/move/finish 间保留方向且仍只生成一个命令', () => {
    const drag = new DragCoalescer();
    drag.begin('n_child', { x: 0, y: 0 }, 'vertical');
    for (let frame = 1; frame <= 100; frame += 1) {
      drag.move('n_child', { x: frame, y: frame * 2 });
    }
    const batch = drag.finish();
    expect(batch?.frames).toBe(100);
    expect(batch?.mergedCommands).toBe(1);
    expect(batch?.entry.forward[0]?.payload).toMatchObject({
      direction: 'vertical',
      x: 100,
      y: 200,
    });
  });

  it('importFile 分别经 CommandService 替换两层，单次 Undo/Redo 同时还原', async () => {
    const { editor, file, service } = await setupEditor();
    const executeBatch = vi.spyOn(service, 'executeBatch');
    const beforeDomain = canonicalize(file.domain);
    const beforePresentationHash = computePresentationHash(file.presentation);
    const imported = createMinimalBranchFile();
    imported.domain.nodes[0]!.title = 'Imported root';
    imported.domain.nodes[0]!.startAt = '2026-11-12';
    imported.presentation = {
      ...imported.presentation,
      layoutDirection: 'vertical',
      verticalNodePositions: { n_root: { x: 90, y: 100 } },
      nodeScales: { n_root: 1.8 },
    };

    await editor.importFile(imported);
    expect(editor.getSnapshot().error).toBeNull();
    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(
      executeBatch.mock.calls.map(([input]) => (input as { stateClass: StateClass }).stateClass),
    ).toEqual(['domain', 'presentation']);
    expect(editor.getSnapshot().file.domain.nodes[0]!.title).toBe('Imported root');
    expect(editor.getSnapshot().file.presentation.layoutDirection).toBe('vertical');
    expect(editor.getSnapshot().file.presentation.verticalNodePositions?.n_root).toEqual({
      x: 90,
      y: 100,
    });
    expect(editor.getSnapshot().undoDepth).toBe(1);

    await editor.undo();
    expect(editor.getSnapshot().error).toBeNull();
    expect(canonicalize(editor.getSnapshot().file.domain)).toBe(beforeDomain);
    expect(computePresentationHash(editor.getSnapshot().file.presentation)).toBe(
      beforePresentationHash,
    );
    expect(editor.getSnapshot().file.presentation.nodeScales?.n_root).toBeUndefined();

    await editor.redo();
    expect(editor.getSnapshot().file.domain.nodes[0]!.title).toBe('Imported root');
    expect(editor.getSnapshot().file.presentation.nodeScales?.n_root).toBe(1.8);
    expect(executeBatch).toHaveBeenCalledTimes(6);
  });

  it('edge style is presentation-only and participates in presentation hash', () => {
    const file = createMinimalBranchFile();
    const style = {
      color: '#123abc',
      width: 4,
      lineStyle: 'dotted' as const,
      arrow: 'both' as const,
    };
    const beforeSemantic = computeSemanticHash(file.domain);
    const beforePresentation = computePresentationHash(file.presentation);
    const result = reduce(file, 'presentation.setEdgeStyle', { edgeId: 'e_test', style });
    expect(result.commit).toBeNull();
    expect(computeSemanticHash(result.domain)).toBe(beforeSemantic);
    expect(computePresentationHash(result.presentation)).not.toBe(beforePresentation);
    expect(result.presentation.edgeStyles?.e_test).toEqual(style);
    expect(() => validatePresentation(result.presentation)).not.toThrow();

    const styledFile = { ...file, presentation: result.presentation };
    const cleared = reduce(styledFile, 'presentation.setEdgeStyle', {
      edgeId: 'e_test',
      style: null,
    });
    const fileWithoutField = { ...file, presentation: { ...file.presentation } };
    expect(computePresentationHash(cleared.presentation)).toBe(
      computePresentationHash(fileWithoutField.presentation),
    );
  });
});
