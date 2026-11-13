/**
 * Command / Operation / Commit 与 Command Envelope（05 §九）。
 * 单一 Command Service 是唯一写入口；所有写路径都经此 Envelope（C6 / C17）。
 * U05 / U06 追加契约：actor.kind 三值与 audit、dryRun、批量 ChangeSet、
 * import.* 受控导入域（06 §二 Phase 0 任务 7、验收 15/16）。
 */
import { z } from 'zod';
import { ActorKindSchema, COMMAND_TYPE_PATTERN, StateClassSchema } from './common.js';

export const ActorSchema = z.object({
  kind: ActorKindSchema,
  id: z.string().min(1),
});

/**
 * 审计字段随 Operation 持久化，用于区分 human / agent / external-import 三类来源。
 * 字段保持中性，不引入治理元数据（Q02 / C20）。
 */
export const AuditSchema = z.object({
  at: z.string().min(1),
  source: z.string().min(1).optional(),
  baseFileHash: z.string().optional(),
  reason: z.string().optional(),
});

export const CommandSchema = z.object({
  type: z.string().regex(COMMAND_TYPE_PATTERN),
  payload: z.unknown(),
});

const EnvelopeBase = {
  operationId: z.string().min(1),
  projectId: z.string().min(1),
  stateClass: StateClassSchema,
  expectedRevision: z.number().int().nonnegative(),
  actor: ActorSchema,
} as const;

export const CommandEnvelopeSchema = z.object({
  ...EnvelopeBase,
  command: CommandSchema,
  /** dryRun: true 不落盘、不产生 Operation / Commit、不登记幂等。 */
  dryRun: z.boolean().optional(),
  audit: AuditSchema.optional(),
});

/** 批量 ChangeSet：一次校验、一次应用、一次落盘、失败整批回滚。 */
export const ChangeSetSchema = z.object({
  ...EnvelopeBase,
  commands: z.array(CommandSchema).min(1),
  dryRun: z.boolean().optional(),
  audit: AuditSchema.optional(),
});

export const OperationSchema = z.object({
  operationId: z.string().min(1),
  type: z.string(),
  /** 只有 state_class = domain 的 operations 参与语义重放（05 §8.3 不变量 A）。 */
  stateClass: StateClassSchema,
  payload: z.unknown(),
  actor: ActorSchema,
  audit: AuditSchema.nullable(),
});

export const CommitSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  operationIds: z.array(z.string()),
  semanticRevision: z.number().int().nonnegative(),
  semanticHash: z.string(),
});

export type Actor = z.infer<typeof ActorSchema>;
export type Audit = z.infer<typeof AuditSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Commit = z.infer<typeof CommitSchema>;
