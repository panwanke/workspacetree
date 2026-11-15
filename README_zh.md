<p align="center">
  <img src="apps/web/public/icon-192.png" width="100" height="100" alt="WorkspaceTree Logo" />
</p>

# WorkspaceTree

> [English](README.md) | [在线演示](https://panwanke.github.io/workspacetree/)

WorkspaceTree 是一个浏览器项目画布，用树状节点组织工作，结合日期查看分支、编辑任务和梳理项目进展。

**开发原型：** 项目仍在开发中，不能用于承载正式项目数据。试用时请另行保留备份。

## 布局方式

| 视图     | 说明                                                         |
| -------- | ------------------------------------------------------------ |
| 时间树   | 默认布局，结合分支结构与日期，允许节点在七天范围内调整位置。 |
| 日期优先 | 按日期分层排列节点，同时为不同分支留出空间。                 |

两种视图均支持横向和纵向排布。没有日期的母节点根据后代日期确定自动位置。

## 功能

- 创建、移动、复制、剪切、粘贴和折叠分支，支持跨项目标签页操作。
- 基于 CodeMirror 6 的 Markdown 实时编辑与预览，支持快捷键格式化、Callout 提示框与 5 态任务体系（`[ ]`、`[x]`、`[-]`、`[~]`、`[?]`）。
- 项目自包含图片嵌入、SHA-256 去重、Worker 自动压缩（超 1 MiB / 2048 px 触发）与拖拽相对宽度缩放（`{width=X%}`）。
- 编辑节点日期、Markdown 笔记、标签、任务、尺寸和连线，支持失焦/离开节点与 5 秒定时自动保存。
- 按分支汇总任务，通过日期目录定位节点。
- 切换 2D 与 3D 视图，高亮主干并导出 SVG。
- 导入和导出 .branch.json，按 Ctrl+S / ⌘S 下载当前项目文件。
- 使用浏览器 IndexedDB 本地保存项目快照。

## 快速开始

打开[在线演示](https://panwanke.github.io/workspacetree/)，或安装 Node.js 22.12 及以上版本和 pnpm 10.33.0，在本地运行：

    corepack enable
    pnpm install --frozen-lockfile
    pnpm dev

在浏览器打开 Vite 显示的地址。通过「项目 → 导入 .branch.json」或拖入文件打开项目，通过「项目 → 导出 .branch.json」或 Ctrl+S 下载项目快照。

## 开发

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm --filter @workspacetree/web build

更多信息见[变更索引](CHANGELOG.md)。

## 技术栈

React、TypeScript、Vite、React Flow、Three.js、Zod、pnpm workspaces 和 IndexedDB。

## 许可证

本仓库尚未指定开源许可证。
