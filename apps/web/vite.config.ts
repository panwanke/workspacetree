import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (p: string): string => resolve(root, p);
const workspaceRoot = fromRoot('../..');

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: [
      // 主应用只需要轻量 IndexedDB JSON 适配器，不加载 sql.js / WASM。
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
    fs: { allow: [workspaceRoot] },
  },
});
