# Changelog

## 2026-11-17

- **连线属性与样式系统**：单击线段打开独立属性面板，支持查看/编辑关系、母节点、端点定位、备注及样式（常用 7×2 色板、自定义/最近颜色、粗细、实线/虚线/点线、起点/终点/双向箭头）；聚合边按原始关系逐条编辑。新增内存样式剪贴板与批量应用对话框；搜索支持连线备注并自动展开定位。
- **Schema v3 与呈现状态联动**：`SavedPresentation.edgeStyles` 以原始边 ID 持久化样式，新增 v2→v3 迁移和 `presentation.setEdgeStyle` 命令；样式随删除、子树删除、解除父子与跨项目分支复制/移动一致撤销/恢复，不改变语义哈希。
- **2D/SVG 统一样式渲染**：layout 层统一解析默认、覆盖和聚合样式；React Flow 与 SVG 导出共享线宽、线型与箭头配置。3D 画布保持原有渲染，不在本期范围内。

- **统一任务体系与完成时间跟踪**：`TaskSchema` 增加可选 `completedAt` 字段；`packages/markdown` 新增 `workspace-tasks.ts`，打通结构化任务与 Markdown 内嵌任务的统一索引与双向计数；`packages/core` 在任务完成/取消切换时自动维护 `completedAt`，并在 `workspace.replace` 增加语义哈希校验防覆写；项目 TODO 面板支持原位快捷编辑、日期计划与标签联动。
- **关联连线对话框与关系编辑**：新增 `ConnectionDialog.tsx`，支持父子层级挂载、前后置依赖、引用及自定义关联连线的统一创建与编辑；支持节点快速搜索、循环归属校验以及关联备注（note）的撤销/重做事务。
- **画布节点 Markdown 动态高度与移动端触控优化**：`packages/layout` 根据 Markdown 笔记内容智能计算节点卡片最小高度；新增 `workspace-mobile.css`，针对小屏与触控设备优化 44px 目标交互、安全区边距（dvh）与工具栏折叠收纳。
- **双部署架构说明与安全指引**：在 `README.md` 与 `README_zh.md` 中完善 GitHub Pages 纯单机离线版与 WorkBuddy 云端账号版的物理隔离架构对比、本地测试命令，并强化敏感接口与密钥的隐私安全防护。

## 2026-11-16

- **认证错误中文化**：新增 `apps/web/src/cloud/auth-errors.ts`（`describeAuthError`）。发码/验码失败不再把上游英文原文直接抛给用户——腾讯云短信会以 `send error code FailedOperation.PhoneNumberInBlacklist msg number on the blacklist` 这种形态回传，现在统一翻译成「该手机号收不到短信验证码…请换一个手机号登录」这类可操作文案，并保留原始错误码作为 `ActionResult.detail` 小字（`.wst-login-error-code`）供报障。已覆盖黑名单、号码格式、三档限流、短信签名/模板配置类错误，以及 SDK 的 `rate-limited / network / backend-unavailable / unauthenticated / permission-denied / not-found / invalid-request`。
- 登录面板的兜底文案由「操作失败，请检查网络连接后重试」改为中性的「操作失败，请稍后重试」：`service` 已把可预期错误转成 `ActionResult`，走到 `catch` 的是未预期异常，再暗示网络问题会把「号码进黑名单」误诊成断网。OAuth 启动/回调错误保留原文（多为配置类原因，对定位有用）。
- 新增 `tests/web/cloud-auth-errors.test.ts`（7 例）与「发码黑名单不透英文」回归用例；`pnpm validate:all` 全绿（46 文件 / 338 用例）。

## 2026-11-15

- **账号登录与按账号保存项目（代码完成，待部署）**：新增 WorkBuddy Cloud SDK 接入层、手机号验证码登录/注册、WorkBuddy 账号与微信扫码 OAuth（回调落在站点根路径、同标签页跳转）、云端项目仓储与 RLS 隔离方案（`docs/cloud-schema.sql`）、本地/账号双项目空间与登录面板。`publicConfig` 留空时保持原有本地游客模式，不创建假账号；登录、登出与其他标签页登出都会重载页面以重建控制器。
- 新增 `ProjectStorePort` 抽象，解除 `App.tsx`、`ProjectsModal.tsx`、`open-branch-file.ts` 对 `IdbJsonStorageAdapter` 的直接依赖；补充账号服务、云端仓储、项目空间选择三组单元测试。
- 尚未激活云服务、未注入 `publicConfig`、未建表、未部署；GitHub Pages 仍为本地演示站。

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
