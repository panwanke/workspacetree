/**
 * 生成 WorkBuddy 发布用的 /release 静态产物。
 *
 * 用法：先 `pnpm --filter @workspacetree/web build`，再 `node scripts/prepare-release.mjs`。
 *
 * 与直接复制 dist 的区别：入口 index.html 会被改写成「分享网关安全」版本
 * （见 release-boot.js 的说明）——相对资源路径 + 分享码透传 + 可见的加载状态。
 * 这样即使 __wb_rsc cookie 不可用，也不会出现纯白屏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDir = path.join(root, 'apps', 'web', 'dist');
const releaseDir = path.join(root, 'release');
const entryPath = path.join(distDir, 'index.html');

if (!fs.existsSync(entryPath)) {
  throw new Error(
    '找不到 apps/web/dist/index.html，请先执行 pnpm --filter @workspacetree/web build',
  );
}

const html = fs.readFileSync(entryPath, 'utf8');
const scriptTag = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleTag = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/);
if (!scriptTag) {
  throw new Error('构建产物里没有预期的 module script 标签，拒绝生成可能损坏的入口');
}

function relative(url) {
  const clean = url.split(/[?#]/)[0];
  const file = clean.slice(clean.lastIndexOf('/') + 1);
  return clean.includes('/assets/') ? `./assets/${file}` : `./${file}`;
}

const bootSource = fs
  .readFileSync(path.join(here, 'release-boot.js'), 'utf8')
  .replace("'__SCRIPT_SRC__'", JSON.stringify(relative(scriptTag[1])))
  .replace("'__STYLE_HREF__'", JSON.stringify(styleTag ? relative(styleTag[1]) : null));

if (bootSource.includes('</script>')) {
  throw new Error('引导脚本含有 </script> 字面量，会截断内联脚本');
}

const bootStyle = `<style>
    #boot-status { min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; color-scheme: light dark; }
    #boot-status strong { font-size: 16px; }
    #boot-status span { max-width: 34em; opacity: .75; }
  </style>`;

const bootMarkup = '<div id="boot-status">正在加载 WorkspaceTree…</div>';

let entry = html
  .replace(scriptTag[0], '')
  .replace(styleTag ? styleTag[0] : '<!-- no stylesheet in build -->', '')
  // 图标标签改由 release-boot.js 动态注入，以便 URL 带上分享码。
  .replace(/<link\b(?=[^>]*\brel="[^"]*icon")[^>]*>\s*/g, '')
  .replace('<div id="root"></div>', `<div id="root">${bootMarkup}</div>`)
  .replace('</head>', `  ${bootStyle}\n  <script>${bootSource}</script>\n  </head>`);

if (entry.includes('id="root"></div>') || !entry.includes('boot-status')) {
  throw new Error('入口改写未生效，请检查 Vite 产物结构是否变化');
}

fs.cpSync(distDir, releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, 'index.html'), entry, 'utf8');

console.log(`release 已生成：${releaseDir}`);
console.log(`  入口脚本 ${relative(scriptTag[1])}`);
console.log(`  入口样式 ${styleTag ? relative(styleTag[1]) : '(无)'}`);
