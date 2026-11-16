import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const mode = process.argv[2];
assert.ok(mode === 'static' || mode === 'account', 'Choose static or account.');
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const server = await preview({
  configFile: resolve(webRoot, mode === 'static' ? 'vite.static.config.ts' : 'vite.config.ts'),
  preview: { host: '127.0.0.1', port: 0 },
});

try {
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const { base } = server.config;
  const channel = process.env.WST_BROWSER_CHANNEL;
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
    });
    const unexpectedRequests = [];
    const pageErrors = [];
    await context.route(/^https?:\/\//, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const isStaticFile =
        (request.resourceType() === 'document' && url.pathname === base) ||
        url.pathname.startsWith(`${base}assets/`) ||
        ['favicon.svg', 'favicon.png', 'apple-touch-icon.png'].some(
          (file) => url.pathname === `${base}${file}`,
        );
      if (
        url.origin === origin &&
        (mode === 'account' || (isStaticFile && request.method() === 'GET'))
      ) {
        return route.continue();
      }
      if (mode === 'static') unexpectedRequests.push(`${request.method()} ${request.url()}`);
      return route.abort();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${origin}${base}`);
    const title = page.locator('.wst-project-bar h1');
    await title.waitFor();
    const accountControl = page.getByRole('button', { name: /^(登录|账号与项目空间)$/ });

    if (mode === 'static') {
      assert.equal(await accountControl.count(), 0, 'Pages must not render an account control.');
      assert.equal(await page.getByTestId('storage-scope').textContent(), '本地浏览器项目');
      const fixture = fileURLToPath(
        new URL('../../../tests/fixtures/minimal.branch.json', import.meta.url),
      );
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('project-menu').click();
      await page.getByRole('button', { name: '导入 .branch.json' }).click();
      await (await chooser).setFiles(fixture);
      await page.getByRole('heading', { name: 'Minimal fixture', exact: true }).waitFor();
      await page.getByTestId('add-node').click();
      await page.getByTestId('node-count').getByText('3 个节点').waitFor();

      await page.getByTestId('project-menu').click();
      await page.getByTestId('export-json').click();
      const projectDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '直接下载' }).click();
      const project = await projectDownload;
      assert.match(project.suggestedFilename(), /\.branch\.json$/);
      const downloaded = JSON.parse(await readFile(await project.path(), 'utf8'));
      assert.equal(downloaded.projectId, 'prj_fixture_0001');
      assert.equal(downloaded.domain.nodes.length, 3);

      await page.getByTestId('project-menu').click();
      const svgDownload = page.waitForEvent('download');
      await page.getByTestId('export-svg').click();
      assert.match(await readFile(await (await svgDownload).path(), 'utf8'), /<svg[\s>]/);

      await page.reload();
      await page.getByRole('heading', { name: 'Minimal fixture', exact: true }).waitFor();
      await page.getByTestId('node-count').getByText('3 个节点').waitFor();
    } else {
      const login = page
        .locator('.wst-project-bar')
        .getByRole('button', { name: '登录', exact: true });
      assert.equal(await login.count(), 1, 'Login must be in the project header.');
      await login.click();
      const dialog = page.getByRole('dialog', { name: '登录 WorkspaceTree' });
      await dialog.waitFor();
      const phone = dialog.getByRole('textbox', { name: '手机号' });
      assert.ok(await phone.evaluate((input) => input === document.activeElement));
      await phone.fill('123');
      await dialog.getByRole('button', { name: '获取验证码' }).click();
      await dialog.getByRole('alert').getByText('请输入正确的 11 位手机号').waitFor();
      await dialog.getByRole('button', { name: 'WorkBuddy 账号登录' }).waitFor();
      await dialog.getByRole('button', { name: '微信扫码登录' }).waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await login.evaluate((button) => button === document.activeElement));

      const screenshots = process.env.WST_SMOKE_SCREENSHOTS;
      if (screenshots) {
        await mkdir(screenshots, { recursive: true });
        await page.screenshot({ path: resolve(screenshots, 'login-entry.png') });
        await login.click();
        await dialog.waitFor();
        await phone.fill('');
        await page.screenshot({ path: resolve(screenshots, 'login-desktop.png') });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      }
      await page.setViewportSize({ width: 390, height: 760 });
      const project = await page.getByTestId('project-menu').boundingBox();
      const trigger = await login.boundingBox();
      assert.ok(
        project &&
          trigger &&
          trigger.y + trigger.height <= project.y &&
          trigger.x + trigger.width <= 390,
        'On mobile, login is above the project tools and remains within the header.',
      );
      await login.click();
      await dialog.waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
      if (screenshots) await page.screenshot({ path: resolve(screenshots, 'login-mobile.png') });
      await dialog.getByRole('button', { name: '继续使用本地空间' }).click();
      await dialog.waitFor({ state: 'hidden' });
    }

    assert.deepEqual(pageErrors, [], 'Unexpected browser errors');
    assert.deepEqual(unexpectedRequests, [], 'Unexpected network requests from Pages');
    console.log(`${mode} browser smoke test passed`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
