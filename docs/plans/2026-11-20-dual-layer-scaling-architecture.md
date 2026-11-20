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

### Phase 0: 现有代码探针与旧数据基线 (1 天)
- [ ] 深入审查 `packages/layout/src/visual.ts` 中的 `resolveBranchScale` 与 `branchScaleCompensation` 真实执行流；
- [ ] 导出 2 份具有典型分支缩放的存量工程测试用例，记录基准节点坐标与渲染截图。

### Phase 1: 契约模型与向下兼容 (`packages/schema` & `packages/core`) (1-2 天)
- [ ] 在 `packages/schema/src/state.ts` 中定义 `NodeScaleSchema` 与 `BranchScaleSchema`；
- [ ] 在 `packages/schema/src/common.ts` 与 `packages/schema/src/version.ts` 中将 `SCHEMA_VERSION` 升级为 `4`，登记 `3 -> 4` 迁移函数；
- [ ] 在 `packages/core/src/migration.ts` 中实现 `migrateScaleModel()`，并在测试集中覆盖单节点、分支、补偿项的迁移转换；
- [ ] 实现统一的 `createChildScale(parent, settings)` 纯函数。

### Phase 2: 几何引擎重构与双边界计算 (`packages/layout`) (2 天)
- [ ] 扩展 `packages/layout/src/types.ts` 中的 `VisualNode`，提供 `effectiveLayoutScale` 与 `effectiveVisualScale`；
- [ ] 在 `packages/layout/src/geometry.ts` 中引入轻量 2D 矩阵计算（支持 Translation, Scaling 与 Anchor 变换）；
- [ ] 改造 `packages/layout/src/visual.ts`：
  - 排版阶段：根据 `effectiveLayoutScale` 测定基准宽高与自动换行；
  - 几何阶段：应用 `effectiveVisualScale` 输出实际物理 AABB 包围盒；
  - 布局阶段：以新包围盒进行树节点间隙与碰撞分配。

### Phase 3: DOM BranchGroup 与混合渲染管线 (`apps/web`) (2-3 天)
- [ ] 重构 `CanvasNode.tsx`：
  - 排版层：字号仅与 `effectiveLayoutScale` 绑定；
  - 几何层：外层容器挂载 `transform: scale(visualScale)` 与自适应 `transformOrigin`；
- [ ] 实现 `BranchGroup` 组件容器：
  - 识别连续逻辑子树并包裹 DOM 节点；
  - 将分支内部连线归入 `BranchGroup` 的 SVG 容器内；
  - 父级连线保持在根级 SVG 层，连接点吸附至挂载锚点 $a$。

### Phase 4: 独立交互层、手柄与工具栏设置 (`apps/web`) (2 天)
- [ ] 独立 Canvas Overlay 交互层：渲染固定视觉大小的手柄（四角等比缩放手柄）；
- [ ] 改造缩放属性面板：
  - 范围选择：`[当前节点] | [整个分支]`；
  - 方式选择：`[排版缩放 (文字折行)] | [等比缩放 (保持排版)]`；
  - 数值滑块与精确百分比输入，双击重置为 100%；
- [ ] 在系统设置中加入 `ScaleSettings` 面板（默认子节点继承模式、步长、缩放上下限）。

### Phase 5: 历史事务、跨分支移动与端到端回归 (2 天)
- [ ] 交互事务合并：拖拽缩放手柄期间不提交 Reducer，`pointerUp` 提交单个原子 Undo 记录；
- [ ] 跨分支移动（Reparent）策略：当节点拖入新分支时，提供“保持视觉大小（重新折算本地倍率）”机制；
- [ ] 运行 Phase 0 的基准测试用例，对比截图确保历史工程零漂移；
- [ ] 执行全量单测与构建验证 (`pnpm test`, `pnpm build`)。

---

## 5. 风险与应急回滚策略

1. **DOM 分组可能破坏原有 CSS 层叠顺序 (z-index)**：
   * *防范措施*：为 `BranchGroup` 设定规范的 CSS 隔离与层叠规则，选中状态提升整个 Group 的 `z-index`。
2. **深层树分支几何变换后的事件穿透与坐标偏移**：
   * *防范措施*：所有 Pointer 事件必须经由几何引擎的逆矩阵计算出逻辑坐标，绝不直接使用原生 `event.clientX/Y`。
3. **数据兼容风险**：
   * *回滚机制*：`migrateScaleModel` 保留旧字段原始副本，在保存前校验数据有效性；一旦版本校验失败，优雅降级为只读并提示备份。
