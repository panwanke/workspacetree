import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string): string => resolve(root, path);

export const sharedConfig = {
  root,
  plugins: [react()],
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
