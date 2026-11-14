# Changelog

## 2026-11-14

- **Markdown 实时编辑与预览**：基于 CodeMirror 6 实现类似 Obsidian 的光标处源码编辑与未聚焦区域实时渲染，支持标题、列表、Checkbox、Callout、粗体斜体、行内代码与快捷键。
- **5 态任务体系与自动迁移**：升级 schema 版本至 v2，统一为 `[ ]` 未完成、`[x]` 完成、`[-]` 废弃、`[~]` 停用、`[?]` 待定，自动从旧版 `[*]` / `[x]` 进行幂等迁移，结构化任务增加 `paused` 状态。
- **项目自包含图片资产与 Worker 压缩**：本地图片通过剪贴板、拖拽或文件选择统一嵌入项目资产表（`domain.assets`），按 SHA-256 去重并自包含导出；Web Worker 自动执行长边 2048 px / 1 MiB 阈值压缩。
- **URL 智能识别与 CORS 保护**：粘贴图片链接自动识别为 Markdown 图片，遭遇跨域限制时保留外部链接渲染并给出明确操作提示。
- **图片相对尺寸调整与多视图联动**：新增 `{width=X%}` 相对宽度扩展语法与 10%–100% 拖拽调节柄，锁定宽高比跟随节点缩放；SVG 导出与 3D 画布均支持内嵌资源与相对尺寸渲染。

## 2026-11-13

- Added time tree and date-priority layouts, a date directory and live node scaling.
- Added cross-tab branch copy, cut and paste with undo and redo.
- Added Ctrl+S export, bilingual README files and GitHub Pages deployment.
- Added file drag-and-drop, edge editing and project TODO views.
