/**
 * 领域实体 Schema（11 个契约 Schema 中的 5 个：Project / Node / Edge / Task / Spine）。
 * 字段保持产品无关。
 */
import { z } from 'zod';
import { BlockKindSchema, EdgeTypeSchema, ProjectRefModeSchema } from './common.js';

export const ProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  rootNodeId: z.string().min(1),
});

export const BlockSchema = z.object({
  id: z.string().min(1),
  kind: BlockKindSchema,
  /** 编辑器无关的领域载荷；Tiptap 仅为富文本适配器（C11 / ADR-015）。 */
  payload: z.unknown(),
});

export const StartAtSchema = z.iso.date();
export const TAG_NAME_PATTERN = '[\\p{L}\\p{N}\\p{M}_-]+';
export const TagSchema = z.string().regex(new RegExp('^' + TAG_NAME_PATTERN + '(?![\\s\\S])', 'u'));
export const TagsSchema = z.array(TagSchema);

export const HierarchyEdgeRoleSchema = z.enum(['continuation', 'leaf', 'branch']);

export const NodeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  parentId: z.string().min(1).nullable(),
  blockIds: z.array(z.string().min(1)),
  archived: z.boolean(),
  startAt: StartAtSchema.nullish(),
  tags: TagsSchema.optional(),
});

export const EdgeSchema = z.object({
  id: z.string().min(1),
  type: EdgeTypeSchema,
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  role: HierarchyEdgeRoleSchema.optional(),
  note: z
    .string()
    .regex(/^[^\r\n]*(?![\s\S])/)
    .optional(),
});

export const TaskStatusSchema = z.enum(['pending', 'discarded', 'paused']);

export const TaskSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1).nullable(),
  title: z.string(),
  done: z.boolean(),
  tags: TagsSchema.optional(),
  scheduledAt: StartAtSchema.optional(),
  completedAt: StartAtSchema.optional(),
  status: TaskStatusSchema.optional(),
});

/** Spine = 由连续有效层级边组成的有序路径；多条 Spine 可共享前缀。 */
export const SpineSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  nodeIds: z.array(z.string().min(1)),
});

export const ProjectRefSchema = z.object({
  projectId: z.string().min(1),
  mode: ProjectRefModeSchema,
  hostNodeId: z.string().min(1).nullable(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type HierarchyEdgeRole = z.infer<typeof HierarchyEdgeRoleSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Spine = z.infer<typeof SpineSchema>;
export type ProjectRef = z.infer<typeof ProjectRefSchema>;
