import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (p: string): string => resolve(root, p);

export default defineConfig({
  resolve: {
    alias: {
      '@workspacetree/schema': fromRoot('packages/schema/src/index.ts'),
      '@workspacetree/core': fromRoot('packages/core/src/index.ts'),
      '@workspacetree/layout': fromRoot('packages/layout/src/index.ts'),
      '@workspacetree/storage': fromRoot('packages/storage/src/index.ts'),
      '@workspacetree/export': fromRoot('packages/export/src/index.ts'),
      '@workspacetree/cli': fromRoot('packages/cli/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
