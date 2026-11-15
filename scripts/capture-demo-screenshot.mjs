import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'apps', 'web', 'dist');
const imagesDir = path.join(rootDir, 'docs', 'images');
const showcasePath = path.join(imagesDir, 'demo-showcase.png');

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url ? req.url.split('?')[0] : '/';
  let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log(`Preview server listening on http://127.0.0.1:${port}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserExe = fs.existsSync(chromePath) ? chromePath : edgePath;

  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-screenshot-'));
  const debugPort = 9333 + Math.floor(Math.random() * 500);

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--window-size=2048,1152',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${tempProfileDir}`,
    `http://127.0.0.1:${port}/`,
  ];

  console.log(`Launching ${path.basename(browserExe)} on debug port ${debugPort}...`);
  const proc = spawn(browserExe, args);

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const resp = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (resp.ok) {
        targets = await resp.json();
        break;
      }
    } catch {}
  }

  if (!targets || targets.length === 0) {
    console.error('Failed to connect to browser debug port');
    proc.kill();
    server.close();
    process.exit(1);
  }

  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pendingRequests = new Map();

  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const evaluate = (expression) => {
    return send('Runtime.evaluate', { expression, returnByValue: true });
  };

  const captureScreenshotToFile = async (filePath) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res.result?.data) {
      const buffer = Buffer.from(res.result.data, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`Saved screenshot (${buffer.length} bytes) to ${filePath}`);
    } else {
      throw new Error(`Failed to capture screenshot: ${JSON.stringify(res)}`);
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') {
        console.error('Browser Exception:', data.params?.exceptionDetails);
      }
      if (data.id && pendingRequests.has(data.id)) {
        const { resolve } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        resolve(data);
      }
    } catch (e) {
      console.error('Error in onmessage:', e);
    }
  };

  ws.onopen = async () => {
    console.log('Connected to CDP');
    await send('Runtime.enable');

    // Wait until nodes are mounted
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const res = await evaluate('document.querySelectorAll(".react-flow__node").length');
      if (res.result?.result?.value >= 25) {
        console.log(`Rendered ${res.result.result.value} nodes.`);
        break;
      }
    }

    // Panoramic overview screenshot: Close empty inspector to show full canvas
    await evaluate(`
      const closeBtn = document.querySelector('button[aria-label="收起属性面板"]');
      if (closeBtn) closeBtn.click();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    `);
    await sleep(2000);

    console.log('Capturing full panoramic overview screenshot...');
    await captureScreenshotToFile(showcasePath);

    ws.close();
    proc.kill();
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
    server.close(() => {
      console.log('Screenshot capture process finished.');
      process.exit(0);
    });
  };

  proc.on('error', (err) => {
    console.error('Browser process error:', err);
    server.close();
    process.exit(1);
  });
});
