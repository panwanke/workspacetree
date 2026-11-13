/**
 * 浏览器侧 U06 六类场景实测入口（仅开发 / 原型使用）。
 * 在真实浏览器（本机 Chrome headless）中执行与桌面侧完全相同的 runSixScenarios，
 * 覆盖两个浏览器后端：
 *   ① WASM SQLite + IndexedDB（Phase 0 尖刺实现）
 *   ② IndexedDB JSON —— **Phase 1 主应用实际使用的写入路径**（同一 adapter 类与工厂）
 * 结果挂在 window.__PROBE_RESULTS__，供浏览器验证使用。
 */
import { WasmSqliteAdapter } from '../../../packages/storage/src/browser/wasm-adapter';
import { createBrowserStorageAdapter } from '../../../packages/storage/src/browser/app';
import type { RuntimeInfo, SpikeAdapter } from '../../../packages/storage/src/spike-contract';
import {
  runSixScenarios,
  type SpikeHarness,
  type SpikeReport,
} from '../../../tests/storage/scenarios';

declare global {
  interface Window {
    __PROBE_DONE__?: boolean;
    __PROBE_RESULTS__?: SpikeReport[];
    __PROBE_ERROR__?: string;
  }
}

const sharedVersions = {
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  indexedDB: String(typeof indexedDB !== 'undefined'),
  crossOriginIsolated: String(globalThis.crossOriginIsolated ?? false),
  storagePersist: String(typeof navigator.storage?.persist === 'function'),
};

const wasmRuntime: RuntimeInfo = {
  backend: 'browser-wasm-sqlite-idb',
  runtime: navigator.userAgent,
  versions: { ...sharedVersions },
};

const idbJsonRuntime: RuntimeInfo = {
  backend: 'browser-idb-json',
  runtime: navigator.userAgent,
  versions: {
    ...sharedVersions,
    adapter: 'createBrowserStorageAdapter（Phase 1 主应用同构）',
  },
};

const harnesses: SpikeHarness[] = [
  {
    projectId: 'prj_spike_browser',
    runtime: wasmRuntime,
    createAdapter: async (): Promise<SpikeAdapter> =>
      new WasmSqliteAdapter({
        databaseName: 'wst-storage-spike-probe',
        wasmUrl: '/sql-wasm.wasm',
      }),
  },
  {
    projectId: 'prj_spike_phase1_idb',
    runtime: idbJsonRuntime,
    createAdapter: async (): Promise<SpikeAdapter> =>
      createBrowserStorageAdapter('wst-phase1-spike-probe'),
  },
];

const output = document.getElementById('out');

async function runAll(): Promise<SpikeReport[]> {
  const results: SpikeReport[] = [];
  // 串行执行，避免两个后端争用同一浏览器事件循环时互相干扰计时与意图日志。
  for (const harness of harnesses) results.push(await runSixScenarios(harness));
  return results;
}

runAll()
  .then((reports) => {
    window.__PROBE_RESULTS__ = reports;
    if (output) output.textContent = JSON.stringify(reports, null, 2);
  })
  .catch((error: unknown) => {
    window.__PROBE_ERROR__ =
      error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    if (output) output.textContent = window.__PROBE_ERROR__;
  })
  .finally(() => {
    window.__PROBE_DONE__ = true;
  });
