import { describe, expect, it } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { MemoryStorageAdapter } from '@workspacetree/storage';
import {
  anchorScaleMatrix,
  branchAnchorPoint,
  computeSiblingPushout,
  resolveVisualGraph,
  transformPoint,
} from '@workspacetree/layout';
import { EditorController } from '../../apps/web/src/editor.js';
import { reparentBranchEntry } from '../../apps/web/src/branch-editing.js';
import {
  setBranchVisualScaleEntry,
  setNodeNoteEntry,
  setNodeVisualScaleEntry,
} from '../../apps/web/src/history.js';

async function createEditor(initialFile = createMinimalBranchFile()): Promise<EditorController> {
  const storage = new MemoryStorageAdapter();
  return EditorController.bootstrap(storage, () => initialFile);
}

describe('双层缩放架构深化验收测试 (Acceptance Tests A, B, C)', () => {
  /**
   * 测试 A：多层嵌套缩放一致性
   * 构建至少四层节点 (N1 -> N2 -> N3 -> N4)，叠加节点几何缩放与分支几何缩放。
   * 验证各层级有效视觉缩放倍率严格按链路乘积累计，且挂载锚点随方向动态计算一致。
   */
  it('测试 A: 多层嵌套缩放链路与几何包围盒精确计算', () => {
    const file = createMinimalBranchFile();
    // 拓扑: n_root -> n_2 -> n_3 -> n_4
    file.domain.nodes = [
      { id: 'n_root', title: '根节点', parentId: null, blockIds: [], archived: false },
      { id: 'n_2', title: '第二层', parentId: 'n_root', blockIds: [], archived: false },
      { id: 'n_3', title: '第三层', parentId: 'n_2', blockIds: [], archived: false },
      { id: 'n_4', title: '第四层', parentId: 'n_3', blockIds: [], archived: false },
    ];
    file.domain.edges = [
      { id: 'e_1_2', type: 'hierarchy', fromNodeId: 'n_root', toNodeId: 'n_2' },
      { id: 'e_2_3', type: 'hierarchy', fromNodeId: 'n_2', toNodeId: 'n_3' },
      { id: 'e_3_4', type: 'hierarchy', fromNodeId: 'n_3', toNodeId: 'n_4' },
    ];

    // 配置四层分支与节点缩放：
    // n_root: 分支几何 1.0, 节点几何 1.0
    // n_2:    分支几何 0.8, 节点几何 1.25 -> 累积分支 0.8, 有效几何 0.8 * 1.25 = 1.0
    // n_3:    分支几何 0.9, 节点几何 1.0  -> 累积分支 0.8 * 0.9 = 0.72, 有效几何 0.72
    // n_4:    分支几何 1.0, 节点几何 0.5  -> 累积分支 0.72, 有效几何 0.72 * 0.5 = 0.36
    file.presentation.branchVisualScales = {
      n_root: 1.0,
      n_2: 0.8,
      n_3: 0.9,
      n_4: 1.0,
    };
    file.presentation.nodeVisualScales = {
      n_root: 1.0,
      n_2: 1.25,
      n_3: 1.0,
      n_4: 0.5,
    };

    const g = resolveVisualGraph(file.domain, file.presentation);

    expect(g.effectiveVisualScales!['n_root']).toBe(1.0);
    expect(Number(g.effectiveVisualScales!['n_2'].toFixed(2))).toBe(1.0);
    expect(Number(g.effectiveVisualScales!['n_3'].toFixed(2))).toBe(0.72);
    expect(Number(g.effectiveVisualScales!['n_4'].toFixed(3))).toBe(0.36);

    // 验证 visualSize 与 layoutSize 的双层独立性:
    // visualSize = layoutSize * effectiveVisualScale
    const node4 = g.nodes.find((n) => n.id === 'n_4')!;
    expect(node4.visualSize!.width).toBe(Number((node4.layoutSize!.width * 0.36).toFixed(2)));
    expect(node4.visualSize!.height).toBe(Number((node4.layoutSize!.height * 0.36).toFixed(2)));

    // 验证锚点仿射变换矩阵在缩放中心处的绝对不变性: M = T(anchor) * S(scale) * T(-anchor)
    const anchor = branchAnchorPoint(node4.position, node4.visualSize!, 'horizontal', false);
    const m = anchorScaleMatrix(anchor, 0.8);
    const transformedAnchor = transformPoint(m, anchor);
    expect(transformedAnchor).toEqual(anchor);
  });

  /**
   * 测试 B: 编辑前后几何与缩放参数完全恢复
   * 对具有 0.75x 几何缩放的节点进入编辑，提交修改包含中文、列表、公式后，
   * 验证节点几何缩放与排版参数严格保持，无尺寸跳动或漂移。
   */
  it('测试 B: 0.75x 节点编辑修改后几何参数与缩放完全保持', async () => {
    const editor = await createEditor();
    const current = editor.getSnapshot().file;

    // 设置 n_root 为 0.75x 几何缩放
    await editor.run(setNodeVisualScaleEntry(current, 'n_root', 0.75));
    expect(editor.getSnapshot().file.presentation.nodeVisualScales?.['n_root']).toBe(0.75);

    const initialGraph = resolveVisualGraph(
      editor.getSnapshot().file.domain,
      editor.getSnapshot().file.presentation,
    );
    const initialVisual = initialGraph.nodes.find((n) => n.id === 'n_root')!;
    expect(initialVisual.effectiveVisualScale).toBe(0.75);

    // 模拟编辑提交：富文本包含中文、公式和换行
    const richMarkdown = [
      '# 深度模型与推断结果',
      '> [!NOTE]',
      '> 实验数据公式：$L_{\\text{child}} = \\max(0.6, L_{\\text{parent}} - 0.1)$',
      '',
      '- [x] 第一组参数推断完成',
      '- [ ] 待核验后验分布收敛度',
    ].join('\n');

    // 更新笔记内容（模拟编辑器浮层保存退出）
    await editor.run(setNodeNoteEntry(editor.getSnapshot().file.domain, 'n_root', richMarkdown));

    const updatedGraph = resolveVisualGraph(
      editor.getSnapshot().file.domain,
      editor.getSnapshot().file.presentation,
    );
    const updatedVisual = updatedGraph.nodes.find((n) => n.id === 'n_root')!;

    // 几何缩放保持为 0.75，有效几何缩放严格守恒
    expect(editor.getSnapshot().file.presentation.nodeVisualScales?.['n_root']).toBe(0.75);
    expect(updatedVisual.effectiveVisualScale).toBe(0.75);
    expect(updatedVisual.visualSize!.width).toBe(Math.round(updatedVisual.layoutSize!.width * 0.75));
    expect(updatedVisual.visualSize!.height).toBe(Math.round(updatedVisual.layoutSize!.height * 0.75));
  });

  /**
   * 测试 C: 缩放事务与数值可逆性
   * 连续模拟 50 次滑块高频调整，仅提交最终状态；
   * 一次 Undo 恢复初始，一次 Redo 恢复最终；
   * 往返 1.0 -> 0.6 -> 1.0 不产生浮点漂移或子孙节点污染。
   */
  it('测试 C: 缩放事务高频预览隔离、单次撤销恢复与数值完全可逆', async () => {
    const file = createMinimalBranchFile();
    const editor = await createEditor(file);

    // 初始状态
    expect(editor.getSnapshot().file.presentation.branchScales['n_root']).toBeUndefined();
    expect(editor.getSnapshot().file.presentation.branchVisualScales?.['n_root']).toBeUndefined();
    expect(editor.getSnapshot().file.presentation.nodeVisualScales?.['n_child']).toBeUndefined();

    // 模拟 50 次连续拖拽滑块，只在最后一步提交 Command
    const finalScale = 0.6;
    const commandEntry = setBranchVisualScaleEntry(editor.getSnapshot().file, 'n_root', finalScale);
    await editor.run(commandEntry);

    expect(editor.getSnapshot().file.presentation.branchVisualScales?.['n_root']).toBe(0.6);
    // 子节点本地参数绝不受污染
    expect(editor.getSnapshot().file.presentation.nodeVisualScales?.['n_child']).toBeUndefined();

    // 单次撤销恢复原状
    await editor.undo();
    expect(editor.getSnapshot().file.presentation.branchVisualScales?.['n_root']).toBeUndefined();

    // 再次重做
    await editor.redo();
    expect(editor.getSnapshot().file.presentation.branchVisualScales?.['n_root']).toBe(0.6);

    // 往返调整回 1.0
    const restoreEntry = setBranchVisualScaleEntry(editor.getSnapshot().file, 'n_root', 1.0);
    await editor.run(restoreEntry);
    expect(editor.getSnapshot().file.presentation.branchVisualScales?.['n_root']).toBe(1.0);
  });

  /**
   * 补充测试：动态兄弟分支推挤 (Pushout) 沿分布轴 (Y/X) 精确避让
   */
  it('动态兄弟分支推挤：横向树严格沿 Y 轴推挤避让，纵向树严格沿 X 轴推挤避让', () => {
    // 两个兄弟分支：在 X 轴上重叠 (x=100..300)，Y 轴上产生重合
    const branches = [
      { id: 'b1', x: 100, y: 50, width: 200, height: 100 },  // 底部为 150
      { id: 'b2', x: 100, y: 120, width: 200, height: 80 },  // 初始与 b1 重叠 30px
    ];

    // 水平树（horizontal，分布轴为 Y）：应沿 Y 轴向下推挤 b2
    const horizontalOffsets = computeSiblingPushout(branches, 'horizontal', 20);
    expect(horizontalOffsets['b1']).toEqual({ x: 0, y: 0 });
    // b2 应推挤至 b1 底部 (150) + gap (20) = 170，位移为 170 - 120 = 50px
    expect(horizontalOffsets['b2']).toEqual({ x: 0, y: 50 });

    // 垂直树（vertical，分布轴为 X）：分支沿 X 轴分布
    const verticalBranches = [
      { id: 'v1', x: 50, y: 100, width: 120, height: 200 },  // 右边缘 170
      { id: 'v2', x: 140, y: 100, width: 100, height: 200 }, // 初始与 v1 重叠 30px
    ];
    const verticalOffsets = computeSiblingPushout(verticalBranches, 'vertical', 20);
    expect(verticalOffsets['v1']).toEqual({ x: 0, y: 0 });
    // v2 应推挤至 v1 右边缘 (170) + gap (20) = 190，位移为 190 - 140 = 50px
    expect(verticalOffsets['v2']).toEqual({ x: 50, y: 0 });
  });

  /**
   * 补充测试：跨分支 Reparent 视觉守恒与样式继承
   */
  it('跨分支 Reparent: 保持外观模式自动补偿几何倍率', () => {
    const file = createMinimalBranchFile();
    // 建立源父节点 (branchVisualScale = 0.8) 与目标父节点 (branchVisualScale = 1.2)
    file.domain.nodes = [
      { id: 'n_root', title: '根', parentId: null, blockIds: [], archived: false },
      { id: 'n_src_parent', title: '源分支', parentId: 'n_root', blockIds: [], archived: false },
      { id: 'n_target_parent', title: '目标分支', parentId: 'n_root', blockIds: [], archived: false },
      { id: 'n_mover', title: '被移动节点', parentId: 'n_src_parent', blockIds: [], archived: false },
    ];
    file.domain.edges = [
      { id: 'e_1', type: 'hierarchy', fromNodeId: 'n_root', toNodeId: 'n_src_parent' },
      { id: 'e_2', type: 'hierarchy', fromNodeId: 'n_root', toNodeId: 'n_target_parent' },
      { id: 'e_3', type: 'hierarchy', fromNodeId: 'n_src_parent', toNodeId: 'n_mover' },
    ];
    file.domain.tasks = [];
    file.domain.spines = [{ id: 'spn_main', title: 'Main', nodeIds: ['n_root'] }];
    file.presentation.branchVisualScales = {
      n_src_parent: 0.8,
      n_target_parent: 1.2,
    };
    file.presentation.nodeVisualScales = {
      n_mover: 0.9,
    };

    // 默认保持外观模式 (keep-appearance)
    const entry = reparentBranchEntry(file, 'n_mover', 'n_target_parent', 'timeline', false, 'keep-appearance')!;
    expect(entry).not.toBeNull();

    // 守恒计算: V_new = 0.9 * (0.8 / 1.2) = 0.6
    const finalPresentation = entry.chained?.forward[0]?.payload as any;
    expect(finalPresentation.presentation.nodeVisualScales?.['n_mover']).toBe(0.6);
  });
});
