/**
 * activeBranch 切换与未提交更改处理（05 §5.2 / U06 / 06 §二 Phase 0 验收 11）。
 * 本轮不引入 Commit DAG：目标分支状态由可注入的 BranchSource 端口提供，
 * Phase 4 可替换为「最近快照 + domain operations 重放」而不改本文件契约。
 * 绝不静默覆盖：检测到未提交更改默认 reject；仅显式 policy=backup 且提供备份出口才继续。
 */
import {
  BranchFileSchema,
  type Actor,
  type BranchFile,
  type DomainState,
  type SavedPresentation,
} from '@workspacetree/schema';
import { computeFileHash, computePresentationHash, computeSemanticHash } from './canonical.js';
import {
  formatRevisionDiff,
  NotFoundError,
  RevisionConflictError,
  UncommittedChangesError,
  ValidationError,
} from './errors.js';
import { migrateToCurrent } from './migration.js';
import { systemClock, type Clock, type StorageAdapter } from './ports.js';
import { validateDomain, validatePresentation } from './validation.js';

export interface BranchSnapshot {
  domain: DomainState;
  presentation: SavedPresentation;
}

/** 目标分支状态来源；Phase 4 换成历史重放实现。 */
export interface BranchSource {
  load(projectId: string, branchName: string): Promise<BranchSnapshot | null>;
}

/** 由 UI / 编辑器注入「内存未提交更改」状态，core 不感知界面。 */
export interface UncommittedChangesSource {
  hasUncommitted(projectId: string): Promise<boolean> | boolean;
}

export interface BranchBackupSink {
  write(projectId: string, branchName: string, file: BranchFile): Promise<void>;
}

export interface SwitchBranchRequest {
  operationId: string;
  projectId: string;
  targetBranch: string;
  expectedRevision: number;
  actor: Actor;
  /** 默认 reject（结构化错误）；backup 需同时提供备份出口。 */
  policy?: 'reject' | 'backup';
}

export interface SwitchBranchOutcome {
  projectId: string;
  fromBranch: string;
  toBranch: string;
  file: BranchFile;
  backupWritten: boolean;
  changed: boolean;
}

export class BranchSwitchService {
  private readonly clock: Clock;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly source: BranchSource,
    private readonly options: {
      uncommitted?: UncommittedChangesSource;
      backup?: BranchBackupSink;
      clock?: Clock;
    } = {},
  ) {
    this.clock = options.clock ?? systemClock;
  }

  async switchActiveBranch(request: SwitchBranchRequest): Promise<SwitchBranchOutcome> {
    for (const key of ['operationId', 'projectId', 'targetBranch'] as const) {
      if (typeof request[key] !== 'string' || request[key].length === 0) {
        throw new ValidationError(`switchActiveBranch.${key} must be a non-empty string`);
      }
    }
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new ValidationError(
        'switchActiveBranch.expectedRevision must be a non-negative integer',
      );
    }

    const loaded = await this.storage.load(request.projectId);
    if (!loaded) throw new NotFoundError(`branch file not found for project ${request.projectId}`);
    const parsed = BranchFileSchema.safeParse(migrateToCurrent(loaded));
    if (!parsed.success) {
      throw new ValidationError('branch file violates schema', parsed.error.issues);
    }
    const file = parsed.data;
    if (file.projectId !== request.projectId) {
      throw new ValidationError('request.projectId does not match branch file');
    }
    if (request.expectedRevision !== file.revisions.semanticRevision) {
      throw new RevisionConflictError(
        'semanticRevision',
        request.expectedRevision,
        file.revisions.semanticRevision,
        formatRevisionDiff(
          'semanticRevision',
          request.expectedRevision,
          file.revisions.semanticRevision,
        ),
      );
    }

    const dirty = this.options.uncommitted
      ? await this.options.uncommitted.hasUncommitted(request.projectId)
      : false;
    if (dirty && request.policy !== 'backup') {
      throw new UncommittedChangesError(
        request.projectId,
        file.activeBranch,
        request.targetBranch,
        {
          at: this.clock.now(),
          actor: request.actor,
          operationId: request.operationId,
        },
      );
    }
    let backupWritten = false;
    if (dirty && request.policy === 'backup') {
      if (!this.options.backup) {
        throw new ValidationError('policy=backup requires a BranchBackupSink');
      }
      await this.options.backup.write(request.projectId, file.activeBranch, file);
      backupWritten = true;
    }

    if (request.targetBranch === file.activeBranch) {
      return {
        projectId: request.projectId,
        fromBranch: file.activeBranch,
        toBranch: file.activeBranch,
        file,
        backupWritten,
        changed: false,
      };
    }

    const target = await this.source.load(request.projectId, request.targetBranch);
    if (!target) {
      throw new NotFoundError(`branch "${request.targetBranch}" has no snapshot to rebuild from`);
    }
    validateDomain(target.domain);
    validatePresentation(target.presentation);

    const semanticHash = computeSemanticHash(target.domain);
    const presentationHash = computePresentationHash(target.presentation);
    const nextFile: BranchFile = {
      ...file,
      activeBranch: request.targetBranch,
      domain: target.domain,
      presentation: target.presentation,
      revisions: {
        semanticRevision: file.revisions.semanticRevision + 1,
        semanticHash,
        presentationRevision: file.revisions.presentationRevision + 1,
        presentationHash,
        fileHash: '',
        fileWriteVersion: file.revisions.fileWriteVersion + 1,
      },
    };
    nextFile.revisions.fileHash = computeFileHash(nextFile);
    await this.storage.save(nextFile);

    return {
      projectId: request.projectId,
      fromBranch: file.activeBranch,
      toBranch: nextFile.activeBranch,
      file: nextFile,
      backupWritten,
      changed: true,
    };
  }
}
