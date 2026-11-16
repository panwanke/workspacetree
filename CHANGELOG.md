# Changelog

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
