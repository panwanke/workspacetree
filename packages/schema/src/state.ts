/**
 * 三层状态模型（ADR-013）与 .branch.json 文件容器（05 §八）。
 * 归档 archived 属 DomainState，缩放 scale 属 SavedPresentation，二者不自动联动（C8）。
 */
import { z } from 'zod';
import { NodeScaleSchema, ScaleSchema } from './common.js';
import {
  BlockSchema,
  EdgeSchema,
  NodeSchema,
  ProjectRefSchema,
  ProjectSchema,
  SpineSchema,
  TaskSchema,
} from './entities.js';

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const ArchiveMetaSchema = z.object({
  reason: z.string(),
  at: z.string(),
  replacementBranchId: z.string().nullable(),
});

export const DomainStateSchema = z.object({
  project: ProjectSchema,
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  tasks: z.array(TaskSchema),
  spines: z.array(SpineSchema),
  blocks: z.array(BlockSchema),
  projectRefs: z.array(ProjectRefSchema),
  archived: z.boolean(),
  archiveMeta: ArchiveMetaSchema.nullable(),
});

export const LayoutDirectionSchema = z.enum(['horizontal', 'vertical']);

export const NodeSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const SavedPresentationSchema = z.object({
  nodePositions: z.record(z.string(), PositionSchema),
  verticalNodePositions: z.record(z.string(), PositionSchema).nullish(),
  branchScales: z.record(z.string(), ScaleSchema),
  branchScaleCompensation: z.record(z.string(), z.number().positive()).optional(),
  nodeScales: z.record(z.string(), NodeScaleSchema).nullish(),
  nodeSizes: z.record(z.string(), NodeSizeSchema).nullish(),
  collapsedByDefault: z.array(z.string()),
  savedSpineDisplay: z.string().nullable(),
  layoutDirection: LayoutDirectionSchema.nullish(),
});

export const SessionViewSchema = z.object({
  pan: PositionSchema,
  zoom: z.number().positive(),
  selection: z.array(z.string()),
  highlightSpineId: z.string().nullable(),
});

export const RevisionsSchema = z.object({
  semanticRevision: z.number().int().nonnegative(),
  semanticHash: z.string(),
  presentationRevision: z.number().int().nonnegative(),
  presentationHash: z.string(),
  fileHash: z.string(),
  fileWriteVersion: z.number().int().nonnegative(),
});

export const BranchFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  projectId: z.string().min(1),
  activeBranch: z.string().min(1),
  domain: DomainStateSchema,
  presentation: SavedPresentationSchema,
  revisions: RevisionsSchema,
});

export type DomainState = z.infer<typeof DomainStateSchema>;
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;
export type SavedPresentation = z.infer<typeof SavedPresentationSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export type Revisions = z.infer<typeof RevisionsSchema>;
export type BranchFile = z.infer<typeof BranchFileSchema>;
