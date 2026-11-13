/**
 * @workspacetree/storage — Storage Adapter 实现集合。
 * memory / file 为最小实现；AtomicWriteAdapter 与 SqliteStorageAdapter 实现
 * 05 §七 可恢复写入协议，供 U06 六类场景实测；浏览器 WASM 实现见 ./browser。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
export * from './memory-adapter.js';
export * from './file-adapter.js';
export * from './write-protocol.js';
export * from './sqlite-adapter.js';
export * from './browser/idb-json-adapter.js';
export type { RuntimeInfo, ScenarioKey, ScenarioResult, SpikeAdapter } from './spike-contract.js';
