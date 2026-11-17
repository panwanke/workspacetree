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

async function importLinkedFixture(page, fixture, filename, title) {
  const project = JSON.parse(await readFile(fixture, 'utf8'));
  project.domain.project.title = title;
  await page.evaluate(
    async ({ filename, project }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(project));
      await writable.close();
      sessionStorage.setItem('smoke-picker-file', filename);
    },
    { filename, project },
  );

  await page.getByTestId('project-menu').click();
  assert.equal(
    await page.getByRole('button', { name: '导入 .branch.json', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '导入并同步 .branch.json', exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  assert.equal(await page.getByTestId('storage-scope').textContent(), `同步文件 · ${filename}`);
}

async function verifyLinkedProjectFile(page, fixture) {
  const filename = 'linked-project.branch.json';
  await importLinkedFixture(page, fixture, filename, 'Linked fixture');
  await page.getByTestId('add-node').click();
  await page.getByTestId('node-count').getByText('3 个节点').waitFor();
  await page.keyboard.press('Control+s');
  await page.getByTestId('last-action').getByText('已保存项目').waitFor();
  assert.equal(await page.getByRole('dialog', { name: /另存为/ }).count(), 0);

  const persisted = await page.evaluate(async (filename) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(filename);
    const file = JSON.parse(await (await handle.getFile()).text());
    const nodeCount = file.domain.nodes.length;
    file.domain.project.title = 'Updated outside the canvas';
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(file));
    await writable.close();
    return nodeCount;
  }, filename);
  assert.equal(persisted, 3, 'The canvas edit must write to the selected file.');
  const externalTitle = page.getByRole('heading', {
    name: 'Updated outside the canvas',
    exact: true,
  });
  await externalTitle.waitFor();
  assert.equal(await page.getByTestId('undo-depth').textContent(), '可撤销 0');

  // Simulate a browser that retained the handle but revoked permission on reload.
  await page.evaluate(() => sessionStorage.setItem('smoke-deny-file-permission', '1'));
  await page.reload();
  await externalTitle.waitFor();
  await page.getByRole('tab', { name: /Updated outside the canvas/ }).waitFor();
  await page.getByTestId('node-count').getByText('3 个节点').waitFor();
  assert.equal(await page.getByTestId('storage-scope').textContent(), '本地文件同步已暂停');
  await page.getByRole('button', { name: '恢复同步', exact: true }).click();
  await page.getByTestId('storage-scope').getByText(`同步文件 · ${filename}`).waitFor();
  await page.keyboard.press('Control+s');
  await page.getByTestId('last-action').getByText('已保存项目').waitFor();

  await page.reload();
  await externalTitle.waitFor();
  assert.equal(await page.getByTestId('storage-scope').textContent(), `同步文件 · ${filename}`);
}

async function verifyConnections(page) {
  const canvas = page.getByRole('main', { name: '项目画布' });
  const pane = canvas.locator('.react-flow__pane');
  const point = await pane.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (const y of [bounds.height - 110, bounds.height - 170, bounds.height - 230]) {
      for (const x of [bounds.width - 125, bounds.width - 185, bounds.width - 245]) {
        if (document.elementFromPoint(bounds.left + x, bounds.top + y) === element) return { x, y };
      }
    }
    return null;
  });
  assert.ok(point, 'A blank position is available on the canvas.');
  await pane.dblclick({ position: point });
  const draft = canvas.locator('.wst-card.is-editing');
  await draft.locator('.wst-card-edit-title').fill('独立验证分支');
  const id = await draft.evaluate((element) => element.closest('.react-flow__node').dataset.id);
  await draft.getByRole('button', { name: '保存', exact: true }).click();
  const toggle = page.getByRole('button', { name: '属性面板', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  const inspector = page.getByRole('complementary', { name: '属性面板' });
  await inspector.getByRole('tab', { name: '关联', exact: true }).click();
  await inspector.getByRole('button', { name: '挂到…', exact: true }).click();
  const attach = page.getByRole('dialog', { name: '挂到母节点' });
  await attach.getByRole('searchbox', { name: '搜索母节点' }).fill('Root / Child');
  await attach.getByRole('combobox', { name: '母节点', exact: true }).selectOption('n_child');
  await attach.getByRole('checkbox', { name: '原位挂接' }).check();
  await attach.getByRole('button', { name: '挂接', exact: true }).click();
  await attach.waitFor({ state: 'hidden' });
  const edge = (type, source, target) =>
    canvas.getByTestId(`rf__edge-visual:${type}:${source}:${target}`);
  const hierarchy = edge('hierarchy', 'n_child', id);
  await hierarchy.waitFor();
  await page.getByTestId('fit-view').click();
  await hierarchy.locator('.react-flow__edge-interaction').click();
  await hierarchy.locator('.react-flow__edgeupdater-source').click();
  await canvas.getByRole('status').getByText('选择新母节点，整支会随之移动').waitFor();
  await canvas.locator('.react-flow__node[data-id="n_root"] .wst-card-title').click();
  await edge('hierarchy', 'n_root', id).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await hierarchy.waitFor();

  await canvas.locator(`.react-flow__node[data-id="${id}"] .wst-card-title`).click();
  await inspector.getByRole('button', { name: '新建关联', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建连线' });
  await create.getByRole('combobox', { name: '关系类型' }).selectOption('reference');
  await create.getByRole('combobox', { name: '终点', exact: true }).selectOption('n_root');
  await create.getByRole('button', { name: '保存连线' }).click();
  await edge('reference', id, 'n_root').waitFor();
  await inspector.getByRole('button', { name: '编辑与 Root 的连线' }).click();
  const edit = page.getByRole('dialog', { name: '编辑关联' });
  await edit.getByRole('button', { name: '交换两端' }).click();
  await edit.getByRole('textbox', { name: '备注' }).fill('改接后的备注');
  await edit.getByRole('button', { name: '保存连线' }).click();
  const relation = edge('reference', 'n_root', id);
  await relation.getByText('改接后的备注').waitFor();
  await inspector.getByRole('button', { name: '转为独立分支' }).click();
  await hierarchy.waitFor({ state: 'detached' });

  await page.getByTestId('fit-view').click();
  await relation.locator('.react-flow__edge-textbg').click();
  const handle = relation.locator('.react-flow__edgeupdater-source');
  await handle.hover();
  const start = await handle.boundingBox();
  const destination = await canvas
    .locator('.react-flow__node[data-id="n_child"] [data-handleid="source-right"]')
    .boundingBox();
  assert.ok(start && destination);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();
  await edge('reference', 'n_child', id).getByText('改接后的备注').waitFor();

  await canvas.locator('.react-flow__node[data-id="n_root"] .wst-card-title').click();
  await inspector.getByRole('button', { name: '接入已有分支', exact: true }).click();
  const adopt = page.getByRole('dialog', { name: '接入已有分支' });
  await adopt.getByRole('searchbox', { name: '搜索要接入的节点或分支' }).fill('独立验证分支');
  await adopt.getByRole('combobox', { name: '要接入的节点或分支' }).selectOption(id);
  await adopt.getByRole('button', { name: '挂接', exact: true }).click();
  await edge('hierarchy', 'n_root', id).waitFor();
}

async function verifyProjectTodos(page, touch = false) {
  const activate = (target) => (touch ? target.tap() : target.click());
  const original = touch ? '移动端 TODO 验证' : '桌面 TODO 验证';
  const renamed = original + ' 已编辑';
  const openTodos = () => activate(page.getByRole('button', { name: 'TODO', exact: true }));
  await openTodos();
  const todos = page.getByRole('main', { name: '项目 TODO' });
  await activate(todos.getByRole('button', { name: '添加 TODO 到 项目级', exact: true }));
  const form = todos.getByRole('form', { name: '添加 TODO', exact: true });
  await form.getByRole('textbox', { name: '标题', exact: true }).fill(original);
  await form.getByLabel('计划日期').fill('2027-01-05');
  await activate(form.getByRole('button', { name: '添加', exact: true }));

  const cell = (title) => todos.getByRole('button', { name: '编辑 TODO ' + title, exact: true });
  await activate(cell(original));
  const title = todos.getByRole('textbox', { name: '标题', exact: true });
  await title.fill(renamed);
  assert.equal(await todos.getByRole('button', { name: '保存', exact: true }).count(), 0);
  await title.press(touch ? 'Tab' : 'Enter');
  await cell(renamed).waitFor();

  if (!touch) {
    const editDate = todos.getByRole('button', { name: '编辑计划日期 ' + renamed, exact: true });
    await editDate.click();
    const date = todos.getByLabel('计划日期', { exact: true });
    await date.fill('2027-01-06');
    await date.press('Enter');
    await editDate.getByText('计划 2027-01-06', { exact: true }).waitFor();
    await editDate.click();
    await date.fill('2027-01-05');
    await date.press('Enter');
    await editDate.getByText('计划 2027-01-05', { exact: true }).waitFor();

    const assign = todos.getByRole('button', { name: '修改归属 ' + renamed, exact: true });
    const mode = todos.getByRole('combobox', { name: '分配方式', exact: true });
    await assign.click();
    await mode.selectOption('inbox');
    const inbox = todos.getByRole('region', { name: '待分配', exact: true });
    await inbox.getByRole('button', { name: '编辑 TODO ' + renamed, exact: true }).waitFor();
    await assign.click();
    await mode.selectOption('existing');
    await todos.getByRole('combobox', { name: '目标节点', exact: true }).selectOption('n_root');
    const assigned = todos.getByRole('region', { name: '项目级', exact: true });
    await assigned.getByRole('button', { name: '编辑 TODO ' + renamed, exact: true }).waitFor();
  }

  const filter = todos.getByLabel('状态', { exact: true });
  await filter.selectOption('open');
  await activate(todos.getByRole('checkbox', { name: '完成 ' + renamed, exact: true }));
  await todos.getByText('已完成，当前筛选已隐藏该任务。', { exact: true }).waitFor();
  assert.equal(await filter.inputValue(), 'open');
  await filter.selectOption('all');
  const completed = todos.getByRole('checkbox', { name: '取消完成 ' + renamed, exact: true });
  await completed.waitFor();
  assert.ok(await completed.isChecked());
  const row = completed.locator('xpath=ancestor::li[1]');
  await row.getByText('计划 2027-01-05', { exact: true }).waitFor();
  await row.getByText(/^完成 \d{4}-\d{2}-\d{2}$/).waitFor();

  await activate(todos.getByRole('button', { name: '删除 TODO ' + renamed, exact: true }));
  await cell(renamed).waitFor({ state: 'detached' });
  await activate(todos.getByRole('button', { name: '撤销', exact: true }));
  await completed.waitFor();

  if (!touch) {
    await page.reload();
    await openTodos();
    await completed.waitFor();
    await activate(completed);
    const reopened = todos.getByRole('checkbox', { name: '完成 ' + renamed, exact: true });
    await reopened.waitFor();
    const reopenedRow = reopened.locator('xpath=ancestor::li[1]');
    await reopenedRow.getByText('计划 2027-01-05', { exact: true }).waitFor();
    assert.equal(await reopenedRow.getByText(/^完成 \d{4}-\d{2}-\d{2}$/).count(), 0);
  }
  return renamed;
}

async function verifyMobileWorkspace(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(8_000);
    await page.goto(url);
    await page.locator('.wst-project-bar h1').waitFor();

    for (const [width, height] of [
      [320, 640],
      [390, 760],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      const operations = page.getByRole('navigation', { name: '画布操作', exact: true });
      const controls = ['新建节点', '目录', '搜索节点', '属性面板', '更多'];
      for (const name of controls) {
        const bounds = await operations.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(
          bounds &&
            bounds.x >= 0 &&
            bounds.x + bounds.width <= width + 1 &&
            bounds.y >= height - 80 &&
            bounds.y + bounds.height <= height &&
            bounds.width >= 44 &&
            bounds.height >= 44,
          `${name} is a visible, touch-sized control at ${width} × ${height}.`,
        );
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }

    await page.setViewportSize({ width: 390, height: 760 });
    const readViewport = () =>
      page.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { x: matrix.e, zoom: matrix.a };
      });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.react-flow__viewport');
      return viewport && new DOMMatrix(getComputedStyle(viewport).transform).a > 0.5;
    });
    const blankPoint = await page.locator('.react-flow').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const x = Math.round(bounds.left + bounds.width / 2);
      for (const offset of [32, 58, 96]) {
        const y = Math.round(bounds.top + offset);
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'))
          return { x, y };
      }
    });
    assert.ok(blankPoint, 'There is a blank canvas area for starting touch gestures.');
    const touch = await context.newCDPSession(page);
    const dispatch = (type, touchPoints) =>
      touch.send('Input.dispatchTouchEvent', { type, touchPoints });
    const beforePan = await readViewport();
    await dispatch('touchStart', [blankPoint]);
    for (const distance of [12, 28, 48]) {
      await dispatch('touchMove', [{ x: blankPoint.x + distance, y: blankPoint.y + 8 }]);
    }
    await dispatch('touchEnd', []);
    const afterPan = await readViewport();
    assert.ok(afterPan.x > beforePan.x + 15, 'One-finger drag pans the canvas.');
    const pinchPoints = (distance) => [
      { x: blankPoint.x - distance, y: blankPoint.y, id: 1 },
      { x: blankPoint.x + distance, y: blankPoint.y, id: 2 },
    ];
    await dispatch('touchStart', pinchPoints(35));
    for (const distance of [42, 54, 65]) await dispatch('touchMove', pinchPoints(distance));
    await dispatch('touchEnd', []);
    assert.ok((await readViewport()).zoom > afterPan.zoom + 0.1, 'Pinch zooms the canvas.');

    const directory = page.getByRole('navigation', { name: '侧边目录与多维资源' });
    const inspector = page.getByRole('complementary', { name: '属性面板' });
    await page.getByRole('button', { name: '目录', exact: true }).tap();
    await directory.waitFor();
    await page.getByRole('button', { name: '属性面板', exact: true }).tap();
    await inspector.waitFor();
    await directory.waitFor({ state: 'hidden' });
    await inspector.getByRole('button', { name: '收起属性面板' }).tap();
    await page.getByRole('button', { name: '目录', exact: true }).tap();
    const views = directory.getByRole('radiogroup', { name: '目录视图' });
    const callouts = views.getByRole('radio', { name: 'Callout', exact: true });
    await callouts.tap();
    assert.ok(await callouts.isChecked());
    await directory.getByText('用于补充背景说明、技术选型或环境配置需求。').waitFor();
    await views.getByRole('radio', { name: '时间', exact: true }).tap();
    await directory.getByRole('button', { name: /WorkspaceTree 2.0 研发全景/ }).tap();
    await directory.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '属性面板', exact: true }).tap();
    const note = inspector.getByRole('region', { name: 'Markdown 笔记' });
    await note.getByRole('button', { name: '编辑', exact: true }).tap();
    await note.locator('.cm-content').tap();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('移动端编辑验证 ');
    await note.getByRole('button', { name: '保存笔记', exact: true }).tap();
    await note.getByText('移动端编辑验证', { exact: false }).first().waitFor();
    await inspector.getByRole('button', { name: '收起属性面板' }).tap();

    await page.getByRole('button', { name: '搜索节点', exact: true }).tap();
    const search = page.getByRole('dialog', { name: '搜索项目节点' });
    await search.waitFor();
    await search.getByRole('button', { name: /关闭/ }).tap();

    await page.getByRole('button', { name: '更多', exact: true }).tap();
    await page.getByTestId('toolbar-settings-btn').tap();
    const settings = page.getByRole('dialog', { name: '设置与快捷键' });
    await settings.getByRole('textbox', { name: 'Markdown 自定义 CSS' }).waitFor();
    await settings.getByRole('button', { name: '完成', exact: true }).tap();

    await verifyProjectTodos(page, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);

    const tabs = page.getByRole('tablist', { name: '打开的分支文件' });
    await tabs.waitFor({ state: 'hidden' });
    await page.getByTestId('project-menu').tap();
    await page.getByRole('button', { name: '新建分支文件' }).tap();
    await tabs.getByRole('tab', { name: /分支项目 2/ }).waitFor();
    assert.deepEqual(errors, [], 'Unexpected mobile browser errors');
  } finally {
    await context.close();
  }
}

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
    if (mode === 'static') {
      await page.addInitScript(() => {
        // Use a native handle while substituting the OS picker and permission prompt.
        window.showOpenFilePicker = async () => {
          const root = await navigator.storage.getDirectory();
          return [await root.getFileHandle(sessionStorage.getItem('smoke-picker-file'))];
        };
        const query = FileSystemHandle.prototype.queryPermission;
        const request = FileSystemHandle.prototype.requestPermission;
        FileSystemHandle.prototype.queryPermission = function (options) {
          if (sessionStorage.getItem('smoke-deny-file-permission'))
            return Promise.resolve('prompt');
          return query.call(this, options);
        };
        FileSystemHandle.prototype.requestPermission = function (options) {
          sessionStorage.removeItem('smoke-deny-file-permission');
          return request.call(this, options);
        };
      });
    }
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
      await importLinkedFixture(page, fixture, 'minimal.branch.json', 'Minimal fixture');
      await page.getByTestId('add-node').click();
      await page.getByTestId('node-count').getByText('3 个节点').waitFor();

      const outlineToggle = page.getByRole('button', { name: '大纲', exact: true });
      const outline = page.getByRole('navigation', { name: '侧边目录与多维资源' });
      const canvas = page.getByRole('main', { name: '项目画布' });
      const canvasWidth = await canvas.evaluate((element) => element.clientWidth);
      await outline.getByRole('button', { name: '隐藏大纲' }).click();
      await outline.waitFor({ state: 'hidden' });
      assert.ok((await canvas.evaluate((element) => element.clientWidth)) > canvasWidth + 200);
      assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
      await outlineToggle.click();

      const views = outline.getByRole('radiogroup', { name: '目录视图' });
      assert.equal(await views.getByRole('radio').count(), 4);
      const dates = views.getByRole('radio', { name: '时间', exact: true });
      await dates.press('ArrowRight');
      assert.ok(await views.getByRole('radio', { name: '图片', exact: true }).isChecked());
      const callouts = views.getByRole('radio', { name: 'Callout', exact: true });
      await callouts.check();
      assert.equal(await views.getByRole('radio', { checked: true }).count(), 1);
      await outline.getByText('当前项目暂无 Callout').waitFor();

      const root = canvas.locator('.react-flow__node[data-id="n_root"]');
      const initialHeight = await root.evaluate((element) => element.clientHeight);
      await root.getByText('Root', { exact: true }).dblclick();
      const note = '开头的 Markdown 预览\n\n> [!warning] 核对来源\n> Callout 正文';
      await root.locator('.cm-content').fill(note);
      await root.locator('.cm-content').press('Control+s');
      const preview = root.locator('.wst-card-markdown');
      await preview.getByText('开头的 Markdown 预览', { exact: true }).waitFor();
      assert.ok((await root.evaluate((element) => element.clientHeight)) > initialHeight);
      assert.ok(await preview.evaluate((element) => element.clientHeight >= 20));
      const callout = outline.locator('.wst-callout.is-warning');
      await callout.getByText('核对来源', { exact: true }).waitFor();
      await callout.getByText('Callout 正文', { exact: true }).waitFor();
      assert.equal(await outline.getByText('开头的 Markdown 预览', { exact: true }).count(), 0);
      await outline.getByRole('button', { name: 'Root', exact: true }).click();
      assert.equal(
        await outline
          .getByRole('button', { name: 'Root', exact: true })
          .getAttribute('aria-current'),
        'true',
      );

      await page.getByTestId('project-menu').click();
      await page.getByTestId('export-json').click();
      await page.getByRole('dialog', { name: '另存为分支项目文件' }).waitFor();
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

      await outlineToggle.click();
      await page.reload();
      await page.getByRole('heading', { name: 'Minimal fixture', exact: true }).waitFor();
      await page.getByTestId('node-count').getByText('3 个节点').waitFor();
      assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
      await outlineToggle.click();
      assert.ok(await callouts.isChecked());
      await outline.getByText('Callout 正文', { exact: true }).waitFor();
      const todoTitle = await verifyProjectTodos(page);
      const todoView = page.getByRole('main', { name: '项目 TODO' });
      const todoRow = todoView
        .getByRole('checkbox', { name: '完成 ' + todoTitle, exact: true })
        .locator('xpath=ancestor::li[1]');
      await todoRow.getByRole('button', { name: /定位节点 Root/ }).click();
      const notePanel = page.getByRole('region', { name: 'Markdown 笔记' });
      const noteCheckbox = notePanel.getByRole('checkbox', {
        name: '完成 ' + todoTitle,
        exact: true,
      });
      await noteCheckbox.click();
      await notePanel
        .getByRole('checkbox', { name: '取消完成 ' + todoTitle, exact: true })
        .waitFor();
      await notePanel.getByRole('textbox', { name: '新任务名称' }).fill('笔记新增任务');
      await notePanel.getByRole('button', { name: '新增任务' }).click();
      await notePanel.getByRole('checkbox', { name: '完成 笔记新增任务', exact: true }).waitFor();
      await verifyConnections(page);
      await verifyMobileWorkspace(browser, `${origin}${base}`);
      await verifyLinkedProjectFile(page, fixture);
    } else {
      await page.getByTestId('project-menu').click();
      assert.equal(await page.getByRole('button', { name: '导入并同步 .branch.json' }).count(), 0);
      await page.keyboard.press('Escape');
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
