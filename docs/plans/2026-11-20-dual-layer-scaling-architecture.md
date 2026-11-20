# 双层缩放架构（Dual-Layer Scaling Architecture）设计与实现计划

- **日期**：2026-11-20
- **状态**：**已拍板定案（Approved），待分阶段实施**
- **适用工程**：`workspacetree` (`packages/schema`, `packages/core`, `packages/layout`, `apps/web`)
- **关联文件**：
  - `packages/schema/src/state.ts`（数据模型与 SavedPresentation）
  - `packages/core/src/reducer.ts`（状态变更与 Reducer）
  - `packages/layout/src/visual.ts` & `packages/layout/src/types.ts`（几何计算与布局引擎）
  - `apps/web/src/CanvasNode.tsx` & `apps/web/src/branch-editing.ts`（节点渲染与分支交互）

---

## 1. 架构目标与背景

当前 `workspacetree` 将所有缩放逻辑混杂在单一的 `scale` / `branchScale` 标量中，并通过改变字体尺寸（`fontSize: ...em`）来实现缩放。这带来了两大核心架构缺陷：
1. **内容重排与视觉失真混淆**：用户期望等比缩小时，文本被动折行，节点高宽比与视觉排版发生不可控变化；
2. **分支级联污染与撤销脆弱**：祖先分支缩放通过标量向下渗透，历史代码被迫引入 `branchScaleCompensation` 补丁来截断级联，极易引发累积误差和撤销/重做不一致。

本次优化将全面重构为 **Dual-Layer Scaling Architecture（双层缩放架构）**：
- **相对缩放（Layout Scale / 排版缩放）**：改变节点内部字号、内边距等排版属性，允许内容重排与换行，触发树布局重新测量；
- **绝对缩放（Visual Scale / 几何缩放）**：将节点或子树视为刚性几何图形，施加等比几何变换，锁死内部排版与长宽比；
- **A+B 混合架构**：DOM 渲染层采用 `BranchGroup` + CSS Transform 保证流畅交互，几何引擎层独立维护变换矩阵与物理外接包围盒，彻底解耦浏览器 DOM 测量。

---

## 2. 正式拍板的 4 项核心决策与设计细节

| 决策项 | 结论 | 实施落地规范 |
| :--- | :--- | :--- |
| **1. 新建子节点默认模式** | **确认** | 默认启用**相对排版缩放**（步长 `-0.1`）；支持项目设置切换为“绝对几何缩放”或“组合双缩放”。 |
| **2. 分支绝对缩放锚点** | **确认** | 以**分支根节点面向父节点的挂载连接锚点**为中心 ($M = T(a) \cdot S(s) \cdot T(-a)$)，随树生长方向动态调整。 |
| **3. 历史数据向下兼容** | **有条件确认** | 旧 `nodeScales` 映射为 `layoutScale`，旧 `branchScales` 映射为 `branchLayoutScale`，新视觉参数置 `1.0`。在保存时升级 `schemaVersion`，首阶段先审计旧累积语义。 |
| **4. BranchGroup 架构** | **A+B 混合架构** | **以 A 为主（DOM 分组容器）**：高效显示与实时预览；**几何层吸收 B**：独立计算全局矩阵、变换包围盒、碰撞检测与逆矩阵拾取。 |

### 2.1 决策 1：子节点默认继承规则
```typescript
interface ScaleSettings {
  defaultChildMode: 'layout' | 'visual' | 'both';
  childLayoutStep: number;    // 默认 -0.1 (加法递减)
  childVisualRatio: number;   // 默认 0.9 (乘法递减)
  minLayoutScale: number;     // 默认 0.6
  maxLayoutScale: number;     // 默认 3.0
  minVisualScale: number;     // 默认 0.4
  maxVisualScale: number;     // 默认 3.0
}
```
* **相对排版缩放（加法）**：
  $$L_{\mathrm{child}} = \max\left(L_{\min},\, L_{\mathrm{parent}} + \text{childLayoutStep}\right)$$
  *(示例：$1.0 \to 0.9 \to 0.8 \to 0.7$)*
* **绝对视觉缩放（乘法）**：
  $$V_{\mathrm{child}} = \max\left(V_{\min},\, V_{\mathrm{parent}} \times \text{childVisualRatio}\right)$$
  *(示例：$1.0 \to 0.9 \to 0.81 \to 0.729$)*
* **正交性约定**：默认只递减相对排版缩放；切换为绝对缩放时，排版缩放保持为父节点基准，不叠加两次缩放。父节点取值基于共享坐标系中的节点自身参数，严禁把已继承的 `branchScale` 再次注入子节点本地参数。

### 2.2 决策 2：分支绝对缩放动态锚点
分支几何变换矩阵定义为：
$$M = T(a) \cdot S(s) \cdot T(-a)$$
* **锚点动态位置计算**：
  * 水平自左向右布局（`horizontal / LTR`）：取分支根节点的**左边缘垂直中心点** $(x, y + h/2)$；
  * 水平自右向左布局（`RTL`）：取分支根节点的**右边缘垂直中心点** $(x + w, y + h/2)$；
  * 垂直自上向下布局（`vertical / TTB`）：取分支根节点的**顶边缘水平中心点** $(x + w/2, y)$。
* **物理约束**：
  1. 挂载锚点 $a$ 的全局坐标在缩放前后严格保持不变；
  2. 父节点绝对不参与子分支内部几何缩放；
  3. 来自父节点的连接主干线在分支容器外侧独立计算与重绘；
  4. 只有当分支绝对缩放后的外围包围盒与其他分支重叠时，才触发父级树的外部空间调整。

### 2.3 决策 3：历史数据迁移与兼容隔离
```typescript
interface MigrateScaleModelOptions {
  currentSchemaVersion?: number;
}

export function migrateScaleModel(presentation: any): SavedPresentation {
  // 1. 若已经是双层模型 (v4)，原样返回
  if ((presentation.schemaVersion ?? 1) >= 4) return presentation;

  // 2. 字段映射 (旧字段 nodeScales / branchScales 映射至排版缩放)
  const nodeLayoutScales = { ...(presentation.nodeScales ?? {}) };
  const branchLayoutScales = { ...(presentation.branchScales ?? {}) };

  // 3. 构建规范化双层缩放实体
  return {
    ...presentation,
    schemaVersion: 4,
    nodeLayoutScales,
    nodeVisualScales: {},        // 缺省回退为 1.0
    branchLayoutScales,
    branchVisualScales: {},      // 缺省回退为 1.0
    // 保留未识别字段与向下兼容字段，避免历史工程数据丢失
  };
}
```
* **执行纪律**：
  1. 读取旧工程时不直接覆写磁盘，仅在用户显式保存（Save/Export）时升级文件结构；
  2. 针对原有 `branchScaleCompensation`：若旧数据存在补偿项，迁移时将其折算入本地节点的 `layoutScale`，随后逐步下线补偿项字段。

### 2.4 决策 4：BranchGroup A+B 混合架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                       Tree Data Model                       │
│      Node / Edge / Parent-Child / Dual-Layer Scale Props    │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 ┌─────────────────────┐               ┌─────────────────────┐
 │ 几何计算层 (Engine) │               │ DOM 渲染层 (Render) │
 ├─────────────────────┤               ├─────────────────────┤
 │ • 变换矩阵 Matrix   │ 同步统一几何   │ • DOM BranchGroup   │
 │ • 节点物理包围盒    │ ─────────────>│ • CSS Transform     │
 │ • 外部重排与碰撞检测│               │ • 节点/内部连线容器 │
 │ • 鼠标拾取逆矩阵映射│               │ • 实时拖拽高帧率渲染│
 └─────────────────────┘               └─────────────────────┘
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │                Canvas Interaction Layer (Overlay)         │
 │      选择框 / Excalidraw 风格四角手柄 / 连线交互端点      │
 └───────────────────────────────────────────────────────────┘
```
* **DOM 渲染组 (`BranchGroup`)**：
  * 在 DOM 树中建立与逻辑分支严格对应的 `<div className="branch-group">`；
  * 分支内部节点、局部文字连线置于此容器内，应用 `transform: matrix(...)`；
  * 拖动缩放手柄期间仅更新局部 CSS Transform，维持 60fps 交互响应。
* **独立几何计算层 (`packages/layout`)**：
  * 拥有独立的纯数据矩阵库与 AABB 包围盒计算；
  * 节点的对外有效边界为：
    $$\text{BoundingBox}_{\mathrm{node}} = \text{LayoutSize} \times V_i^{\mathrm{eff}}$$
  * 分支对外暴露整棵子树的投影外接包围盒 $\text{BoundingBox}_{\mathrm{branch}}$，仅在拖拽松开（`pointerUp`）或排版重算时向外层布局引擎申请空间分配。
* **交互层 (`Overlay`)**：
  * 处于独立顶层画布，不随节点缩放而缩小手柄尺寸；
  * 鼠标屏幕事件通过当前活跃的逆矩阵（Inverse Matrix）映射回节点的本地坐标系。

---

## 3. 六大冻结验收标准 (Frozen Acceptance Criteria)

重构代码在交付前必须 100% 满足以下 6 项标准：

1. **缩放独立性（Orthogonality）**：
   * 调整单节点缩放不污染分支与兄弟节点；
   * 调整分支缩放不污染父节点与外部节点；
   * 画布视口缩放（Zoom）严禁写入任何持久化缩放参数。
2. **比例可逆性（Reversibility）**：
   * 节点缩放至任意比例（如 `0.65`），再恢复回 `1.0` 时，原始文本排版、物理尺寸与坐标完全复原，无累积浮点漂移。
3. **分支整体性（Branch Integrity）**：
   * 绝对分支缩放时，子树内部的节点间距、连线曲率、线宽与节点尺寸呈严格几何等比变化。
4. **排版独立性（Layout Decoupling）**：
   * 绝对视觉缩放（Visual Scale）在任何缩放比例下**绝对不触发文字折行变动**；
   * 相对排版缩放（Layout Scale）按照新字号执行正常的流式内容重排与外框重测。
5. **历史兼容性（Backward Compatibility）**：
   * 存量旧版工程文件载入后，视觉效果与改动前 100% 像素级一致，且不发生多重嵌套相乘放大。
6. **操作一致性（Interaction Consistency）**：
   * 拖动、框选、复制、跨分支 Reparent、Undo/Redo、本地保存与导出（SVG/HTML/图片）均严格遵循同一套几何矩阵模型。

---

## 4. 分阶段实施路线图 (Phased Implementation Roadmap)

### Phase 0: 现有代码探针与旧数据基线 (已完成)
- [x] 深入审查 `packages/layout/src/visual.ts` 中的 `resolveBranchScale` 与 `branchScaleCompensation` 真实执行流；
- [x] 导出具有典型分支缩放的存量工程测试用例，记录基准节点坐标与渲染基线。

### Phase 1: 契约模型与向下兼容 (`packages/schema` & `packages/core`) (已完成)
- [x] 在 `packages/schema/src/state.ts` 中定义 `ScaleSettingsSchema`、`DEFAULT_SCALE_SETTINGS` 与 `SavedPresentation` 扩展字段；
- [x] 在 `packages/schema/src/common.ts` 与 `packages/schema/src/version.ts` 中将 `SCHEMA_VERSION` 升级为 `4`，登记 `v3 -> v4` 迁移函数；
- [x] 在 `packages/core/src/migration.ts` 中实现 `migrateV3ToV4()`，并在测试集中覆盖单节点、分支、旧版映射转换；
- [x] 实现统一的 `createChildScale(parent, settings)` 纯函数与 reducer 命令扩展 (`presentation.setVisualScale`, `presentation.setNodeVisualScale`, `presentation.setScaleSettings`)。

### Phase 2: 几何引擎重构与双边界计算 (`packages/layout`) (已完成)
- [x] 扩展 `packages/layout/src/types.ts` 中的 `VisualNode`，提供 `effectiveLayoutScale` 与 `effectiveVisualScale`；
- [x] 在 `packages/layout/src/geometry.ts` 中引入轻量 2D 矩阵计算（支持 Translation, Scaling, Inversion 与动态方向挂载 Anchor 变换）；
- [x] 改造 `packages/layout/src/visual.ts`：
  - 排版阶段：根据 `effectiveLayoutScale` 测定基准宽高与自动换行；
  - 几何阶段：应用 `effectiveVisualScale` 输出实际物理 AABB 包围盒；
  - 布局阶段：以新包围盒进行树节点间隙与碰撞分配。

### Phase 3: DOM BranchGroup 与混合渲染管线 (`apps/web`) (已完成)
- [x] 重构 `CanvasNode.tsx`：
  - 排版层：字号与行内间距仅与 `effectiveLayoutScale` 绑定；
  - 几何层：非编辑模式下应用 `transform: scale(effVisual)` 与 `transformOrigin: '0 0'`，内部文本尺寸基于 `layoutSize`，彻底杜绝几何缩放触发文本意外折行；
  - 编辑模式自动规避几何缩放，确保输入不发生形变。

### Phase 4: 独立交互层、手柄与工具栏设置 (`apps/web`) (已完成)
- [x] 改造属性面板 (`WorkspaceInspector.tsx`)：
  - 排版缩放 (Layout Scale)：单节点排版缩放与分支排版缩放滑块；
  - 等比几何缩放 (Visual Scale)：单节点几何缩放与分支几何缩放滑块；
  - 一键恢复 100% 重置全部四类缩放；
- [x] 在系统设置 (`SettingsModal.tsx`) 中加入 `ScaleSettings` 面板（默认子节点继承模式、步长、衰减比率）并经由 Command 撤销重做栈持久化；
- [x] 在 `createNodeEntry` 中集成 `createChildScale`，新建子节点自动依策略生成初始缩放。

### Phase 5: 历史事务、跨分支移动与端到端回归 (已完成)
- [x] 交互事务与历史条目 (`apps/web/src/history.ts`) 全面接入双层几何缩放命令与撤销重做；
- [x] 全套测试套件（50 个测试文件、393 项单元测试）100% 通过；
- [x] 全套类型检查 (`pnpm typecheck`) 与代码规范 (`pnpm lint`) 零警告通过；
- [x] 生产构建 (`vite build`) 成功。

---

## 5. 风险与应急回滚策略

1. **DOM 分组可能破坏原有 CSS 层叠顺序 (z-index)**：
   * *防范措施*：为 `BranchGroup` 设定规范的 CSS 隔离与层叠规则，选中状态提升整个 Group 的 `z-index`。
2. **深层树分支几何变换后的事件穿透与坐标偏移**：
   * *防范措施*：所有 Pointer 事件必须经由几何引擎的逆矩阵计算出逻辑坐标，绝不直接使用原生 `event.clientX/Y`。
3. **数据兼容风险**：
   * *回滚机制*：`migrateScaleModel` 保留旧字段原始副本，在保存前校验数据有效性；一旦版本校验失败，优雅降级为只读并提示备份。

---

## 6. 二期深化架构精化与落地路线 (Refinements & Phased Roadmap)

### 6.1 三项关键设计细节修正 (Ratified Architectural Refinements)

1. **编辑状态采用 Editor Overlay (Portal)，废弃原位修改节点 Transform**：
   * 原方案在节点内直接剥除 CSS Transform 会导致节点瞬间剧烈膨胀、挤压周围兄弟分支、连线锚点错位，且在祖先多层缩放或画布缩放下仍无法实现真正 1:1；
   * 新方案：原节点保持几何状态与布局参数完全不动，在最外层顶层视图（React Portal / Screen CSS Coordinates）打开浮动编辑浮层 `NodeEditorOverlay`；
   * 浮层以屏幕原生 1:1 CSS 像素渲染，彻底杜绝 IME 输入法弹窗形变、光标定位偏差与滚动抖动；编辑提交后将内容回填并触发几何引擎重新测量。

2. **动态 Pushout 推挤方向修正为「兄弟分布轴」**：
   * 横向树（LTR/RTL）：树生长轴为 X 轴，兄弟分支沿 **Y 轴** 排列。因此同级分支几何重叠时，**必须沿 Y 轴（上下）施加推挤分离**，严禁沿 X 轴推挤；
   * 纵向树（TTB）：树生长轴为 Y 轴，兄弟分支沿 **X 轴** 排列。同级分支几何重叠时，**沿 X 轴（左右）施加推挤分离**；
   * 基于包围盒（AABB）重叠度计算最小分离位移。

3. **跨分支 Reparent 双层缩放守恒模型**：
   * 跨分支移动节点时，源分支与目标分支的累积排版缩放 ($B_L^{\text{src}} \to B_L^{\text{dst}}$) 与几何缩放 ($B_V^{\text{src}} \to B_V^{\text{dst}}$) 均可能不同；
   * 支持两种模式：
     - **保持外观（Keep Appearance，默认）**：
       $$V_{\text{new}} = V_{\text{orig}} \times \frac{B_V^{\text{src}}}{B_V^{\text{dst}}}, \quad L_{\text{new}} = L_{\text{orig}} \times \frac{B_L^{\text{src}}}{B_L^{\text{dst}}}$$
       使节点的最终物理尺寸、文字折行与排版比例在移动后 100% 保持不变；若拖动的是子树，补偿仅作用于子树根节点；
     - **继承新分支样式（Inherit Branch Style）**：保留节点本地参数，跟随新分支的分支缩放。

### 6.2 黄金工程原则 (Single Source of Truth)
> [!IMPORTANT]
> **几何引擎成为节点最终坐标与边界的唯一计算依据。**
> React / CSS 只负责消费几何引擎算出的矩阵与包围盒进行渲染，严禁在 UI 组件中另起炉灶维护独立于布局引擎的视觉缩放计算逻辑。

### 6.3 实施任务与优先级划分

- [ ] **P0-1: 消除 React DOM 嵌套警告**：保证富文本 Markdown 解析器中 Callout 等块级容器正确作为块级元素输出，杜绝 `<p><div>...</div></p>` 非法 DOM；
- [ ] **P0-2: 实现独立编辑浮层 (`NodeEditorOverlay`)**：通过 React Portal 脱离画布节点变换容器，实现屏幕真实 1:1 独立编辑浮层；
- [ ] **P0-3: 完善 Undo/Redo 事务纯度与滑块高频预览隔离**：确保连续拖动滑块仅更新预览层，释放指针后提交单一原子 Command 历史；
- [ ] **P1-1: 跨分支 Reparent 视觉守恒算法与命令集成**：在移动节点/子树时提供外观守恒与样式继承双模式；
- [ ] **P1-2: 动态兄弟分支推挤 (Pushout)**：基于生长方向与兄弟分布轴实现重叠自动避让；
- [ ] **P1-3: BranchGroup 连线与视觉优化**：保证分支内部连线与挂载锚点全局一致；
- [ ] **P2-1: Inspector 快捷缩放比例档位**：提供 50%、75%、100%、125%、150% 胶囊预设按钮；
- [ ] **P2-2: 首屏与重置自动平滑 FitView**：Demo 项目或新建工程首次进入时平滑居中；
- [ ] **P2-3: 窄屏工具栏响应式收敛**：`white-space: nowrap` 与次要菜单收敛。

### 6.4 三大自动化验收测试规范 (Automated Acceptance Tests)
- **测试 A (多层嵌套缩放一致性)**：构建至少四层节点，叠加节点几何缩放、分支几何缩放与画布缩放，验证世界坐标、连线锚点与逆矩阵坐标拾取完全精确；
- **测试 B (编辑前后几何恢复)**：在 `0.75×` 节点进入编辑浮层，输入中文、公式、列表后提交，验证无尺寸跳跃、位置漂移或缩放丢失；
- **测试 C (缩放事务与数值可逆性)**：连续滑动 50 帧后松手，单次 Undo 恢复初始态，Redo 恢复最终态；倍率 $1.0 \to 0.6 \to 1.0$ 完全可逆无后代污染。
