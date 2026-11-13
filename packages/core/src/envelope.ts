/**
 * Command Envelope 校验、命令域、双冲突域映射与 operationId 幂等缓存（契约 3 / 4 / 5）。
 * 所有写路径必须经此 Envelope；无绕过入口（C6）。
 */
import {
  COMMAND_TYPE_PATTERN,
  ChangeSetSchema,
  CommandEnvelopeSchema,
  type ChangeSet,
  type CommandEnvelope,
  type StateClass,
} from '@workspacetree/schema';
import { ValidationError } from './errors.js';

export interface CommandResult {
  operationId: string;
  newRevision: number;
  stateHash: string;
  stateClass: StateClass;
  diff: string;
}

export interface IdempotencyCache {
  get(operationId: string): CommandResult | undefined;
  set(operationId: string, result: CommandResult): void;
}

export class MemoryIdempotencyCache implements IdempotencyCache {
  private readonly entries = new Map<string, CommandResult>();

  get(operationId: string): CommandResult | undefined {
    return this.entries.get(operationId);
  }

  set(operationId: string, result: CommandResult): void {
    this.entries.set(operationId, result);
  }
}

export function parseEnvelope(input: unknown): CommandEnvelope {
  const parsed = CommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Invalid Command Envelope', parsed.error.issues);
  }
  if (!COMMAND_TYPE_PATTERN.test(parsed.data.command.type)) {
    throw new ValidationError(`Unknown command domain: ${parsed.data.command.type}`);
  }
  return parsed.data;
}

/** 05 §九：stateClass 决定比对哪个修订号，两类冲突域互不阻塞。 */
export function revisionFieldFor(
  stateClass: StateClass,
): 'semanticRevision' | 'presentationRevision' {
  return stateClass === 'domain' ? 'semanticRevision' : 'presentationRevision';
}

/** 批量 ChangeSet 与单命令 Envelope 共用同一命令域校验。 */
export function parseChangeSet(input: unknown): ChangeSet {
  const parsed = ChangeSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Invalid ChangeSet', parsed.error.issues);
  }
  for (const command of parsed.data.commands) {
    if (!COMMAND_TYPE_PATTERN.test(command.type)) {
      throw new ValidationError(`Unknown command domain: ${command.type}`);
    }
  }
  return parsed.data;
}
