/**
 * 单一 Command Service = 唯一写入口（C6 / Q14 契约 8）。
 * UI / CLI / MCP 共用；批量 ChangeSet 一次校验、一次应用、失败整批回滚。
 * 流程：Envelope 校验 → 幂等 → 双冲突域并发校验 → 纯 reducer → Schema 校验
 *      → 三类哈希 / 修订号 → Storage Adapter 持久化 → 幂等登记。
 * dryRun 在持久化前返回预演结果，不落盘、不产生 Operation / Commit、不登记幂等。
 */
import {
  BranchFileSchema,
  type BranchFile,
  type ChangeSet,
  type CommandEnvelope,
  type Commit,
  type Operation,
  type StateClass,
} from '@workspacetree/schema';
import {
  advanceRevisions,
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
} from './canonical.js';
import {
  describeDomainChange,
  formatRevisionDiff,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
} from './errors.js';
import {
  MemoryIdempotencyCache,
  parseChangeSet,
  parseEnvelope,
  revisionFieldFor,
  type CommandResult,
  type IdempotencyCache,
} from './envelope.js';
import { migrateToCurrent } from './migration.js';
import { systemClock, type Clock, type StorageAdapter } from './ports.js';
import { applyChangeSet, applyCommand, type ReducerResult } from './reducer.js';
import { validateDomain, validatePresentation } from './validation.js';

export interface ExecuteOutcome extends CommandResult {
  operations: Operation[];
  commit: Commit | null;
  dryRun: boolean;
  persisted: boolean;
}

export class CommandService {
  private readonly cache: IdempotencyCache;
  private readonly clock: Clock;

  constructor(
    private readonly storage: StorageAdapter,
    cache: IdempotencyCache = new MemoryIdempotencyCache(),
    clock: Clock = systemClock,
  ) {
    this.cache = cache;
    this.clock = clock;
  }

  async execute(input: unknown): Promise<ExecuteOutcome> {
    const parsed = parseEnvelope(input);
    const replayed = this.cache.get(parsed.operationId);
    if (replayed) {
      return { ...replayed, operations: [], commit: null, dryRun: false, persisted: false };
    }

    const file = await this.loadValidated(parsed.projectId);
    this.assertRevision(file, parsed.stateClass, parsed.expectedRevision);
    const envelope = this.withAudit(parsed);
    const reduced = applyCommand(file.domain, file.presentation, envelope);
    return this.commitOrPreview(
      file,
      envelope.stateClass,
      reduced,
      parsed.operationId,
      parsed.dryRun,
    );
  }

  /** 批量 ChangeSet：一次 load、一次校验、一次 reduce、一次 save；失败不落盘。 */
  async executeBatch(input: unknown): Promise<ExecuteOutcome> {
    const changeSet = parseChangeSet(input);
    const replayed = this.cache.get(changeSet.operationId);
    if (replayed) {
      return { ...replayed, operations: [], commit: null, dryRun: false, persisted: false };
    }

    const file = await this.loadValidated(changeSet.projectId);
    this.assertRevision(file, changeSet.stateClass, changeSet.expectedRevision);
    const reduced = applyChangeSet(file.domain, file.presentation, this.batchEnvelopes(changeSet));
    return this.commitOrPreview(
      file,
      changeSet.stateClass,
      reduced,
      changeSet.operationId,
      changeSet.dryRun,
    );
  }

  /** Persist a gesture that must change both revision domains together. */
  async executeCombined(
    domainInput: unknown,
    presentationInput: unknown,
  ): Promise<ExecuteOutcome & { file: BranchFile }> {
    const domain = parseChangeSet(domainInput);
    const presentation = parseChangeSet(presentationInput);
    if (
      domain.stateClass !== 'domain' ||
      presentation.stateClass !== 'presentation' ||
      domain.projectId !== presentation.projectId ||
      domain.operationId !== presentation.operationId ||
      domain.actor.id !== presentation.actor.id ||
      domain.actor.kind !== presentation.actor.kind ||
      Boolean(domain.dryRun) !== Boolean(presentation.dryRun)
    ) {
      throw new ValidationError('Combined batches must describe one gesture for one project');
    }
    const file = await this.loadValidated(domain.projectId);
    const replayed = this.cache.get(domain.operationId);
    if (replayed) {
      return { ...replayed, operations: [], commit: null, dryRun: false, persisted: false, file };
    }
    this.assertRevision(file, 'domain', domain.expectedRevision);
    this.assertRevision(file, 'presentation', presentation.expectedRevision);
    const envelopes = [...this.batchEnvelopes(domain), ...this.batchEnvelopes(presentation)];
    const reduced = applyChangeSet(file.domain, file.presentation, envelopes);
    return this.commitOrPreview(file, 'domain', reduced, domain.operationId, domain.dryRun, true);
  }

  private batchEnvelopes(changeSet: ChangeSet): CommandEnvelope[] {
    const audit = changeSet.audit ?? {
      at: this.clock.now(),
      source: changeSet.actor.kind,
    };
    return changeSet.commands.map((command) => ({
      operationId: changeSet.operationId,
      projectId: changeSet.projectId,
      stateClass: changeSet.stateClass,
      expectedRevision: changeSet.expectedRevision,
      actor: changeSet.actor,
      command,
      dryRun: changeSet.dryRun,
      audit,
    }));
  }

  private withAudit(envelope: CommandEnvelope): CommandEnvelope {
    if (envelope.audit) return envelope;
    return {
      ...envelope,
      audit: { at: this.clock.now(), source: envelope.actor.kind },
    };
  }

  private async loadValidated(projectId: string): Promise<BranchFile> {
    const loaded = await this.storage.load(projectId);
    if (!loaded) {
      throw new NotFoundError(`branch file not found for project ${projectId}`);
    }
    const parsed = BranchFileSchema.safeParse(migrateToCurrent(loaded));
    if (!parsed.success) {
      throw new ValidationError('branch file violates schema', parsed.error.issues);
    }
    if (parsed.data.projectId !== projectId) {
      throw new ValidationError('envelope.projectId does not match branch file');
    }
    return parsed.data;
  }

  private assertRevision(file: BranchFile, stateClass: StateClass, expected: number): void {
    const field = revisionFieldFor(stateClass);
    const current = file.revisions[field];
    if (expected !== current) {
      throw new RevisionConflictError(
        field,
        expected,
        current,
        formatRevisionDiff(field, expected, current),
      );
    }
  }

  private async commitOrPreview(
    file: BranchFile,
    stateClass: StateClass,
    reduced: ReducerResult,
    operationId: string,
    dryRun: boolean | undefined,
    combined = false,
  ): Promise<ExecuteOutcome & { file: BranchFile }> {
    validateDomain(reduced.domain);
    validatePresentation(reduced.presentation);

    const semanticHash = computeSemanticHash(reduced.domain);
    const presentationHash = computePresentationHash(reduced.presentation);
    const revisions = advanceRevisions(file.revisions, stateClass, semanticHash, presentationHash);
    if (combined) {
      const domainChanged = semanticHash !== computeSemanticHash(file.domain);
      const presentationChanged = presentationHash !== computePresentationHash(file.presentation);
      revisions.semanticRevision = file.revisions.semanticRevision + Number(domainChanged);
      revisions.presentationRevision =
        file.revisions.presentationRevision + Number(presentationChanged);
      if (!domainChanged) reduced.commit = null;
    }
    const nextFile: BranchFile = {
      ...file,
      domain: reduced.domain,
      presentation: reduced.presentation,
      revisions,
    };
    nextFile.revisions.fileHash = computeFileHash(nextFile);
    if (reduced.commit) {
      reduced.commit.semanticRevision = revisions.semanticRevision;
      reduced.commit.semanticHash = semanticHash;
    }

    const field = revisionFieldFor(stateClass);
    const summary: CommandResult = {
      operationId,
      newRevision: revisions[field],
      stateHash: stateClass === 'domain' ? semanticHash : presentationHash,
      stateClass,
      diff: describeDomainChange(file.domain, reduced.domain),
    };

    if (dryRun) {
      return { ...summary, operations: [], commit: null, dryRun: true, persisted: false, file };
    }

    try {
      await this.storage.save(nextFile);
    } catch (cause) {
      if (!combined) throw cause;
      // The journal may already have committed the complete gesture before cleanup failed.
      const recovered = await this.storage.load(file.projectId).catch(() => null);
      if (!recovered || computeFileHash(recovered) !== nextFile.revisions.fileHash) throw cause;
    }
    this.cache.set(operationId, summary);
    return {
      ...summary,
      operations: reduced.operations,
      commit: reduced.commit,
      dryRun: false,
      persisted: true,
      file: nextFile,
    };
  }
}
