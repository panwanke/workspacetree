/**
 * @workspacetree/schema — 中性 Zod Schema 唯一出口。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 * Schema 字段保持产品无关。
 */
export * from './common.js';
export * from './entities.js';
export * from './state.js';
export * from './command.js';
export * from './version.js';
