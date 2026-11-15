/**
 * Phase 1 回归测试基准数据（保持 Phase 1 验收套件结构稳定性）。
 * 供 tests/ 下的各自动化测试用例专用。
 */
import {
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  makeId,
} from '@workspacetree/core';
import {
  SCHEMA_VERSION,
  type BranchFile,
  type DomainState,
  type Edge,
  type Node,
  type Task,
} from '@workspacetree/schema';

export const DEMO_PROJECT_ID = 'prj_thesis_demo_v3';

const EXP_DIAGRAM_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="68" viewBox="0 0 220 68">' +
      '<rect width="220" height="68" rx="8" fill="#eff6ff" stroke="#93c5fd"/>' +
      '<rect x="10" y="18" width="52" height="32" rx="6" fill="#2563eb"/>' +
      '<text x="36" y="38" font-size="11" fill="#ffffff" text-anchor="middle" font-family="sans-serif">刺激呈现</text>' +
      '<path d="M64 34 L82 34" stroke="#2563eb" stroke-width="2" marker-end="url(#a)"/>' +
      '<rect x="84" y="18" width="52" height="32" rx="6" fill="#ffffff" stroke="#2563eb"/>' +
      '<text x="110" y="38" font-size="11" fill="#1e3a8a" text-anchor="middle" font-family="sans-serif">按键反应</text>' +
      '<path d="M138 34 L156 34" stroke="#2563eb" stroke-width="2"/>' +
      '<rect x="158" y="18" width="52" height="32" rx="6" fill="#16a34a"/>' +
      '<text x="184" y="38" font-size="11" fill="#ffffff" text-anchor="middle" font-family="sans-serif">记录数据</text>' +
      '</svg>',
  );

const DEMO_NOTES: Record<string, string> = {
  n_root: [
    '## **博士学位论文总览**',
    '- [*] 确定核心研究问题与{color:#2563eb}时间主线{/color}',
    '- [ ] 完成三章正文与==最终答辩==',
  ].join('\n'),
  n_writing_outline: [
    '**写作进度清单**',
    '- [*] 搭建全文章节骨架',
    '- [ ] 整合{color:#16a34a}实验结果图表{/color}',
  ].join('\n'),
  n_exp: [
    '**实验范式示意**',
    '- [*] 确认试次时长与随机化',
    `![实验设计流程](${EXP_DIAGRAM_DATA_URI})`,
  ].join('\n'),
  n_analysis: [
    '**{color:#dc2626}核心分析指标{/color}**',
    '- [*] 行为正确率与反应时 `RT`',
    '- [ ] ==层级贝叶斯模型对比==',
  ].join('\n'),
  n_analysis_summary: [
    '- [*] 导出矢量图 `SVG/PDF`',
    '- [ ] 同步至{color:#16a34a}论文资料整理{/color}',
  ].join('\n'),
};

interface DemoNodeSeed {
  id: string;
  title: string;
  parentId: string | null;
  startAt: string;
  tasks?: readonly { title: string; done?: boolean }[];
}

const DEMO_NODES: readonly DemoNodeSeed[] = [
  { id: 'n_root', title: '博士论文', parentId: null, startAt: '2026-01-01' },
  {
    id: 'n_init',
    title: '初始化项目',
    parentId: 'n_root',
    startAt: '2026-01-05',
    tasks: [
      { title: '建立仓库与目录结构', done: true },
      { title: '确定里程碑时间表', done: true },
    ],
  },

  // ── 论文写作分支（绿色）────────────────────────────────────────
  {
    id: 'n_writing_init',
    title: '初始化写作',
    parentId: 'n_init',
    startAt: '2026-01-12',
    tasks: [{ title: '确定学位论文规范', done: true }],
  },
  {
    id: 'n_writing_template',
    title: '准备好模板',
    parentId: 'n_writing_init',
    startAt: '2026-01-18',
    tasks: [{ title: '配置页面与字体样式', done: true }],
  },
  {
    id: 'n_writing_template_latex',
    title: 'LaTeX 模板配置',
    parentId: 'n_writing_template',
    startAt: '2026-01-19',
  },
  {
    id: 'n_writing_template_bib',
    title: '参考文献样式',
    parentId: 'n_writing_template',
    startAt: '2026-01-21',
  },

  {
    id: 'n_writing_outline',
    title: '完成大纲',
    parentId: 'n_writing_init',
    startAt: '2026-02-01',
    tasks: [
      { title: '梳理全文章节逻辑', done: true },
      { title: '导师审阅大纲', done: false },
    ],
  },
  {
    id: 'n_writing_ch1',
    title: '完成第一章',
    parentId: 'n_writing_outline',
    startAt: '2026-02-15',
    tasks: [{ title: '撰写研究背景与问题提出', done: false }],
  },
  {
    id: 'n_writing_ch1_intro',
    title: '引言与背景',
    parentId: 'n_writing_ch1',
    startAt: '2026-02-16',
  },
  {
    id: 'n_writing_ch1_review',
    title: '文献综述',
    parentId: 'n_writing_ch1',
    startAt: '2026-02-20',
  },

  {
    id: 'n_writing_ch2',
    title: '完成第二章',
    parentId: 'n_writing_outline',
    startAt: '2026-03-01',
    tasks: [{ title: '整理实验与建模方法', done: false }],
  },
  {
    id: 'n_writing_ch2_method',
    title: '实验方法描述',
    parentId: 'n_writing_ch2',
    startAt: '2026-03-02',
  },
  {
    id: 'n_writing_ch2_model',
    title: '理论模型推导',
    parentId: 'n_writing_ch2',
    startAt: '2026-03-06',
  },

  {
    id: 'n_writing_materials',
    title: '完成资料整理',
    parentId: 'n_writing_init',
    startAt: '2026-02-10',
    tasks: [{ title: '归档图表与原始数据索引', done: false }],
  },
  {
    id: 'n_writing_mat_fig',
    title: '图表素材归档',
    parentId: 'n_writing_materials',
    startAt: '2026-02-11',
  },
  {
    id: 'n_writing_mat_code',
    title: '复现脚本整理',
    parentId: 'n_writing_materials',
    startAt: '2026-02-13',
  },

  // ── 实验分支（蓝色）────────────────────────────────────────────
  {
    id: 'n_exp',
    title: '实验',
    parentId: 'n_init',
    startAt: '2026-01-15',
    tasks: [{ title: '确定实验范式与样本量', done: true }],
  },
  {
    id: 'n_exp_program',
    title: '实验程序',
    parentId: 'n_exp',
    startAt: '2026-01-22',
    tasks: [{ title: '完成 PsychoPy 脚本与触发器测试', done: true }],
  },
  {
    id: 'n_exp_prog_stim',
    title: '刺激材料制作',
    parentId: 'n_exp_program',
    startAt: '2026-01-23',
  },
  { id: 'n_exp_prog_pilot', title: '预实验调试', parentId: 'n_exp_program', startAt: '2026-01-26' },

  {
    id: 'n_exp_collect',
    title: '数据收集',
    parentId: 'n_exp_program',
    startAt: '2026-02-01',
    tasks: [
      { title: '完成主实验数据采集', done: true },
      { title: '被试数据质量核查', done: false },
    ],
  },
  {
    id: 'n_exp_collect_recruit',
    title: '被试招募',
    parentId: 'n_exp_collect',
    startAt: '2026-02-02',
  },
  { id: 'n_exp_collect_run', title: '正式施测', parentId: 'n_exp_collect', startAt: '2026-02-06' },

  // ── 数据分析分支（红色，承接数据收集）──────────────────────────
  {
    id: 'n_analysis',
    title: '数据分析',
    parentId: 'n_exp_collect',
    startAt: '2026-02-12',
    tasks: [{ title: '搭建统一分析管线', done: true }],
  },
  {
    id: 'n_analysis_init',
    title: '项目初始化',
    parentId: 'n_analysis',
    startAt: '2026-02-16',
    tasks: [{ title: '配置环境与 BIDS 目录', done: true }],
  },
  {
    id: 'n_analysis_prelim',
    title: '初步分析',
    parentId: 'n_analysis_init',
    startAt: '2026-02-22',
    tasks: [{ title: '完成行为指标与预处理', done: true }],
  },
  {
    id: 'n_analysis_prelim_clean',
    title: '数据清洗',
    parentId: 'n_analysis_prelim',
    startAt: '2026-02-23',
  },
  {
    id: 'n_analysis_prelim_desc',
    title: '描述统计',
    parentId: 'n_analysis_prelim',
    startAt: '2026-02-25',
  },

  {
    id: 'n_analysis_explore',
    title: '探索分析',
    parentId: 'n_analysis_init',
    startAt: '2026-02-26',
    tasks: [{ title: '模型比较与敏感性检验', done: false }],
  },
  {
    id: 'n_analysis_exp_model',
    title: '模型拟合对比',
    parentId: 'n_analysis_explore',
    startAt: '2026-02-28',
  },
  {
    id: 'n_analysis_exp_check',
    title: '稳健性检验',
    parentId: 'n_analysis_explore',
    startAt: '2026-03-02',
  },

  {
    id: 'n_analysis_summary',
    title: '结果整理',
    parentId: 'n_analysis_prelim',
    startAt: '2026-03-05',
    tasks: [{ title: '汇总统计表与核心图件', done: false }],
  },
  {
    id: 'n_analysis_sum_fig',
    title: '核心图表输出',
    parentId: 'n_analysis_summary',
    startAt: '2026-03-07',
  },

  {
    id: 'n_analysis_report',
    title: '汇报',
    parentId: 'n_analysis_summary',
    startAt: '2026-03-12',
    tasks: [{ title: '组会阶段性汇报', done: false }],
  },
  {
    id: 'n_analysis_rep_slides',
    title: '组会幻灯片',
    parentId: 'n_analysis_report',
    startAt: '2026-03-14',
  },
];

export function createDemoDomain(): DomainState {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const tasks: Task[] = [];
  const blocks: DomainState['blocks'] = [];

  for (const seed of DEMO_NODES) {
    const note = DEMO_NOTES[seed.id];
    const blockIds: string[] = [];
    if (note) {
      const blockId = `blk_note_${seed.id}`;
      blocks.push({ id: blockId, kind: 'text', payload: { markdown: note } });
      blockIds.push(blockId);
    }
    nodes.push({
      id: seed.id,
      title: seed.title,
      parentId: seed.parentId,
      blockIds,
      archived: false,
      startAt: seed.startAt,
    });
    if (seed.parentId !== null) {
      edges.push({
        id: `e_h_${seed.id}`,
        type: 'hierarchy',
        fromNodeId: seed.parentId,
        toNodeId: seed.id,
      });
    }
    seed.tasks?.forEach((task, index) => {
      tasks.push({
        id: `tsk_${seed.id}_${index + 1}`,
        nodeId: seed.id,
        title: task.title,
        done: Boolean(task.done),
      });
    });
  }

  const crossPairs: readonly [string, string, Edge['type']][] = [
    ['n_analysis_prelim', 'n_writing_template', 'dependency'],
    ['n_analysis_summary', 'n_writing_materials', 'dependency'],
    ['n_analysis_explore', 'n_analysis_summary', 'dependency'],
    ['n_exp_collect', 'n_writing_ch2_method', 'reference'],
    ['n_analysis_report', 'n_writing_outline', 'custom'],
  ];
  crossPairs.forEach(([from, to, type], index) => {
    edges.push({
      id: `e_x_${index + 1}`,
      type,
      fromNodeId: from,
      toNodeId: to,
    });
  });

  const spines = [
    {
      id: 'spn_demo_1',
      title: '主干 1 · 论文写作',
      nodeIds: ['n_root', 'n_init', 'n_writing_init', 'n_writing_outline', 'n_writing_ch1'],
    },
    {
      id: 'spn_demo_2',
      title: '主干 2 · 实验流程',
      nodeIds: ['n_root', 'n_init', 'n_exp', 'n_exp_program', 'n_exp_collect'],
    },
    {
      id: 'spn_demo_3',
      title: '主干 3 · 数据分析',
      nodeIds: [
        'n_root',
        'n_init',
        'n_exp',
        'n_exp_program',
        'n_exp_collect',
        'n_analysis',
        'n_analysis_init',
        'n_analysis_prelim',
        'n_analysis_summary',
        'n_analysis_report',
      ],
    },
  ];

  return {
    project: {
      id: DEMO_PROJECT_ID,
      title: '博士论文 · 研究与写作全流程',
      rootNodeId: 'n_root',
    },
    nodes,
    edges,
    tasks,
    spines,
    blocks,
    projectRefs: [],
    archived: false,
    archiveMeta: null,
  };
}

export function createDemoBranchFile(): BranchFile {
  const domain = createDemoDomain();
  const file: BranchFile = {
    schemaVersion: SCHEMA_VERSION,
    projectId: DEMO_PROJECT_ID,
    activeBranch: 'main',
    domain,
    presentation: {
      nodePositions: {},
      branchScales: {},
      collapsedByDefault: [],
      savedSpineDisplay: null,
      layoutDirection: 'vertical',
      verticalNodePositions: {},
      nodeSizes: {
        n_root: { width: 250, height: 150 },
        n_writing_outline: { width: 240, height: 132 },
        n_exp: { width: 250, height: 185 },
        n_analysis: { width: 240, height: 135 },
        n_analysis_summary: { width: 230, height: 118 },
      },
      nodeScales: {
        n_root: 1.15,
        n_analysis: 1.1,
        n_writing_template_latex: 0.52,
        n_writing_template_bib: 0.52,
        n_writing_ch1_intro: 0.52,
        n_writing_ch1_review: 0.52,
        n_writing_ch2_method: 0.52,
        n_writing_ch2_model: 0.52,
        n_writing_mat_fig: 0.52,
        n_writing_mat_code: 0.52,
        n_exp_prog_stim: 0.52,
        n_exp_prog_pilot: 0.52,
        n_exp_collect_recruit: 0.52,
        n_exp_collect_run: 0.52,
        n_analysis_prelim_clean: 0.52,
        n_analysis_prelim_desc: 0.52,
        n_analysis_exp_model: 0.52,
        n_analysis_exp_check: 0.52,
        n_analysis_sum_fig: 0.52,
        n_analysis_rep_slides: 0.52,
      },
    },
    revisions: {
      semanticRevision: 0,
      semanticHash: '',
      presentationRevision: 0,
      presentationHash: '',
      fileHash: '',
      fileWriteVersion: 0,
    },
  };
  file.revisions.semanticHash = computeSemanticHash(domain);
  file.revisions.presentationHash = computePresentationHash(file.presentation);
  file.revisions.fileHash = computeFileHash(file);
  return file;
}

export function createEmptyBranchFile(title = '新分支项目', branchName = 'main'): BranchFile {
  const projectId = makeId('prj_');
  const rootNodeId = makeId('n_root_');
  const domain: DomainState = {
    project: {
      id: projectId,
      title,
      rootNodeId,
    },
    nodes: [
      {
        id: rootNodeId,
        title: '项目主干根',
        parentId: null,
        blockIds: [],
        archived: false,
        startAt: null,
      },
    ],
    edges: [],
    tasks: [],
    spines: [],
    blocks: [],
    projectRefs: [],
    archived: false,
    archiveMeta: null,
  };
  const presentation = {
    nodePositions: {},
    verticalNodePositions: {},
    branchScales: {},
    nodeScales: {},
    collapsedByDefault: [],
    savedSpineDisplay: null,
    layoutDirection: 'vertical' as const,
  };
  const file: BranchFile = {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeBranch: branchName,
    domain,
    presentation,
    revisions: {
      semanticRevision: 0,
      semanticHash: '',
      presentationRevision: 0,
      presentationHash: '',
      fileHash: '',
      fileWriteVersion: 0,
    },
  };
  file.revisions.semanticHash = computeSemanticHash(domain);
  file.revisions.presentationHash = computePresentationHash(file.presentation);
  file.revisions.fileHash = computeFileHash(file);
  return file;
}
