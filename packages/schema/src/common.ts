/**
 * 契约常量与中性枚举。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 * 本文件不得出现产品名字段：产品名只允许出现在 UI / 文档 / 包名（Q16 / C9）。
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 3;

export const ID_PREFIX = {
  project: 'prj_',
  node: 'n_',
  edge: 'e_',
  task: 'tsk_',
  spine: 'spn_',
  operation: 'op_',
  commit: 'cmt_',
  block: 'blk_',
} as const;

export const MIN_DISPLAY_SCALE = 0.1;
export const MAX_DISPLAY_SCALE = 2;
export const MIN_NODE_SCALE = 0.35;
export const MAX_NODE_SCALE = 2;

export const ScaleSchema = z.number().min(MIN_DISPLAY_SCALE).max(MAX_DISPLAY_SCALE);
export const NodeScaleSchema = z.number().min(MIN_NODE_SCALE).max(MAX_NODE_SCALE);
export const EdgeTypeSchema = z.enum(['hierarchy', 'dependency', 'reference', 'custom']);
export const EdgeLineStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
export const EdgeArrowSchema = z.enum(['none', 'start', 'end', 'both']);
export const MIN_EDGE_WIDTH = 0.5;
export const MAX_EDGE_WIDTH = 12;
export const EdgeWidthSchema = z.number().min(MIN_EDGE_WIDTH).max(MAX_EDGE_WIDTH);
export const ActorKindSchema = z.enum(['human', 'agent', 'external-import']);
export const StateClassSchema = z.enum(['domain', 'presentation']);
export const ProjectRefModeSchema = z.enum(['link', 'preview', 'inline']);
export const BlockKindSchema = z.enum([
  'text',
  'checklist',
  'table',
  'image',
  'code',
  'attachment',
  'tag',
]);

export const FILE_SUFFIX = {
  project: '.branch.json',
  pack: '.branchpack',
} as const;

export const ERROR_CODE = {
  VALIDATION: 'VALIDATION_ERROR',
  INVALID_GRAPH: 'INVALID_GRAPH_ERROR',
  SCHEMA_MIGRATION: 'SCHEMA_MIGRATION_ERROR',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION_ERROR',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  STORAGE: 'STORAGE_ERROR',
  UNCOMMITTED_CHANGES: 'UNCOMMITTED_CHANGES',
  EXTERNAL_CHANGE: 'EXTERNAL_CHANGE_CONFLICT',
} as const;

/** 05 §九 冻结的 9 个命令域 + U05 受控导入域 import.*（06 §二 Phase 0 任务 7）。 */
export const COMMAND_DOMAINS = [
  'project',
  'node',
  'task',
  'edge',
  'spine',
  'branch',
  'presentation',
  'history',
  'workspace',
  'import',
] as const;

export const COMMAND_TYPE_PATTERN =
  /^(project|node|task|edge|spine|branch|presentation|history|workspace|import)\.[a-z][A-Za-z0-9]*$/;

export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type EdgeLineStyle = z.infer<typeof EdgeLineStyleSchema>;
export type EdgeArrow = z.infer<typeof EdgeArrowSchema>;
export type ActorKind = z.infer<typeof ActorKindSchema>;
export type StateClass = z.infer<typeof StateClassSchema>;
