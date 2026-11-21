import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import type { Plugin, UserConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string): string => resolve(root, path);

/**
 * 本地开发服务系统默认工具打开插件：
 * 接收前端传递的本地路径（绝对路径或相对路径），在主机操作系统上以系统默认关联程序直接打开
 * （Windows 下调用 start，macOS 下调用 open，Linux 下调用 xdg-open）。
 * 在部署到 GitHub Pages 等静态环境时，此插件不参与打包，前端静默回退到复制路径。
 */
function openInSystemPlugin(): Plugin {
  return {
    name: 'open-in-system',
    configureServer(server) {
      server.middlewares.use('/__open_in_system', (req, res) => {
        const url = new URL(req.url ?? '', `http://${req.headers.host}`);
        const rawPath = url.searchParams.get('path');
        if (!rawPath) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing path' }));
          return;
        }

        let targetPath = decodeURIComponent(rawPath).replace(/^file:\/\/\/?/, '');
        if (/^[a-zA-Z]:[/\\]/.test(targetPath)) {
          targetPath = targetPath.replace(/\//g, '\\');
        }

        let resolved = targetPath;
        if (!existsSync(resolved)) {
          // 候选路径搜索池（当前项目、已知 ARA 仓、project-heads 登记仓）
          const candidateRoots: string[] = [
            resolve(root, '../..'),
            'E:/05code/01academicProject/10nsbi-projects/52nsbi-cdms',
            'E:/02Documents_database/ObsidianEpool',
          ];

          try {
            const headsFile =
              'E:/02Documents_database/ObsidianEpool/70_Agent/wiki/project_status/project-heads.json';
            if (existsSync(headsFile)) {
              const data = JSON.parse(readFileSync(headsFile, 'utf8'));
              for (const key of Object.keys(data.heads || {})) {
                const r = data.heads[key]?.route?.repo;
                if (r && typeof r === 'string' && !candidateRoots.includes(r)) {
                  candidateRoots.push(r);
                }
              }
            }
          } catch {}

          for (const candRoot of candidateRoots) {
            const full = resolve(candRoot, targetPath);
            if (existsSync(full)) {
              resolved = full;
              break;
            }
          }
        }

        if (existsSync(resolved)) {
          const isWin = process.platform === 'win32';
          const isMac = process.platform === 'darwin';
          const cmd = isWin
            ? `start "" "${resolved}"`
            : isMac
              ? `open "${resolved}"`
              : `xdg-open "${resolved}"`;
          exec(cmd, { shell: isWin ? 'cmd.exe' : undefined }, (err) => {
            if (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: err.message }));
            } else {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, opened: resolved }));
            }
          });
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Path does not exist', path: resolved }));
        }
      });
    },
  };
}

export const sharedConfig = {
  root,
  plugins: [react(), openInSystemPlugin()],
  resolve: {
    alias: [
      // The browser app uses the IndexedDB adapter without loading sql.js or WASM.
      {
        find: /^@workspacetree\/storage$/,
        replacement: fromRoot('../../packages/storage/src/browser/app.ts'),
      },
      { find: /^@workspacetree\/core$/, replacement: fromRoot('../../packages/core/src/index.ts') },
      {
        find: /^@workspacetree\/schema$/,
        replacement: fromRoot('../../packages/schema/src/index.ts'),
      },
      {
        find: /^@workspacetree\/layout$/,
        replacement: fromRoot('../../packages/layout/src/index.ts'),
      },
      {
        find: /^@workspacetree\/export$/,
        replacement: fromRoot('../../packages/export/src/index.ts'),
      },
      {
        find: /^@workspacetree\/markdown$/,
        replacement: fromRoot('../../packages/markdown/src/index.ts'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { allow: [fromRoot('../..')] },
  },
} satisfies UserConfig;
