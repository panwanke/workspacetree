import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, normalizePath, type Plugin } from 'vite';
import { sharedConfig } from './vite.shared.js';

const cloudPath = normalizePath(fileURLToPath(new URL('./src/cloud/', import.meta.url)));
const sdkPackage = '@tencent-ai/workbuddy-cloud-sdk';

function forbidCloudDependencies(): Plugin {
  return {
    name: 'workspacetree-static-no-cloud',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === sdkPackage || source.startsWith(`${sdkPackage}/`)) {
        this.error(`Static Pages cannot import ${source} from ${importer ?? 'an entry point'}.`);
      }
    },
    load(id) {
      const path = normalizePath(id);
      if (path.startsWith(cloudPath) || path.includes(`/node_modules/${sdkPackage}/`)) {
        this.error(`Static Pages cannot load ${id}.`);
      }
    },
  };
}

export default defineConfig(
  mergeConfig(sharedConfig, {
    base: process.env.VITE_BASE_PATH || '/workspacetree/',
    root: fileURLToPath(new URL('./static/', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
    plugins: [forbidCloudDependencies()],
    worker: { plugins: () => [forbidCloudDependencies()] },
    build: {
      outDir: fileURLToPath(new URL('./dist-static/', import.meta.url)),
      emptyOutDir: true,
    },
  }),
);
