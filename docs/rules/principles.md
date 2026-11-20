# 核心开发规范与硬约束原则 (Principles)

本文档定义 WorkspaceTree 前端交互、画布渲染与测试治理中的长期不变硬规则。

---

## 1. 测试选择器契约原则（DOM Invariance Contract）

- **禁止擅自修改或剥离核心交互节点的 DOM 宿主结构**：
  - 画布节点容器 `.react-flow__node` 必须直接包含卡片容器 `.wst-card`。
  - 编辑状态激活时，必须在卡片根节点附带 `.is-editing` class（即 `.wst-card.is-editing`），内部必须直接暴露标题输入控件 `.wst-card-edit-title` 与正文 Markdown 编辑器容器 `.cm-content`。
- **重构前置校验**：
  - 任何改动卡片 DOM 层级或提取浮层的重构，必须首先检索 `apps/web/scripts/smoke-web.mjs` 及 `tests/` 中的选择器契约；
  - CI / E2E 依赖的选择器契约属于公开 API 级别约束，不得隐式破坏。

---

## 2. 变换解耦与局部去形变原则（Local De-transform Pattern）

- **屏幕 1:1 编辑不应通过 Portal 脱离上下文实现**：
  - 当节点处于双层缩放的几何缩放（Visual Scale，`effVisual !== 1`）状态时，编辑体验若需保持 1:1（避免文字变形、字体模糊与 IME 光标位移），应采用**局部停用变换（Local De-transform）**：
    ```tsx
    if (data.layoutSize && effVisual !== 1 && !data.isEditing) {
      transform = `scale(${effVisual})`;
    }
    ```
  - 编辑期间提升卡片 `z-index: 1000`，失焦/保存后自动恢复几何形变。
  - 严禁通过 `React.createPortal` 将卡片内部的内容脱壳挂载到全局 Body/Overlay 上，避免破坏 DOM 树一致性、事件穿透与多实例生命周期管理复杂度。

---

## 3. 双层缩放与渲染独立性原则

- **排版缩放（Layout Scale）与几何缩放（Visual Scale）分工**：
  - Layout Scale：决定排版字号、行距、内边距与换行宽度（内容重新流动，自适应折行）；
  - Visual Scale：对渲染后的节点包围盒进行等比 2D 仿射变换（内部布局比例严格锁死）。
- **编辑态保持交互原生性**：
  - CodeMirror、IME 输入法、选区高亮均运行于无 CSS Transform 形变的坐标空间，确保高保真打字体验。
