/**
 * 固定种子 Golden Fixture 生成器（06 §一.7 / §二 Phase 0 验收 18、Q15）。
 * 合成研究项目，不依赖任何真实研究数据；生成脚本与种子一并提交，CI 可复现。
 * 运行：pnpm generate:golden
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { computeFileHash, computePresentationHash, computeSemanticHash } from '@workspacetree/core';
import {
  BranchFileSchema,
  SCHEMA_VERSION,
  type BranchFile,
  type DomainState,
  type Edge,
  type Node,
  type SavedPresentation,
  type Spine,
  type Task,
} from '@workspacetree/schema';

export const GOLDEN_SEED = 20261111;
export const GOLDEN_PROJECT_ID = 'prj_golden_thesis';

/** mulberry32：无外部依赖、跨运行时确定性的 32 位 PRNG。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 层级树：n_theory 是所有研究方向的共享前缀父节点，保证每条 Spine 都由真实
 * hierarchy 边连续构成（SpineSchema 契约 / 06 §二 Phase 2 G2）。
 * 归档与缩放数据不受层级调整影响；节点顺序保持不变以固定种子布局可复现。
 */
const HIERARCHY: readonly [string, string, string, boolean][] = [
  ['n_theory', 'n_thesis', '研究框架', false],
  ['n_sameness', 'n_theory', '相同性判断', false],
  ['n_conflict', 'n_theory', '冲突决策', false],
  ['n_legacy_theory', 'n_theory', '旧理论分支（已归档）', true],
  ['n_wpt', 'n_theory', 'WPT 子项目', false],
  ['n_wpt_design', 'n_wpt', 'WPT 实验设计', false],
  ['n_wpt_pilot', 'n_wpt', 'WPT 预实验', false],
  ['n_wpt_analysis', 'n_wpt', 'WPT 数据分析', false],
  ['n_pdd', 'n_theory', 'PDD 子项目', false],
  ['n_pdd_design', 'n_pdd', 'PDD 实验设计', false],
  ['n_pdd_model', 'n_pdd', 'PDD 计算建模', false],
  ['n_methods', 'n_theory', '方法', false],
  ['n_eeg', 'n_methods', 'EEG / ERP', false],
  ['n_cog_rnn', 'n_methods', '认知建模 RNN', false],
  ['n_writing', 'n_theory', '论文写作', false],
  ['n_ch1', 'n_writing', '第一章 文献综述', false],
  ['n_ch2', 'n_writing', '第二章 研究一', false],
];

/** 3 条共享前缀（n_thesis / n_theory）且各自连续的主干，不复制语义节点。 */
const SPINES: readonly [string, string, string[]][] = [
  ['spn_main', '主干：理论', ['n_thesis', 'n_theory', 'n_sameness']],
  ['spn_wpt', '主干：WPT', ['n_thesis', 'n_theory', 'n_wpt', 'n_wpt_design']],
  ['spn_methods', '主干：方法', ['n_thesis', 'n_theory', 'n_methods', 'n_cog_rnn']],
];

/** 跨分支边：dependency / reference / custom，默认视图只显示 hierarchy。 */
const CROSS_EDGES: readonly [string, Edge['type'], string, string][] = [
  ['e_dep_pilot_eeg', 'dependency', 'n_wpt_pilot', 'n_eeg'],
  ['e_dep_analysis_rnn', 'dependency', 'n_wpt_analysis', 'n_cog_rnn'],
  ['e_ref_pdd_sameness', 'reference', 'n_pdd_model', 'n_sameness'],
  ['e_ref_wpt_conflict', 'reference', 'n_wpt_design', 'n_conflict'],
  ['e_custom_ch1_legacy', 'custom', 'n_ch1', 'n_legacy_theory'],
];

const TASKS: readonly [string, string, string][] = [
  ['tsk_wpt_1', 'n_wpt_design', '确定刺激材料'],
  ['tsk_wpt_2', 'n_wpt_design', '预注册分析方案'],
  ['tsk_wpt_3', 'n_wpt_pilot', '完成 12 人预实验'],
  ['tsk_wpt_4', 'n_wpt_analysis', '清洗预实验数据'],
  ['tsk_pdd_1', 'n_pdd_model', '拟合基线模型'],
  ['tsk_eeg_1', 'n_eeg', '检查 N270 / P300 时间窗'],
  ['tsk_write_1', 'n_ch1', '补完相同性定义一节'],
];

export function createGoldenBranchFile(seed: number = GOLDEN_SEED): BranchFile {
  const random = seededRandom(seed);
  const nodes: Node[] = [
    { id: 'n_thesis', title: '论文总项目（合成）', parentId: null, blockIds: [], archived: false },
    ...HIERARCHY.map(([id, parentId, title, archived]) => ({
      id,
      title,
      parentId,
      blockIds: [],
      archived,
    })),
  ];

  const edges: Edge[] = [
    ...HIERARCHY.map(([id, parentId], index) => ({
      id: `e_h_${String(index + 1).padStart(3, '0')}`,
      type: 'hierarchy' as const,
      fromNodeId: parentId,
      toNodeId: id,
    })),
    ...CROSS_EDGES.map(([id, type, fromNodeId, toNodeId]) => ({
      id,
      type,
      fromNodeId,
      toNodeId,
    })),
  ];

  const spines: Spine[] = SPINES.map(([id, title, nodeIds]) => ({
    id,
    title,
    nodeIds: [...nodeIds],
  }));
  const tasks: Task[] = TASKS.map(([id, nodeId, title]) => ({ id, nodeId, title, done: false }));

  const domain: DomainState = {
    project: { id: GOLDEN_PROJECT_ID, title: '合成论文总项目', rootNodeId: 'n_thesis' },
    nodes,
    edges,
    tasks,
    spines,
    blocks: [],
    projectRefs: [
      { projectId: 'prj_wpt_sub', mode: 'link', hostNodeId: 'n_wpt' },
      { projectId: 'prj_pdd_sub', mode: 'preview', hostNodeId: 'n_pdd' },
    ],
    assets: {},
    // 归档与缩放分离（C8）：仅旧理论分支节点归档，项目本身未归档；缩放的是 WPT 分支。
    archived: false,
    archiveMeta: null,
  };

  const nodePositions: SavedPresentation['nodePositions'] = {};
  nodes.forEach((node, index) => {
    nodePositions[node.id] = {
      x: Math.round((index % 5) * 220 + random() * 40),
      y: Math.round(Math.floor(index / 5) * 150 + random() * 30),
    };
  });
  const presentation: SavedPresentation = {
    nodePositions,
    branchScales: { n_wpt: 0.45, n_legacy_theory: 0.8 },
    collapsedByDefault: ['n_writing'],
    savedSpineDisplay: 'spn_main',
  };

  const file: BranchFile = {
    schemaVersion: SCHEMA_VERSION,
    projectId: GOLDEN_PROJECT_ID,
    activeBranch: 'main',
    domain,
    presentation,
    revisions: {
      semanticRevision: 0,
      semanticHash: computeSemanticHash(domain),
      presentationRevision: 0,
      presentationHash: computePresentationHash(presentation),
      fileHash: '',
      fileWriteVersion: 0,
    },
  };
  file.revisions.fileHash = computeFileHash(file);
  return BranchFileSchema.parse(file);
}

/**
 * 写盘内容按项目 prettier 配置格式化，保证 `pnpm generate:golden` 之后
 * `pnpm format:check` 仍然通过（JSON.stringify 的逐元素换行与 printWidth 不一致）。
 */
export async function writeGoldenFixture(path?: string): Promise<string> {
  const target =
    path ?? resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/golden.branch.json');
  mkdirSync(dirname(target), { recursive: true });
  const raw = `${JSON.stringify(createGoldenBranchFile(), null, 2)}\n`;
  const options = await resolveConfig(target);
  const formatted = await format(raw, { ...options, filepath: target, parser: 'json' });
  writeFileSync(target, formatted, 'utf8');
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeGoldenFixture()
    .then((target) => {
      const file = createGoldenBranchFile();
      console.log(
        `Golden Fixture (seed=${GOLDEN_SEED}) -> ${target}\n` +
          `nodes=${file.domain.nodes.length} edges=${file.domain.edges.length} tasks=${file.domain.tasks.length} spines=${file.domain.spines.length}\n` +
          `semanticHash=${file.revisions.semanticHash}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
