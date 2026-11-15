import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../apps/web/public/favicon.svg');
const svgContent = readFileSync(svgPath, 'utf-8');

const sizes = [
  { size: 512, filename: '../apps/web/public/icon-512.png' },
  { size: 192, filename: '../apps/web/public/icon-192.png' },
  { size: 180, filename: '../apps/web/public/apple-touch-icon.png' },
  { size: 32, filename: '../apps/web/public/favicon.png' },
];

async function generate() {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();

  for (const { size, filename } of sizes) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
    svg { width: ${size}px; height: ${size}px; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html);
    // 等待渲染
    await page.waitForTimeout(100);

    const outPath = resolve(__dirname, filename);
    await page.screenshot({ path: outPath, omitBackground: true });
    console.log(`Generated ${filename} (${size}x${size})`);
  }

  await browser.close();
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
