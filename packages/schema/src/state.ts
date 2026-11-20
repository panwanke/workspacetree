/**
 * 三层状态模型（ADR-013）与 .branch.json 文件容器（05 §八）。
 * 归档 archived 属 DomainState，缩放 scale 属 SavedPresentation，二者不自动联动（C8）。
 */
import { z } from 'zod';
import {
  EdgeArrowSchema,
  EdgeLineStyleSchema,
  EdgeWidthSchema,
  NodeScaleSchema,
  ScaleSchema,
} from './common.js';
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

export const AssetRecordSchema = z.object({
  mime: z.string(),
  byteLength: z.number().int().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  base64: z.string(),
});

export const DomainStateSchema = z.object({
  project: ProjectSchema,
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  tasks: z.array(TaskSchema),
  spines: z.array(SpineSchema),
  blocks: z.array(BlockSchema),
  projectRefs: z.array(ProjectRefSchema),
  assets: z.record(z.string(), AssetRecordSchema).optional(),
  archived: z.boolean(),
  archiveMeta: ArchiveMetaSchema.nullable(),
});

export const LayoutDirectionSchema = z.enum(['horizontal', 'vertical']);

export const NodeSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const EdgeStyleSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  width: EdgeWidthSchema.optional(),
  lineStyle: EdgeLineStyleSchema.optional(),
  arrow: EdgeArrowSchema.optional(),
});

export const GrowthAlgorithmSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('linear'),
    step: z.number().default(0.1),
    minRatio: z.number().default(0.55),
  }),
  z.object({
    type: z.literal('exponential'),
    ratio: z.number().default(0.9),
    minRatio: z.number().default(0.55),
  }),
  z.object({
    type: z.literal('asymptotic'),
    decay: z.number().default(0.25),
    minRatio: z.number().default(0.55),
  }),
]);

export const TopologyGrowthSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  massDecay: z.number().default(0.75),
  strength: z.number().default(0.12),
  localMin: z.number().default(0.92),
  localMax: z.number().default(1.08),
  lineageMemory: z.number().default(0.70),
  lineageMin: z.number().default(0.88),
  lineageMax: z.number().default(1.12),
});

export const ProjectGrowthSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  algorithm: GrowthAlgorithmSchema.default({
    type: 'asymptotic',
    decay: 0.25,
    minRatio: 0.55,
  }),
  topology: TopologyGrowthSettingsSchema.default({
    enabled: true,
    massDecay: 0.75,
    strength: 0.12,
    localMin: 0.92,
    localMax: 1.08,
    lineageMemory: 0.70,
    lineageMin: 0.88,
    lineageMax: 1.12,
  }),
});

export const ScaleSettingsSchema = z.object({
  defaultChildMode: z.enum(['layout', 'visual', 'both']).default('layout'),
  childLayoutStep: z.number().default(-0.1),
  childVisualRatio: z.number().positive().default(0.9),
  minLayoutScale: z.number().positive().default(0.6),
  maxLayoutScale: z.number().positive().default(2.0),
  minVisualScale: z.number().positive().default(0.4),
  maxVisualScale: z.number().positive().default(2.0),
  growth: ProjectGrowthSettingsSchema.optional(),
});

export const DEFAULT_SCALE_SETTINGS: z.infer<typeof ScaleSettingsSchema> = {
  defaultChildMode: 'layout',
  childLayoutStep: -0.1,
  childVisualRatio: 0.9,
  minLayoutScale: 0.6,
  maxLayoutScale: 2.0,
  minVisualScale: 0.4,
  maxVisualScale: 2.0,
  growth: {
    enabled: false,
    algorithm: {
      type: 'asymptotic',
      decay: 0.25,
      minRatio: 0.55,
    },
    topology: {
      enabled: true,
      massDecay: 0.75,
      strength: 0.12,
      localMin: 0.92,
      localMax: 1.08,
      lineageMemory: 0.70,
      lineageMin: 0.88,
      lineageMax: 1.12,
    },
  },
};

export const SavedPresentationSchema = z.object({
  nodePositions: z.record(z.string(), PositionSchema),
  verticalNodePositions: z.record(z.string(), PositionSchema).nullish(),
  branchScales: z.record(z.string(), ScaleSchema),
  branchVisualScales: z.record(z.string(), ScaleSchema).optional(),
  branchScaleCompensation: z.record(z.string(), z.number().positive()).optional(),
  nodeScales: z.record(z.string(), NodeScaleSchema).nullish(),
  nodeVisualScales: z.record(z.string(), NodeScaleSchema).nullish(),
  nodeSizes: z.record(z.string(), NodeSizeSchema).nullish(),
  edgeStyles: z.record(z.string(), EdgeStyleSchema).optional(),
  scaleSettings: ScaleSettingsSchema.optional(),
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

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type DomainState = z.infer<typeof DomainStateSchema>;
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;
export type GrowthAlgorithm = z.infer<typeof GrowthAlgorithmSchema>;
export type TopologyGrowthSettings = z.infer<typeof TopologyGrowthSettingsSchema>;
export type ProjectGrowthSettings = z.infer<typeof ProjectGrowthSettingsSchema>;
export type ScaleSettings = z.infer<typeof ScaleSettingsSchema>;
export type SavedPresentation = z.infer<typeof SavedPresentationSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export type Revisions = z.infer<typeof RevisionsSchema>;
export type BranchFile = z.infer<typeof BranchFileSchema>;
