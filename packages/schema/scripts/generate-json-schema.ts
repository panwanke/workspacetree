/**
 * 由 Zod Schema 自动生成聚合 JSON Schema（06 §二 Phase 0 任务 2）。
 * Zod major=4 → 使用官方内置 z.toJSONSchema()，不引入第三方转换库。
 * 运行：pnpm generate:json-schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AuditSchema,
  BranchFileSchema,
  ChangeSetSchema,
  CommandEnvelopeSchema,
  CommandSchema,
  CommitSchema,
  DomainStateSchema,
  EdgeSchema,
  NodeSchema,
  OperationSchema,
  ProjectSchema,
  SavedPresentationSchema,
  SessionViewSchema,
  SpineSchema,
  TaskSchema,
} from '../src/index.js';

type JsonSchemaConverter = (
  schema: z.ZodType,
  options?: { io?: 'input' | 'output' },
) => Record<string, unknown>;

const converter = (z as unknown as { toJSONSchema?: JsonSchemaConverter }).toJSONSchema;
if (!converter) {
  throw new Error('当前 Zod 版本不提供 z.toJSONSchema()；请按官方兼容矩阵确认 Zod major=4。');
}

const contracts: Record<string, z.ZodType> = {
  Project: ProjectSchema,
  Node: NodeSchema,
  Edge: EdgeSchema,
  Task: TaskSchema,
  Spine: SpineSchema,
  DomainState: DomainStateSchema,
  SavedPresentation: SavedPresentationSchema,
  SessionView: SessionViewSchema,
  Command: CommandSchema,
  Operation: OperationSchema,
  Commit: CommitSchema,
  CommandEnvelope: CommandEnvelopeSchema,
  ChangeSet: ChangeSetSchema,
  Audit: AuditSchema,
  BranchFile: BranchFileSchema,
};

const defs: Record<string, unknown> = {};
for (const [name, schema] of Object.entries(contracts)) {
  defs[name] = converter(schema, { io: 'input' });
}

const output = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Phase 0 data contracts (prototype, no production data)',
  $defs: defs,
  $ref: '#/$defs/BranchFile',
};

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../generated/schemas.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Generated ${Object.keys(defs).length} JSON Schemas -> ${target}`);
