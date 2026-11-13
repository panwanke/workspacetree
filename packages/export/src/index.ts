/**
 * @workspacetree/export — Phase 1 SVG 导出。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 * 纯 TS：与画布共用 layout 几何，不依赖 React / DOM / Node API；PNG / HTML / 项目包属后续阶段。
 */
export const EXPORT_TARGET_PHASE = 1;

export type ExportScope = 'current-view' | 'full-structure';

export * from './svg.js';
