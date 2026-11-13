/**
 * Phase 1 主应用的浏览器存储子出口。
 * 刻意不 re-export WASM SQLite 尖刺实现，避免把 sql.js / WASM 打进主应用首屏。
 * U06 六类实测通过 probe.ts 加载本出口（browser-idb-json，与主应用同一工厂）
 * 以及 wasm-adapter.ts 的相对路径（browser-wasm-sqlite-idb），二者互不干扰。
 */
export * from './idb-json-adapter.js';
