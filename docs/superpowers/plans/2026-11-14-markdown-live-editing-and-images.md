# WorkspaceTree Markdown 实时编辑与图片处理计划

2026-11-14，讨论版技术方案。与树形布局计划独立交付，图片尺寸对接该计划中的节点及分支缩放。

## 目标与本期范围

节点笔记支持类似 Obsidian 的实时编辑预览。光标所在内容可编辑 Markdown，离开编辑位置的内容呈现标题、列表、checkbox、callout 和图片。提供源代码模式，支持中文输入、文本选区、撤销和快捷键。

图片支持剪贴板、拖放、文件选择和图片 URL。文件默认压缩后嵌入项目，URL 自动识别并渲染。每次插入的图片可独立拖动调整显示尺寸，随节点内容区变化。

用户已明确图床留待后续。本期完成嵌入与链接两条路径，技术方案保留未来上传接口。本文的大小阈值、快捷键和保存节奏是建议默认值，实施验收时可以调整。

## 当前代码与改动原因

| 现状 | 对本方案的影响 |
| --- | --- |
| `apps/web/src/CanvasNode.tsx` 和 `WorkspaceInspector.tsx` 各自使用 textarea | 需要同一个 MarkdownEditor 组件、草稿会话和快捷键处理 |
| `apps/web/src/MarkdownPreview.tsx` 使用逐行判断与正则 | 替换为语法树渲染，支持多行 callout、嵌套列表、带括号的 URL 和代码块 |
| `blocks[].payload.markdown` 保存纯文本，`node.setNote` 与 `node.editMarkdownBlock` 写入 | 沿用 Markdown 源文本，增加资产和任务语法版本契约 |
| `markdown-todos.ts` 把 `[*]` 认作完成、`[x]` 认作废弃 | 新标记需要版本迁移，同时更新汇总、筛选、编辑和导入 |
| IndexedDB 适配器以整个项目 JSON 快照写入，历史记录可包含整域快照 | 嵌入图片会增加序列化、哈希和日志开销，需限制单图并测量整项目负担 |
| 节点有单节点缩放、分支缩放、自定义尺寸与画布缩放 | 图片尺寸必须从最终内容区计算，拖动时还要换算画布缩放 |
| 卡片预览最多取 8 行源文本 | 改成按解析后的块和可用高度裁切，避免把图片、代码或 callout 从源码中间切开 |

## 技术栈与选型

| 层 | 选择 | 作用 |
| --- | --- | --- |
| UI | 现有 React、TypeScript、Vite、React Flow | 节点编辑、侧栏、设置、尺寸交互 |
| 编辑器 | CodeMirror 6，直接使用 `@codemirror/state`、`view`、`commands`、`lang-markdown`、`language`、`autocomplete` | 文档事务、选区、输入法、键位、增量解析与补全 |
| 实时预览 | CodeMirror Decoration、WidgetType、StateField | 对未编辑语法做样式或替换，呈现 checkbox、图片与 callout |
| 只读渲染 | react-markdown、remark-gfm，自有少量 remark 扩展 | CommonMark/GFM、扩展任务状态、callout、旧高亮与颜色语法 |
| 共用语义 | 新建 `packages/markdown`，使用 unified、remark-parse、remark-gfm，保留源码位置 | 编辑、预览、任务汇总及图片引用扫描使用同一套语义规则 |
| 图片处理 | Web Worker、createImageBitmap、OffscreenCanvas，Canvas.toBlob 回退 | 校验、缩放、压缩、方向纠正和生成图片二进制 |
| 资源寻址 | 项目资产表、内容 SHA-256、运行时 Blob URL | 同一文件去重、自包含导出、缓存解码结果 |
| 校验与保存 | 现有 Zod、CommandService、写入队列及恢复协议 | 原子提交图片和笔记、版本迁移、保存失败恢复 |
| 测试 | 现有 Vitest，浏览器验收使用现有 playwright-core 与可用浏览器 | 语法、状态、数据往返、输入法和缩放交互 |

CodeMirror 的 Markdown 语言支持、装饰和自定义 widget 可以组合出所需编辑体验，实时预览扩展需要在项目中实现。Lezer 用于编辑时增量定位，remark 用于语义解析和只读渲染，两者用共用语法样例核对。依赖在实施时锁定经过现有 React/Vite 构建验证的具体版本。[CodeMirror Markdown](https://github.com/codemirror/lang-markdown)、[Decoration 与 Widget 源码](https://raw.githubusercontent.com/codemirror/view/main/src/decoration.ts)

比较过两种替代方案。Tiptap/ProseMirror 适合围绕富文本节点构建编辑器，其 Markdown 导入导出需要额外处理旧扩展语法和文本往返。继续扩展 textarea 的成本较低，但实现光标、选区与局部渲染会逐步变成自建编辑器。因此本计划采用 CodeMirror。[Tiptap Markdown](https://tiptap.dev/docs/editor/markdown)

react-markdown 提供 React 渲染入口，remark-gfm 提供表格、删除线和标准任务列表等语法。扩展语法通过 AST 插件实现，输出受控 React 组件，图片 URL 经统一解析器处理。[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)

## 编辑与保存行为

1. 双击节点或点击侧栏编辑，进入同一个按项目 ID、节点 ID 和笔记块 ID 标识的草稿会话。一个笔记同时只有一个可输入编辑器，另一个入口可显示草稿预览。
2. 标题、粗体、列表等保留可编辑文本并用装饰显示样式。选区进入语法范围时展开对应源码，离开后隐藏标记。图片显示 widget，可点击编辑地址或拖动尺寸。Callout 的正文仍是 CodeMirror 文本，外观通过块样式和标题 widget 呈现。
3. 影响块高度的装饰通过 StateField 提供。图片解码或拖动尺寸改变高度时调用 requestMeasure，避免编辑器测量失效。编辑器挂载跟随编辑会话，React 更新不能每次重建 EditorView。
4. 中文输入期间检查 composition 状态，等输入完成后更新替换装饰和快捷转换。多行选择时展示覆盖范围源码，复制得到真实 Markdown。
5. 本期保留「保存／取消」会话语义。实时渲染发生在草稿里，保存或 Ctrl/Cmd+Enter 时把文本与新增资产原子提交。取消恢复编辑前内容。切换节点时保留有改动的草稿与可见提示，刷新前有未保存内容时提示用户。
6. 编辑器内 Ctrl/Cmd+Z、重做只操作本次草稿。保存整个会话形成一条项目历史记录，退出编辑后项目撤销恢复保存前内容。保存失败保留草稿并允许重试。
7. Ctrl/Cmd+S 先提交当前有效草稿，再导出最新项目。存在未完成图片处理时显示等待或失败状态，完成后继续。以实际持久化成功作为「已保存」依据。
8. 提交带原笔记内容或修订前置条件。若任务视图或其他入口已改变同一块，展示冲突并保留双方文本，由用户选择合并。图片处理完成只能更新创建它的草稿会话。
9. 性能上只为当前编辑笔记创建 CodeMirror，其他节点用轻量预览。按笔记文本版本缓存 AST，任务汇总只重新解析变化的块。编辑器装饰限制在必要范围，图片按可见范围加载。

## 快捷输入与 Markdown 语法

快捷键仅在编辑器获得焦点时生效，进入现有设置体系并允许改键。画布的 Tab 新建节点、Delete 删除、Ctrl/Cmd+C/X/V 分支操作在编辑器内由文本编辑接管。

| 操作 | 建议默认键或输入规则 |
| --- | --- |
| 无序列表 | Ctrl/Cmd+Shift+7，或行首输入 `- ` |
| 有序列表 | Ctrl/Cmd+Shift+8，或行首输入 `1. ` |
| Checkbox | Ctrl/Cmd+Shift+9，将当前行或选中行转为 `- [ ] ` |
| 勾选任务 | Ctrl/Cmd+Shift+Enter 在任务行切换完成状态 |
| 保存笔记 | Ctrl/Cmd+Enter 提交草稿 |
| Callout | Ctrl/Cmd+Shift+C，选区包装为 `> [!note]`，选中类型以便替换 |
| 粗体／斜体／链接 | Ctrl/Cmd+B、Ctrl/Cmd+I、Ctrl/Cmd+K |
| 缩进／反缩进 | Tab、Shift+Tab，在列表层级内工作 |
| 连续输入 | Enter 延续列表或引用前缀，空条目再次 Enter 退出当前层级 |
| 命令补全 | 空行输入 `/` 显示 list、numbered、checkbox、callout、image。代码块中按普通字符输入 |
| 原样粘贴 | Ctrl/Cmd+Shift+V 走纯文本，跳过 URL 自动转图 |
| 源码模式 | 编辑器按钮切换，可在设置中绑定快捷键 |

键位实施前做浏览器冲突检查，菜单显示当前实际绑定。列表转换保留正文内容、嵌套层级和现有换行，重复执行同一列表命令时取消对应格式。

Callout 首期支持 note、info、tip、warning、question、success、example，以及 `+`／`-` 默认展开折叠标记。未知类型用通用样式显示，并保留原类型文本。支持块内列表、任务与图片。源码示例为 `> [!warning] 注意`，后续行继续使用 `>`。该写法参照 Obsidian。[Obsidian Callouts](https://obsidian.md/help/callouts)

兼容现有 `==高亮==` 和 `{color:颜色}文本{/color}`，颜色只允许合法颜色值。标准标题、链接、引用、代码块、嵌套列表和表格由语法树处理。

## 任务状态的新策略

| 标记 | 状态 | 点击及管理行为 |
| --- | --- | --- |
| `[ ]` | 未完成 | 点击勾选为已完成 |
| `[x]` | 已完成 | 点击取消勾选为未完成，大写 X 同义 |
| `[-]` | 废弃 | 表示放弃这项任务，可在状态菜单恢复 |
| `[~]` | 停用 | 暂停推进，可在状态菜单恢复为未完成 |
| `[?]` | 待定 | 尚待决定是否执行 |

`[-]`、`[~]`、`[?]` 是本项目扩展状态。其他 Markdown 阅读器可能显示原始标记，项目内由统一解析器渲染。废弃、停用、待定在快捷菜单单独选择，普通勾选只切换未完成与完成。

旧文件迁移按原 schemaVersion 执行一次，从原文本匹配状态后一次性输出。旧 `[*]`／`[\\*]` 变为 `[x]`，旧 `[x]`／`[X]` 变为 `[-]`，原 `[?]` 保留。通过语法树和源码区间定位任务行，跳过代码围栏、行内代码与普通文字示例，保留缩进、换行符、标签和日期。新版本的 `[x]` 始终是完成。

结构化 Task 的 status 增加 paused。Markdown 与结构化任务共用状态映射，任务页增加停用筛选。全部列表仍能查看所有状态。建议进度分母取未完成加已完成，其他三种状态单独计数。旧项目迁移前后每种业务状态的数量一致；采用新的进度口径时，更新界面说明和计算测试。停用、废弃、待定的结构化任务统一设置 done=false。

迁移覆盖持久化项目、导入、预览、CLI 及测试 fixture。先按旧契约验证原文件，再迁移，最后生成新版本哈希及修订。恢复日志中的快照也必须按相同版本路径读取，避免迁移与崩溃恢复产生互相矛盾的哈希。

## 图片的共同数据流

输入 → 确认文件或 URL → 占位与进度 → 校验／压缩或远端加载 → 插入到原草稿位置 → 用户保存 → 原子写入笔记和资产。

插入占位是会话状态，异步位置通过 CodeMirror ChangeDesc 映射。处理期间继续打字、移动光标、撤销占位或删除节点时，不会把图片插到新的光标位置。剪贴板同时有文件和 HTML 图片时优先处理文件，并按输入项去重。多图按原顺序占位，并发处理默认两张。

### A. 默认嵌入

嵌入指图片二进制随项目保存并随 `.branch.json` 导出。编辑文档使用短资产地址，避免大段 Base64 进入光标编辑和 Markdown 解析。

建议文件契约如下，数值与 ID 仅作结构示例。

```json
{
  "assets": {
    "sha256_abcd": {
      "mime": "image/webp",
      "byteLength": 180000,
      "width": 1600,
      "height": 1000,
      "base64": "..."
    }
  }
}
```

资产表放在 DomainState，笔记中引用 `![说明](asset:sha256_abcd)`。ID 由压缩完成后的真实字节计算。重复图片可共享资产，插入位置的显示大小分别保存。同一资产使用懒加载 Blob URL 缓存，引用释放后清理 URL。

扩展 Zod、领域命令和哈希规则。提交笔记及相关资产是一项原子编辑。资源不可变，替换图片创建新的内容 ID。复制／跨项目移动时扫描 Markdown AST，连同引用资产转移或按哈希复用。源端仍有其他引用、草稿或撤销记录需要的资源继续保留。

删除图片引用允许撤销恢复。本期普通编辑保留未引用资产，明确执行「清理未使用图片」时扫描当前项目和历史，或在历史释放后再清理。项目导出包含其资产表，保证重新打开完整性。

导入旧笔记中的图片 data URL 时，解析并检查实际媒体类型与大小，通过显式迁移或保存操作转换成资产引用。压缩造成内容变化时给出结果摘要。导入缺失资产显示可恢复的占位，并保留地址供用户修复。

### 压缩建议值

| 项目 | 默认值和处理 |
| --- | --- |
| 自动压缩触发 | 文件超过 1 MiB，或长边超过 2048 px |
| 目标 | 最终文件不超过 1 MiB、长边不超过 2048 px，宽高同比例 |
| 输入限制 | 单文件 20 MiB，解码尺寸 40 MP。先探测格式头与像素尺寸，再分配解码资源 |
| 静态图片 | JPEG、PNG、WebP 为首期主路径，浏览器可解码的 AVIF 可转码 |
| 压缩方式 | Worker 中先缩尺寸，再迭代有损质量。截图／透明图先试 PNG 或 WebP，照片优先 WebP，编码不支持时检查实际 MIME 并回退 |
| 质量下限 | 建议 quality 0.65，达不到目标再降低分辨率。仍超限时提供失败原因和手动处理选项 |
| 动图 | 识别 GIF/APNG/动画 WebP。阈值内保留动画，超限由用户选择静态首帧转换，防止无提示丢动画 |
| SVG／不可解码格式 | 给出格式提示。首期本地文件支持聚焦于可验证的栅格图，提供转 PNG/WebP 的操作说明 |

阈值作为设置项，默认行为是超限压缩。编码结果校验尺寸、字节数、MIME 和透明通道，失败时保留待处理文件以便重试。Worker 超时或取消后释放资源。Canvas 编码的可用 MIME 与跨域条件存在浏览器限制，需要检测结果。[OffscreenCanvas.convertToBlob](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)

Base64 比二进制约多三分之一，当前全项目快照又会放大写入成本。使用 `navigator.storage.estimate()` 估计余量，捕获 QuotaExceededError 后保留草稿并提示导出或减少图片。建议累计原始资产超过 20 MiB 时显示项目大小提示。验收包括 20 MiB 资产项目连续编辑与导出耗时，若一次保存明显阻塞 UI，再把快照序列化和哈希放到 Worker；重构 Blob 独立持久化需要与恢复协议一起评估。[浏览器存储配额](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

### B. 图片链接识别

- 粘贴单个 HTTP(S) URL 时，先解析 URL。已知图片扩展名只作为候选提示，保留查询参数，随后通过图片加载结果确认。无扩展名的 URL 也尝试加载并判断是否为图片。
- 识别期间显示可撤销的候选。成功后转为 `![图片说明](https://...)`，失败保留原链接并提供「作为图片插入」入口。代码块和原样粘贴走普通文本。
- 粘贴已经合法的 Markdown 图片时复用其源地址。外部 URL 的原有编码、签名参数和括号转义通过 AST 处理。
- 远程图片默认直接显示 URL。图片在画布中的显示大小受节点限制。提供「转为嵌入」操作，浏览器能够读取远程文件时再走 A 的压缩和存储。
- 远端服务器若没有允许跨域读取，浏览器通常仍可能显示图片，但不能读取其字节进行压缩或导出为自包含资源。加载失败、链接过期、防盗链和混合内容问题在图片位置显示重试／编辑地址／下载后重新插入。
- 普通显示使用 img，不强制设置要求 CORS 的 crossOrigin。需要读取像素时单独发起符合 CORS 的请求。外链按需加载，并设置合适的 referrerPolicy。

远程显示与读回像素的权限条件不同。直接显示路径无法保证远程文件符合本地的 1 MiB 限制，限制可读文件时需要转为嵌入并执行压缩流程。[跨域图片与 Canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)

## 图片拖动缩放与节点联动

使用相对宽度，建议默认 100%，拖动范围 10%–100%，锁定图片原始宽高比。建议保存为本项目的图片属性扩展。

```markdown
![实验装置](asset:sha256_abcd){width=60%}
![参考图片](https://example.org/image.png){width=80%}
```

`{width=60%}` 属于本项目语法，需要 remark 和 CodeMirror 插件共同识别。普通 Markdown 工具可能显示后缀文本。图片来源仍使用常见 Markdown 图片结构，标准 Markdown 导出时可移除属性并把资产转换为附件；本期以项目文件的完整往返为验收目标。Obsidian 原有像素尺寸写法可作为输入兼容，首次拖动时转换成当前容器下的相对宽度。[Obsidian 图片嵌入和尺寸](https://obsidian.md/help/embeds)

显示计算以最终节点内容区为准。

```text
availableWidth = 节点最终宽度 - 左右内边距
desiredWidth = availableWidth × widthPercent / 100
renderWidth = min(desiredWidth, availableHeight × intrinsicWidth / intrinsicHeight)
renderHeight = renderWidth × intrinsicHeight / intrinsicWidth
```

卡片的 availableHeight 为扣除标题、任务摘要和必要留白后的预览预算。长文和多图按块进入卡片预览窗口，完整内容在编辑器和侧栏中滚动查看。侧栏没有卡片高度约束时按宽度显示。极小节点进入摘要后隐藏图片内容。

拖动把屏幕位移换算为实际内容区宽度的比例。利用容器 getBoundingClientRect 的屏幕宽度计算百分比，避免重复乘画布 zoom、节点 scale 或 branchScale。拖动过程只更新预览，松手写回一次 Markdown 文本事务，支持撤销。

节点缩到父节点的 85%、节点改宽、整条分支缩放和画布缩放均通过最终内容盒自然反映到图片。图片拖动只改变显示尺寸，压缩由插入流程控制。图片加载时预留已知宽高比，避免布局跳动。图片控件采用 nodrag/nopan，拖动图片柄不会拖动节点。

2D 卡片与侧栏使用同一图片组件。SVG 导出把内嵌资源写成 data URL 的 image 元素，外链使用原 URL 并说明依赖网络。Three.js 对内嵌资源可生成纹理，远程纹理需 CORS；不满足时显示图片占位与说明。三种视图共用尺寸计算，远端导出效果单独验收。

## 安全与故障处理

Markdown 原始 HTML 默认作为文本或忽略，插件仅生成受控组件。图片资源只允许已校验的 asset 地址与 HTTP(S) URL，旧 data URL 只接受检查过的图片类型。禁用 javascript 和任意 file 地址，资产 URL 由内部解析器映射，不把自定义协议直接交给浏览器。

保存失败、处理失败和离线状态明确显示。超时任务可取消。图片被删除后迟到的异步结果丢弃，完成图片进入草稿的操作可以撤销。只读预览禁止修改、上传与拖动尺寸。批量插入和跨项目移动均验证一次失败不会留下半套笔记与资源。

## 图床后续开发记录

用户已决定后续开发。本期设置页面无需展示不可用的图床开关。

未来增加「图片保存方式」设置，支持嵌入或上传图床。上传模式把本地图片经同样的压缩处理后发送到用户配置接口，取得稳定的图片展示 URL，再走 B 的渲染。上传失败保留待上传状态，由用户重试或选择切回嵌入。

适配器可采用 `upload(file, signal) → { url, width, height, mime }`。配置包含接口地址、请求方式、文件字段、有限的自定义字段／请求头和 JSON 返回 URL 的字段路径。自定义响应映射使用数据路径，避免执行任意脚本。

上线时明确「全部上传」的历史迁移范围。新文件按上传模式处理，已有嵌入图片通过批量转换任务上传，全部替换成功后释放本地引用。远程旧图转存需要读权限或用户部署的代理。凭据只进入独立本机配置或后端，项目文件及日志不包含凭据。

浏览器直传需要接口 CORS。S3 兼容服务使用后端或用户网关签发短期上传地址，笔记保存长期展示 URL。静态 GitHub Pages 无法保管服务端密钥，若采用网关需另行部署并认证。预签名上传 URL 有有效期，不能直接作为长期图片地址。[S3 预签名上传](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## 分阶段实施与验收

### 阶段 1　语法契约、任务迁移和共用解析

- [ ] 新建 `packages/markdown/package.json`、`packages/markdown/tsconfig.json`、`packages/markdown/src/index.ts`、`packages/markdown/src/parse.ts`、`packages/markdown/src/tasks.ts`、`packages/markdown/src/callouts.ts`、`packages/markdown/src/images.ts`。沿现有 workspace 与 tsconfig 方式注册。markdown 包只依赖解析库及 schema，core 和 web 可以调用 markdown，schema 保持底层依赖方向。
- [ ] 修改 `packages/schema/src/entities.ts`、`packages/schema/src/state.ts`、`packages/schema/src/common.ts`、`packages/schema/src/version.ts`，新增资产契约、paused 状态和版本信息。需要 Markdown 解析的版本迁移由 core 的纯函数模块协调，调整现有迁移注册位置，避免 schema 反向引用 markdown。
- [ ] 修改 `packages/core/src/migration.ts`、`validation.ts`、`reducer.ts`、`canonical.ts`，以及 import 和 storage 读取入口，保证旧版本校验、迁移、哈希和恢复顺序一致。
- [ ] 修改 `apps/web/src/markdown-todos.ts`、`todo-editing.ts`、`project-todos.ts`、`TodoEditor.tsx`、`WorkspaceTodos.tsx`，统一五种状态。新建 `tests/markdown/syntax.test.ts` 与 `tests/core/markdown-migration.test.ts`，扩展现有 TODO 测试。
- [ ] 验收包含旧完成／废弃迁移、同一文件重复打开不重复转换、围栏内示例、callout 中的任务、带标签日期的任务、结构化 paused 和旧项目统计。

### 阶段 2　实时编辑与快捷键

- [ ] 新建 `apps/web/src/markdown/MarkdownEditor.tsx`、`live-preview.ts`、`commands.ts`、`editor-session.ts`、`markdown.css`。CodeMirror 的状态和变更由 editor-session 管理，React 提供容器和回调。
- [ ] 替换 `CanvasNode.tsx`、`WorkspaceInspector.tsx` 的笔记 textarea，重写 `MarkdownPreview.tsx` 的渲染入口。在 `App.tsx` 与 `history.ts` 接入保存／取消／导出前提交。
- [ ] 扩展 `keybindings.ts` 与 `SettingsModal.tsx`，按编辑器焦点分发按键。
- [ ] 新建 `tests/web/markdown-editing.test.ts` 验证列表包装、撤销、选区和任务切换，浏览器验证中文 IME、点击 checkbox、callout 折叠、源码切换、焦点和 Tab 行为。
- [ ] 验收 200 行笔记编辑，只有当前节点创建 EditorView，逐字输入不触发全画布持久化与重新布局。

### 阶段 3　嵌入、压缩与 URL

- [ ] 新建 `apps/web/src/images/image-input.ts`、`image-processing.worker.ts`、`image-assets.ts`、`image-url.ts`，统一四种输入和异步占位。图片校验与存储命令支持无 DOM 的测试。
- [ ] 在 core 增加笔记和资产的原子提交命令，在 `history.ts` 生成反向记录，`branch-editing.ts` 复制所需资产。扩展导入、导出与存储故障处理。
- [ ] 新建 `tests/web/image-insertion.test.ts` 和 `tests/core/image-assets.test.ts`，覆盖透明 PNG、照片、压缩阈值、重复图、多图次序、取消、输入移动、保存失败与缺失资产。
- [ ] 浏览器验证带查询参数的图片链接、无扩展名图片、非图片 URL、离线图片、受跨域限制的显示与转嵌入。嵌入图片项目下载后在新的本地存储环境导入，图片可离线查看。

### 阶段 4　尺寸联动与完整回归

- [ ] 新建 `apps/web/src/images/MarkdownImage.tsx` 与尺寸交互样式，编辑 widget 和只读渲染共用。图片属性解析已在阶段 1 约定。
- [ ] 修改 `packages/export/src/svg.ts` 和 `apps/web/src/ThreeCanvas.tsx` 接入资产解析与尺寸，扩展 `tests/export/svg.test.ts`。运行 `tests/web/branch-editing.test.ts`、`tests/storage/adapter.contract.test.ts` 与读写集成测试验证跨项目和恢复。
- [ ] 浏览器验收同一图片在 25%、50%、100%、200% 画布缩放下拖动，节点 85% 尺寸、分支缩放、横纵布局、长图、多图、摘要和重新加载。
- [ ] 使用 20 MiB 资产项目记录保存／导出耗时、输入响应和峰值内存，确认数据 URL 没有进入 CodeMirror 正文、缩放不重新编码图片、Blob URL 正确释放。
- [ ] 更新 README 与 CHANGELOG，说明任务标记迁移、图片来源、压缩默认值和资源自包含范围。
- [ ] 最终运行 `pnpm generate:json-schema`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm --filter @workspacetree/web build`，完成实际浏览器验收后再判定可交付。

## 讨论结论与默认选择

已确定实时编辑预览、列表／checkbox／callout 快捷输入、默认嵌入及超限压缩、图片链接转换、图片拖动尺寸跟随节点、图床后续开发。

本计划建议 `[-]` 表示废弃、`[~]` 表示停用，保留 `[?]` 待定。默认压缩阈值为 1 MiB／2048 px。保存沿用编辑会话提交，实时渲染在输入过程中生效。图片比例采用明确记录的项目扩展语法。上述具体选择供本轮审阅，本文是技术设计与分阶段计划，实际开发前按依赖锁定结果细化命令实现。
