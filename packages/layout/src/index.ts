/**
 * @workspacetree/layout — Phase 1 纯函数布局与几何。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 * 纯 TS：不依赖 React 组件、DOM、Node / Electron API 或产品名（06 §一.2、§二 Phase 1 验收 8）。
 * 该包可在无 React 环境下独立调用与测试；画布与 SVG 导出共用同一组几何函数。
 */
export * from './types.js';
export * from './tree.js';
export * from './geometry.js';
export * from './edges.js';
export * from './visual.js';
export * from './roles.js';
