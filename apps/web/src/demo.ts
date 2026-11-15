/**
 * WorkspaceTree 官方交互演示项目（技术全景与架构演进图）。
 * 全方位展示 WorkspaceTree 核心特性：
 * - 结合分支结构与日期的「时间树」与「日期优先」双模布局
 * - 2D / 3D 画布切换与主干（Spines）路径高亮
 * - 基于 CodeMirror 6 的 Markdown 实时渲染、Callout 告警框与 5 态任务体系（[ ] / [x] / [-] / [~] / [?]）
 * - Pele / Mermaid 架构流程图行内解析与渲染
 * - 跨分支关联边（dependency / reference / custom）与连线注释
 * - 分支折叠与子树统计汇总徽章
 * - 节点缩放、自定义卡片尺寸与多标签检索体系
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
  type TaskStatus,
} from '@workspacetree/schema';

export const DEMO_PROJECT_ID = 'prj_workspacetree_showcase_v1';

const ARCH_FLOW_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="74" viewBox="0 0 280 74">' +
      '<rect width="280" height="74" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>' +
      '<rect x="12" y="18" width="68" height="38" rx="6" fill="#3b82f6"/>' +
      '<text x="46" y="42" font-size="11" font-weight="600" fill="#ffffff" text-anchor="middle" font-family="system-ui, sans-serif">手势输入</text>' +
      '<path d="M84 37 L102 37" stroke="#3b82f6" stroke-width="2" marker-end="url(#arrow)"/>' +
      '<rect x="106" y="18" width="70" height="38" rx="6" fill="#ffffff" stroke="#3b82f6" stroke-width="1.5"/>' +
      '<text x="141" y="42" font-size="11" font-weight="600" fill="#1e40af" text-anchor="middle" font-family="system-ui, sans-serif">合批调度</text>' +
      '<path d="M180 37 L198 37" stroke="#3b82f6" stroke-width="2"/>' +
      '<rect x="202" y="18" width="66" height="38" rx="6" fill="#10b981"/>' +
      '<text x="235" y="42" font-size="11" font-weight="600" fill="#ffffff" text-anchor="middle" font-family="system-ui, sans-serif">时间树重绘</text>' +
      '</svg>',
  );

const DEMO_NOTES: Record<string, string> = {
  n_root: [
    '## **WorkspaceTree 核心愿景**',
    '> [!IMPORTANT]',
    '> **Local-First & Multi-View**：以树状拓扑组织工作，结合{color:#2563eb}时间树与日期优先双模布局{/color}，实现任务沉浸流转与复杂研发项目全局透视。',
    '',
    '- [x] 基于 Zod 严格契约的分层状态模型（ADR-013）',
    '- [~] 基于 CodeMirror 6 的 Markdown 实时预览与 5 态任务体系',
    '- [?] 探索基于 WebGPU 的超大规模拓扑（10,000+ 节点）渲染管道',
    '- [-] 废弃基于全量 Canvas 重绘的旧架构，全面拥抱局部响应流',
  ].join('\n'),

  n_branch_ui: [
    '### **多维画布渲染管道**',
    '> [!TIP]',
    '> 画布支持 **2D 平面流转** 与 **3D 空间主干透视** 自由切换，结合 LOD 视觉分级优化，万级视口下保持 60 FPS 流畅交互。',
    '',
    `![交互渲染流水线](${ARCH_FLOW_SVG})`,
  ].join('\n'),

  n_canvas_2d: [
    '**2D 视图与视口交互**',
    '- [x] 无级缩放与弹性平移（Pan & Zoom）',
    '- [x] 节点尺寸拖拽调整与分支统一缩放（Branch Scale）',
    '- [~] 视口内卡片边界对齐辅助线',
    '==双击空白处可随时快速创建子节点==',
  ].join('\n'),

  n_canvas_3d: [
    '### **3D 空间主干透视**',
    '> [!NOTE]',
    '> 切换至 3D 模式可进入立体空间视角，主干（Spine）以发光管线贯穿各时间节点，呈现直观的研发纵深感。',
  ].join('\n'),

  n_editor_tasks: [
    '### **5 态任务流转矩阵**',
    '- [x] `[x]` **已完成**：核心规范与解析器落地',
    '- [~] `[~]` **进行中**：快捷键 `Ctrl+Enter` 状态循环流转',
    '- [?] `[?]` **待确认**：跨分支任务工时汇总与进度折算模型',
    '- [-] `[-]` **已废弃**：废弃简单二态复选框方案',
    '- [ ] `[ ]` **待处理**：移动端长按弹出任务状态轮盘',
  ].join('\n'),

  n_editor_callouts: [
    '### **富文本与 Callout 告警框**',
    '> [!NOTE]',
    '> 用于补充背景说明、技术选型或环境配置需求。',
    '',
    '> [!TIP]',
    '> 技巧：支持 `{color:#ea580c}彩色文本{/color}` 与 `==重点高亮==` 语法。',
    '',
    '> [!WARNING]',
    '> 单个卡片笔记建议保持在 2000 字以内，以保证最佳排版阅读体验。',
  ].join('\n'),

  n_editor_diagrams: [
    '### **Pele / Mermaid 架构流程图**',
    '> [!TIP]',
    '> 行内直接书写标准 Mermaid 文本，由 Pele 渲染器即时生成无损矢量图。',
    '',
    '```mermaid',
    'graph LR',
    '  A[用户手势输入] --> B[DragCoalescer 节流]',
    '  B --> C[CommandService 状态机]',
    '  C --> D[时间树算法重算]',
    '  D --> E[LOD 局部重绘视图]',
    '```',
  ].join('\n'),

  n_branch_layout: [
    '### **排布算法与拓扑核心**',
    '> [!IMPORTANT]',
    '> **纯函数设计**：所有排布与几何计算全部为 Pure Functions，零 DOM 依赖，可在 Web Worker 或 Node.js 离线测试环境中高频复用。',
  ].join('\n'),

  n_layout_timetree: [
    '### **时间树（Timeline Tree）双轴算法**',
    '- [x] **时间主轴**：依节点日期沿前进方向有序排布',
    '- [x] **7天弹性窗口**：允许同周节点在合理网格内弹性微调，避免卡片重叠',
    '- [x] **时间重心回溯**：无日期父节点根据后代节点的日期分布自动居中对齐',
    '- [~] 大跨度分支连线的智能障碍避让通道',
  ].join('\n'),

  n_layout_datefirst: [
    '**日期优先（Date First）视图**',
    '将全局所有分支节点严格按绝对时间切片分层。',
    '- [x] 纵向/横向严格时间切片投影',
    '- [x] 多分支并行推进时的横向间距自适应展开',
  ].join('\n'),

  n_geom_spines: [
    '### **多主干（Spines）路径导航**',
    '> [!TIP]',
    '> 主干是由连续有效层级边构成的核心路径。在顶部工具栏切换主干，可将无关分支柔和置灰，聚焦于单一战役。',
  ].join('\n'),

  n_branch_storage: [
    '### **本地优先（Local-First）数据架构**',
    '> [!NOTE]',
    '> 遵循 Local-First 原则：数据优先保存在本地浏览器 IndexedDB，离线可用、秒级加载、数据资产完全私有。',
  ].join('\n'),

  n_storage_hashes: [
    '### **三层哈希隔离（ADR-013）**',
    '- **Semantic Hash**：仅在节点拓扑、标题与正文任务变更时更新',
    '- **Presentation Hash**：仅在节点坐标拖动、缩放或折叠时更新',
    '- **File Hash**：保证全文件传输与导出的内容完整性',
  ].join('\n'),

  n_storage_assets: [
    '### **离线资产管线与 SHA-256 去重**',
    '- [x] 粘贴图片自动计算 SHA-256 内容哈希',
    '- [x] 重复图像零冗余秒级去重',
    '- [~] Web Worker 自动压缩超大图片（超过 1 MiB / 2048px 触发）',
    '- [ ] 支持相对宽度语法 `![插图{width=70%}](asset:...)`',
  ].join('\n'),

  n_eco_svg: [
    '### **SVG 矢量全图导出**',
    '- [x] 导出图元几何路径与画布渲染 100% 像素级一致',
    '- [x] 支持按边类型（层级/依赖/引用）选择性过滤导出',
    '- [x] 自动转义 XML 特殊字符，高亮主干描边增强',
  ].join('\n'),

  n_mile_alpha: [
    '### **v1.0 Alpha 原型验证**',
    '> [!NOTE]',
    '> **已交付达成**：完成全部 11 项契约 Schema 定义、基础 CommandService 事务引擎与 30+ 节点单根拓扑验证。',
  ].join('\n'),

  n_mile_beta: [
    '### **v2.0 Beta 交互公测**',
    '> [!IMPORTANT]',
    '> **当前推进版本**：聚焦时间树排布稳定性、CodeMirror 实时协作编辑器打磨与 300+ 节点极限性能优化。',
    '',
    '- [x] 双模布局（时间树/日期优先）与横纵向视向切换',
    '- [~] 复杂多分支跨项目合并与拆分',
    '- [ ] 移动端手势触控优化',
  ].join('\n'),

  n_mile_ga: [
    '### **v3.0 GA 商业正式版**',
    '- [ ] 多人实时 CRDT 协同通信通道',
    '- [ ] 自定义插件系统与主题市场',
    '- [ ] 跨平台客户端构建（Tauri / Electron）',
  ].join('\n'),
};

interface DemoNodeSeed {
  id: string;
  title: string;
  parentId: string | null;
  startAt: string | null;
  tags?: readonly string[];
  tasks?: readonly {
    title: string;
    done?: boolean;
    status?: TaskStatus;
    tags?: readonly string[];
  }[];
}

const DEMO_NODES: readonly DemoNodeSeed[] = [
  // ── 根节点 ──────────────────────────────────────────────────────────
  {
    id: 'n_root',
    title: 'WorkspaceTree 2.0 研发全景',
    parentId: null,
    startAt: '2026-10-01',
    tags: ['架构全景', 'P0', '核心项目'],
    tasks: [
      { title: '确立多分支时间树混合排布算法规范', done: true, tags: ['架构'] },
      { title: '工程化 2D/3D 双模空间画布与 CodeMirror 6 编辑器', done: false, status: 'pending' },
      { title: '交付全平台离线优先存储与开放生态体系', done: false },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // 分支柱 A：交互与渲染系统（UI / Canvas & Renderer）
  // ══════════════════════════════════════════════════════════════════════
  {
    id: 'n_branch_ui',
    title: '交互与渲染系统',
    parentId: 'n_root',
    startAt: '2026-10-08',
    tags: ['前端', '渲染引擎', '交互体验'],
    tasks: [
      { title: '完成 ReactFlow 视口无级缩放与拖拽吸附', done: true },
      { title: '打通 CodeMirror 6 与 Markdown Live Preview 联动', done: true },
      { title: '完善 Three.js 3D 空间拓扑与主干发光特效', done: false, status: 'pending' },
    ],
  },

  // ── A1: 画布交互内核 ──────────────────────────────────────────────────
  {
    id: 'n_canvas_core',
    title: '画布交互内核',
    parentId: 'n_branch_ui',
    startAt: '2026-10-15',
    tags: ['画布', '性能'],
    tasks: [
      { title: '视口无级缩放与焦点快速平移', done: true },
      { title: '节点框选与跨项目批量剪切/粘贴', done: true },
    ],
  },
  {
    id: 'n_canvas_2d',
    title: '2D 流程画布',
    parentId: 'n_canvas_core',
    startAt: '2026-10-18',
    tags: ['ReactFlow', '2D'],
    tasks: [
      { title: 'ReactFlow 卡片节点集成', done: true },
      { title: '节点多边缘连接点与动态吸附', done: true },
      { title: '自定义拖拽缩放手柄（uniform / box / branch）', done: true },
    ],
  },
  {
    id: 'n_canvas_3d',
    title: '3D 空间拓扑',
    parentId: 'n_canvas_core',
    startAt: '2026-10-25',
    tags: ['ThreeJS', '3D', 'WebGL'],
    tasks: [
      { title: 'Three.js 场景网格管线集成', done: true },
      { title: '主干链路流动光效着色器', done: false, status: 'pending' },
      { title: '2D/3D 相机平滑运镜补间过渡', done: false },
    ],
  },
  {
    id: 'n_canvas_lod',
    title: 'LOD 动态视觉分级',
    parentId: 'n_canvas_core',
    startAt: '2026-10-30',
    tags: ['性能优化', 'LOD'],
    tasks: [
      { title: '远景缩放时标题放大保持清晰可读', done: true },
      { title: '超微视图下卡片内容折叠为纯色几何胶囊', done: true },
      { title: '视口外非可见节点剔除（Frustum Culling）', done: true },
    ],
  },
  {
    id: 'n_canvas_perf',
    title: '离屏渲染与帧率监控',
    parentId: 'n_canvas_core',
    startAt: '2026-11-03',
    tags: ['监控', 'FPS'],
    tasks: [
      { title: '300+ 节点高频拖拽压测稳定 60 FPS', done: true },
      { title: '输入设备事件合并（Pointer Events）', done: true },
    ],
  },

  // ── A2: 富文本与编辑器引擎 ─────────────────────────────────────────────
  {
    id: 'n_editor_engine',
    title: '富文本与编辑器引擎',
    parentId: 'n_branch_ui',
    startAt: '2026-11-01',
    tags: ['CodeMirror', 'Markdown'],
    tasks: [
      { title: 'CodeMirror 6 核心状态与快捷键绑定', done: true },
      { title: '5 态任务体系解析与双向同步', done: true },
    ],
  },
  {
    id: 'n_editor_tasks',
    title: '5 态任务流转体系',
    parentId: 'n_editor_engine',
    startAt: '2026-11-04',
    tags: ['任务系统', 'GTD'],
    tasks: [
      { title: '解析 [ ] 待办与 [x] 已完成', done: true },
      { title: '实现 [~] 进行中高亮渲染', done: true },
      { title: '支持 [?] 待确认与 [-] 废弃状态', done: true },
      { title: '节点卡片标题栏任务进度环形指示器', done: true },
    ],
  },
  {
    id: 'n_editor_callouts',
    title: 'Callout 提示框组件',
    parentId: 'n_editor_engine',
    startAt: '2026-11-08',
    tags: ['排版', 'Callouts'],
    tasks: [
      { title: '支持 GitHub 规范 5 类 Alert 语法', done: true },
      { title: '彩色标签 {color:#hex} 扩展语法解析', done: true },
      { title: '双等号 ==重点文本高亮== 行内标记', done: true },
    ],
  },
  {
    id: 'n_editor_diagrams',
    title: 'Pele / Mermaid 图表引擎',
    parentId: 'n_editor_engine',
    startAt: '2026-11-12',
    tags: ['Mermaid', 'Pele', '可视化'],
    tasks: [
      { title: '集成 Pele 纯前端渲染管线', done: true },
      { title: 'Mermaid Flowchart / Sequence 语法高保真渲染', done: true },
      { title: '图表在暗色/亮色主题下自动适配', done: false, status: 'pending' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // 分支柱 B：排布算法与拓扑核心（Layout & Topology）
  // ══════════════════════════════════════════════════════════════════════
  {
    id: 'n_branch_layout',
    title: '排布算法与拓扑核心',
    parentId: 'n_root',
    startAt: '2026-10-10',
    tags: ['核心算法', '纯函数', 'P0'],
    tasks: [
      { title: '时间树（Timeline Tree）双轴算法设计', done: true },
      { title: '日期优先（Date First）严格时间切片排布', done: true },
      { title: '障碍避让与平滑贝塞尔连线优化', done: false, status: 'pending' },
    ],
  },

  // ── B1: 双模布局算法 ──────────────────────────────────────────────────
  {
    id: 'n_layout_algorithms',
    title: '双模布局算法',
    parentId: 'n_branch_layout',
    startAt: '2026-10-20',
    tags: ['算法引擎'],
    tasks: [
      { title: '确立纯函数布局契约（Pure Function）', done: true },
      { title: '保证 0 DOM 依赖且 Node/Browser 结果绝对一致', done: true },
    ],
  },
  {
    id: 'n_layout_timetree',
    title: '时间树双轴引擎',
    parentId: 'n_layout_algorithms',
    startAt: '2026-10-22',
    tags: ['时间树', '核心创新'],
    tasks: [
      { title: '树状分支层级与绝对日期坐标混合计算', done: true },
      { title: '7 天弹性窗口自适应对齐防重叠', done: true },
      { title: '无日期父节点按后代时间重心动态定位', done: true },
    ],
  },
  {
    id: 'n_layout_datefirst',
    title: '日期优先分层排布',
    parentId: 'n_layout_algorithms',
    startAt: '2026-10-28',
    tags: ['时间线', '分层布局'],
    tasks: [
      { title: '绝对日期横向分轨算法', done: true },
      { title: '跨分支时间交织通道空隙保留', done: true },
    ],
  },
  {
    id: 'n_layout_orientation',
    title: '横纵视向双向切换',
    parentId: 'n_layout_algorithms',
    startAt: '2026-11-02',
    tags: ['视向切换'],
    tasks: [
      { title: '水平（从左到右）与垂直（从上到下）极性翻转', done: true },
      { title: '视向切换时保持手动锁点（Locked Points）相对拓扑', done: true },
    ],
  },
  {
    id: 'n_layout_collision',
    title: '碰撞检测与避障平移',
    parentId: 'n_layout_algorithms',
    startAt: '2026-11-05',
    tags: ['防碰撞'],
    tasks: [
      { title: '子树整体平移包围盒（AABB）计算', done: true },
      { title: '动态调整同级子分支横向避让边距', done: true },
    ],
  },

  // ── B2: 连线几何与多主干 ───────────────────────────────────────────────
  {
    id: 'n_layout_geometry',
    title: '几何连线与主干高亮',
    parentId: 'n_branch_layout',
    startAt: '2026-11-06',
    tags: ['连线几何', '多主干'],
    tasks: [
      { title: '三次贝塞尔曲线端点与切线计算', done: true },
      { title: '多主干（Spines）拓扑定义与状态隔离', done: true },
    ],
  },
  {
    id: 'n_geom_bezier',
    title: '平滑三次贝塞尔连线',
    parentId: 'n_layout_geometry',
    startAt: '2026-11-08',
    tags: ['贝塞尔', 'SVG'],
    tasks: [
      { title: '卡片边缘动态出入手柄吸附', done: true },
      { title: '跨分支虚线连接与自定义连线注释文本', done: true },
    ],
  },
  {
    id: 'n_geom_spines',
    title: '多主干路径高亮体系',
    parentId: 'n_layout_geometry',
    startAt: '2026-11-11',
    tags: ['主干导航', '核心功能'],
    tasks: [
      { title: '支持多主干共享前缀路径并各自分色', done: true },
      { title: '高亮选中主干时非关键分支平滑淡出置灰', done: true },
      { title: '工具栏主干下拉选择器实时聚焦', done: true },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // 分支柱 C：本地优先与数据存储（Local-First Architecture）
  // ══════════════════════════════════════════════════════════════════════
  {
    id: 'n_branch_storage',
    title: '本地优先与数据架构',
    parentId: 'n_root',
    startAt: '2026-10-14',
    tags: ['LocalFirst', '存储架构', '离线优先'],
    tasks: [
      { title: '浏览器 IndexedDB 事务适配器', done: true },
      { title: '.branch.json 容器与纯净导入导出', done: true },
      { title: 'Web Worker 离线图像压缩与内容去重', done: false, status: 'pending' },
    ],
  },

  // ── C1: 事务存储与状态管理 ─────────────────────────────────────────────
  {
    id: 'n_storage_core',
    title: '事务存储与状态管理',
    parentId: 'n_branch_storage',
    startAt: '2026-10-24',
    tags: ['CommandService', '事务'],
    tasks: [
      { title: '基于 CommandService 的不可变操作命令流水线', done: true },
      { title: '支持无限层级 Undo/Redo 历史栈', done: true },
    ],
  },
  {
    id: 'n_storage_idb',
    title: 'IndexedDB 存储引擎',
    parentId: 'n_storage_core',
    startAt: '2026-10-26',
    tags: ['IndexedDB', '自动保存'],
    tasks: [
      { title: '失焦立即持久化与 5 秒定时自动保存', done: true },
      { title: '跨标签页多项目并发访问与状态恢复', done: true },
      { title: '会话损坏静默熔断与自动降级保护', done: true },
    ],
  },
  {
    id: 'n_storage_hashes',
    title: '三层版本与语义哈希',
    parentId: 'n_storage_core',
    startAt: '2026-11-02',
    tags: ['哈希校验', '版本契约'],
    tasks: [
      { title: '计算领域状态语义哈希（Semantic Hash）', done: true },
      { title: '计算视觉展现表现哈希（Presentation Hash）', done: true },
      { title: '计算整包完整性哈希（File Hash）', done: true },
    ],
  },
  {
    id: 'n_storage_undo',
    title: '拖拽节流与合批事务',
    parentId: 'n_storage_core',
    startAt: '2026-11-06',
    tags: ['历史栈', 'DragCoalescer'],
    tasks: [
      { title: 'DragCoalescer 拖拽帧率节流合批', done: true },
      { title: '单次拖拽过程仅生成单一历史回退节点', done: true },
    ],
  },

  // ── C2: 离线资产管线 ───────────────────────────────────────────────────
  {
    id: 'n_storage_assets',
    title: '离线资产管线',
    parentId: 'n_branch_storage',
    startAt: '2026-11-08',
    tags: ['资产管线', 'Worker', '去重'],
    tasks: [
      { title: '剪贴板/拖拽图像内容 SHA-256 去重', done: true },
      { title: 'Web Worker 自动重采样超大尺寸图像', done: true },
      { title: '图片资产自包含序列化进 .branch.json', done: true },
    ],
  },
  {
    id: 'n_asset_scaling',
    title: '图像相对宽度缩放',
    parentId: 'n_storage_assets',
    startAt: '2026-11-14',
    tags: ['图片手柄', '排版'],
    tasks: [
      { title: 'Markdown 语法扩展 {width=X%} 解析', done: true },
      { title: '卡片内图片悬浮交互拖拽拉伸边柄', done: true },
    ],
  },
  {
    id: 'n_asset_compression',
    title: 'WebP 优先图像压缩',
    parentId: 'n_storage_assets',
    startAt: '2026-11-18',
    tags: ['压缩算法', 'WebP'],
    tasks: [
      { title: '超过 1MB 自动无损转化为紧凑 WebP', done: true },
      { title: '提取低分辨率模糊占位图（BlurHash）', done: false, status: 'pending' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // 分支柱 D：生态集成与交付里程碑（Ecosystem & Milestones）
  // ══════════════════════════════════════════════════════════════════════
  {
    id: 'n_branch_ecosystem',
    title: '生态集成与交付里程碑',
    parentId: 'n_root',
    startAt: '2026-10-22',
    tags: ['生态', '交付', '里程碑'],
    tasks: [
      { title: 'SVG 矢量全图导出引擎', done: true },
      { title: '项目文件 .branch.json 导入导出与版本兼容', done: true },
      { title: '发布路线图各阶段质量门禁验收', done: false, status: 'pending' },
    ],
  },

  // ── D1: 输出与开放格式 ─────────────────────────────────────────────────
  {
    id: 'n_eco_export',
    title: '输出与开放格式',
    parentId: 'n_branch_ecosystem',
    startAt: '2026-11-01',
    tags: ['SVG导出', '数据开放'],
    tasks: [
      { title: '高保真 SVG 矢量排版导出', done: true },
      { title: '外部知识库桥接方案预研', done: true },
    ],
  },
  {
    id: 'n_eco_svg',
    title: 'SVG 矢量全图导出',
    parentId: 'n_eco_export',
    startAt: '2026-11-03',
    tags: ['矢量导出', '打印交付'],
    tasks: [
      { title: '卡片文字与贝塞尔连线零偏差对齐', done: true },
      { title: '支持显式选择边类型（Hierarchy/Dependency/Custom）', done: true },
      { title: '折叠分支在 SVG 导出中渲染折叠卡片与统计标签', done: true },
    ],
  },
  {
    id: 'n_eco_bridge',
    title: 'Obsidian 双向桥接适配',
    parentId: 'n_eco_export',
    startAt: '2026-11-15',
    tags: ['Obsidian', '双链笔记'],
    tasks: [
      { title: '解析 [[Wikilinks]] 双向链接网络', done: true },
      { title: '将知识库 Markdown 文件夹一键投影为时间树项目', done: false, status: 'pending' },
    ],
  },

  // ── D2: 交付里程碑 ─────────────────────────────────────────────────────
  {
    id: 'n_eco_milestones',
    title: '交付里程碑路线图',
    parentId: 'n_branch_ecosystem',
    startAt: '2026-11-10',
    tags: ['里程碑', 'ReleaseTrack'],
    tasks: [
      { title: 'v1.0 Alpha 原型验证顺利结项', done: true },
      { title: 'v2.0 Beta 公测版功能完整交付', done: true },
      { title: 'v3.0 GA 生产商业版筹备', done: false, status: 'pending' },
    ],
  },
  {
    id: 'n_mile_alpha',
    title: 'v1.0 Alpha 原型验证',
    parentId: 'n_eco_milestones',
    startAt: '2026-11-12',
    tags: ['已完成', 'Alpha'],
    tasks: [
      { title: '30+ 节点树形拓扑结构验证通过', done: true },
      { title: '纯函数布局与几何算法测试套件通过', done: true },
      { title: '无 React 环境 Node 侧独立运行测试验证', done: true },
    ],
  },
  {
    id: 'n_mile_beta',
    title: 'v2.0 Beta 交互公测',
    parentId: 'n_eco_milestones',
    startAt: '2026-11-25',
    tags: ['进行中', 'Beta', '当前焦点'],
    tasks: [
      { title: '时间树与日期优先双模布局稳定集成', done: true },
      { title: '跨分支依赖边交互与注释直观呈现', done: true },
      { title: '300+ 节点大型项目流畅交互压测达成', done: true },
      { title: '移动端多点触控与手势缩放支持', done: false, status: 'pending' },
    ],
  },
  {
    id: 'n_mile_ga',
    title: 'v3.0 GA 商业正式版',
    parentId: 'n_eco_milestones',
    startAt: '2026-12-20',
    tags: ['规划中', 'GA'],
    tasks: [
      { title: '轻量级 WebRTC 点对点协作画布', done: false },
      { title: '开放插件市场与第三方自定义节点卡片', done: false },
      { title: '全平台桌面客户端（macOS / Windows / Linux）封装', done: false },
    ],
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
      tags: seed.tags ? [...seed.tags] : undefined,
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
        status: task.status,
        tags: task.tags ? [...task.tags] : undefined,
      });
    });
  }

  // 跨分支关联边：对应架构图中的跨分支依赖、引用与业务标记
  const crossEdges: readonly {
    from: string;
    to: string;
    type: Edge['type'];
    note: string;
  }[] = [
    {
      from: 'n_layout_timetree',
      to: 'n_canvas_2d',
      type: 'dependency',
      note: '时间树算法为 2D 画布提供绝对坐标投影',
    },
    {
      from: 'n_storage_assets',
      to: 'n_editor_callouts',
      type: 'dependency',
      note: '为富文本注入离线图片资产协议与压缩流',
    },
    {
      from: 'n_editor_diagrams',
      to: 'n_eco_svg',
      type: 'reference',
      note: '共享统一 Pele 矢量图元生成器',
    },
    {
      from: 'n_canvas_perf',
      to: 'n_mile_beta',
      type: 'custom',
      note: '60 FPS 压测达标作为 Beta 公测核心验收条件',
    },
    {
      from: 'n_storage_hashes',
      to: 'n_mile_ga',
      type: 'dependency',
      note: '三层哈希自洽性作为 GA 稳定版发布硬门禁',
    },
  ];

  crossEdges.forEach((item, index) => {
    edges.push({
      id: `e_x_${index + 1}`,
      type: item.type,
      fromNodeId: item.from,
      toNodeId: item.to,
      note: item.note,
    });
  });

  const spines = [
    {
      id: 'spn_canvas_ux',
      title: '主干 1 · 极致交互与渲染体验（UX & Canvas）',
      nodeIds: ['n_root', 'n_branch_ui', 'n_canvas_core', 'n_canvas_2d'],
    },
    {
      id: 'spn_layout_core',
      title: '主干 2 · 核心调度与时间树算法（Core Layout）',
      nodeIds: ['n_root', 'n_branch_layout', 'n_layout_algorithms', 'n_layout_timetree'],
    },
    {
      id: 'spn_local_first',
      title: '主干 3 · 本地优先数据与资产架构（Local-First Data）',
      nodeIds: ['n_root', 'n_branch_storage', 'n_storage_core', 'n_storage_idb'],
    },
    {
      id: 'spn_release',
      title: '主干 4 · 关键交付与上线里程碑（Release Track）',
      nodeIds: ['n_root', 'n_branch_ecosystem', 'n_eco_milestones', 'n_mile_beta'],
    },
  ];

  return {
    project: {
      id: DEMO_PROJECT_ID,
      title: 'WorkspaceTree · 技术全景与架构演进',
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
      verticalNodePositions: {},
      branchScales: {
        n_storage_assets: 0.85,
        n_eco_export: 0.9,
      },
      // 默认折叠离线资产管线分支，展示折叠卡片与子树统计汇总徽章
      collapsedByDefault: ['n_storage_assets'],
      savedSpineDisplay: 'spn_canvas_ux',
      layoutDirection: 'vertical',
      nodeSizes: {
        n_root: { width: 300, height: 180 },
        n_branch_ui: { width: 260, height: 160 },
        n_branch_layout: { width: 260, height: 160 },
        n_branch_storage: { width: 260, height: 160 },
        n_branch_ecosystem: { width: 260, height: 160 },
        n_editor_diagrams: { width: 310, height: 230 },
        n_editor_tasks: { width: 280, height: 180 },
        n_layout_timetree: { width: 290, height: 180 },
        n_mile_beta: { width: 280, height: 175 },
      },
      nodeScales: {
        n_root: 1.15,
        n_branch_ui: 1.05,
        n_branch_layout: 1.05,
        n_branch_storage: 1.05,
        n_branch_ecosystem: 1.05,
        n_mile_beta: 1.1,
        n_canvas_perf: 0.85,
        n_layout_collision: 0.85,
        n_storage_undo: 0.85,
        n_eco_bridge: 0.85,
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
