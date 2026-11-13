/**
 * 受控导入流程（U05 方案 C / ADR-025 / 05 §5.3 / 06 §二 Phase 0 任务 7）。
 * 顺序：当前文件哈希对账 → 外部修改检测 → 编辑态保护 → Schema 校验＋候选哈希对账
 *      → 语义 Diff → 冲突检查 / 高风险人工确认 → 登记 external-import Operation
 *      → 按写入协议一次落盘。
 * 本实现由显式请求驱动，不注册任何文件监控器，避免「外部写入 → 导入 → 再写入」的无限循环。
 * 绝不绕过 Command Service 语义：导入自身即一条 import.* 域命令，审计随 Operation 持久化。
 */
import {
  BranchFileSchema,
  type Actor,
  type BranchFile,
  type Commit,
  type DomainState,
  type Operation,
} from '@workspacetree/schema';
import { computeFileHash, computePresentationHash, computeSemanticHash } from './canonical.js';
import {
  describeDomainChange,
  ExternalChangeError,
  formatRevisionDiff,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
} from './errors.js';
import { newCommitId } from './ids.js';
import { migrateToCurrent } from './migration.js';
import { systemClock, type Clock, type StorageAdapter } from './ports.js';
import { validateDomain, validatePresentation } from './validation.js';

/** 05 §5.3 步骤 3：三类哈希必须与内容自洽，否则文件不可作为合并基准 / 导入候选。 */
function assertHashIntegrity(file: BranchFile, label: string): void {
  const expected = {
    semanticHash: computeSemanticHash(file.domain),
    presentationHash: computePresentationHash(file.presentation),
    fileHash: computeFileHash(file),
  };
  const actual = {
    semanticHash: file.revisions.semanticHash,
    presentationHash: file.revisions.presentationHash,
    fileHash: file.revisions.fileHash,
  };
  if (
    expected.semanticHash !== actual.semanticHash ||
    expected.presentationHash !== actual.presentationHash ||
    expected.fileHash !== actual.fileHash
  ) {
    throw new ValidationError(`${label} hash mismatch: recorded hashes do not match content`, {
      label,
      expected,
      actual,
      hint: 'recompute all three hashes before importing; the file was preserved unchanged',
    });
  }
}

/** 05 §5.3「变更风险分级」：删除类变更与归档决策属高风险，必须人工确认。 */
function highRiskReasons(before: DomainState, after: DomainState): string[] {
  const reasons: string[] = [];
  const ids = <T extends { id: string }>(items: T[]): Set<string> =>
    new Set(items.map((item) => item.id));
  const removed = (label: string, was: Set<string>, now: Set<string>): void => {
    const count = [...was].filter((id) => !now.has(id)).length;
    if (count > 0) reasons.push(`${label} removed: ${count}`);
  };
  removed('nodes', ids(before.nodes), ids(after.nodes));
  removed('edges', ids(before.edges), ids(after.edges));
  removed('tasks', ids(before.tasks), ids(after.tasks));
  removed('spines', ids(before.spines), ids(after.spines));
  if (!before.archived && after.archived) reasons.push('project archived');
  return reasons;
}

export interface ControlledImportRequest {
  operationId: string;
  projectId: string;
  /** 调用方观察到的落盘基准；用于外部修改检测。 */
  baseFileHash: string;
  /** 外部 .branch.json 的解析结果（未信任输入）。 */
  candidate: unknown;
  expectedRevision: number;
  /** 应用存在内存未保存内容时必须为 true，此时拒绝导入并保留两侧。 */
  hasInMemoryEdits?: boolean;
  /** 高风险导入（删除 / 归档）的人工确认人标识；对应 05 §六 import_batches.reviewed_by。 */
  reviewedBy?: string;
  actor?: Actor;
}

export interface ControlledImportOutcome {
  operation: Operation;
  commit: Commit;
  diff: string;
  file: BranchFile;
}

export class ControlledImportService {
  private readonly clock: Clock;

  constructor(
    private readonly storage: StorageAdapter,
    clock: Clock = systemClock,
  ) {
    this.clock = clock;
  }

  async execute(request: ControlledImportRequest): Promise<ControlledImportOutcome> {
    if (typeof request.operationId !== 'string' || request.operationId.length === 0) {
      throw new ValidationError('import.operationId must be a non-empty string');
    }
    if (typeof request.baseFileHash !== 'string' || request.baseFileHash.length === 0) {
      throw new ValidationError('import.baseFileHash must be a non-empty string');
    }

    const loaded = await this.storage.load(request.projectId);
    if (!loaded) throw new NotFoundError(`branch file not found for project ${request.projectId}`);

    // 0) 当前落盘文件自身也必须三类哈希自洽：被外部改写的文件不能作为合并基准。
    assertHashIntegrity(loaded, 'on-disk branch file');

    // 1) 外部修改检测：基准必须与「记录的」或「重算的」落盘哈希之一一致。
    const recalculated = computeFileHash(loaded);
    if (
      request.baseFileHash !== loaded.revisions.fileHash &&
      request.baseFileHash !== recalculated
    ) {
      throw new ExternalChangeError('baseFileHash does not match the on-disk branch file', {
        baseFileHash: request.baseFileHash,
        recordedHash: loaded.revisions.fileHash,
        recalculatedHash: recalculated,
      });
    }

    // 2) 编辑态保护：绝不覆盖应用内未保存内容。
    if (request.hasInMemoryEdits === true) {
      throw new ExternalChangeError('in-memory edits present; external change was not applied', {
        projectId: request.projectId,
        recordedHash: loaded.revisions.fileHash,
      });
    }

    // 3) Schema 校验：非法 JSON / 损坏文件原样保留，校验失败不登记历史。
    const parsed = BranchFileSchema.safeParse(migrateToCurrent(request.candidate));
    if (!parsed.success || typeof request.candidate !== 'object' || request.candidate === null) {
      throw new ValidationError(
        'external branch file violates schema',
        parsed.success ? [] : parsed.error.issues,
      );
    }
    const candidate = parsed.data;
    if (candidate.projectId !== request.projectId) {
      throw new ValidationError('external branch file belongs to a different project');
    }
    // 3b) 候选文件三类哈希对账：伪造 / 未重算的 semanticHash、presentationHash、fileHash 一律拒绝。
    assertHashIntegrity(candidate, 'external branch file');

    // 4) 语义 Diff（只反映领域变化，不显示纯缩放 / 坐标变化）。
    const diff = describeDomainChange(loaded.domain, candidate.domain);

    // 5) 冲突检查：并发修订号、活动分支、倒退文件。
    if (request.expectedRevision !== loaded.revisions.semanticRevision) {
      throw new RevisionConflictError(
        'semanticRevision',
        request.expectedRevision,
        loaded.revisions.semanticRevision,
        formatRevisionDiff(
          'semanticRevision',
          request.expectedRevision,
          loaded.revisions.semanticRevision,
        ),
      );
    }
    if (candidate.activeBranch !== loaded.activeBranch) {
      throw new ExternalChangeError('external file targets a different activeBranch', {
        current: loaded.activeBranch,
        external: candidate.activeBranch,
      });
    }
    if (candidate.revisions.semanticRevision < loaded.revisions.semanticRevision) {
      throw new ExternalChangeError('external file is behind the current state', {
        currentRevision: loaded.revisions.semanticRevision,
        externalRevision: candidate.revisions.semanticRevision,
      });
    }
    validateDomain(candidate.domain);
    validatePresentation(candidate.presentation);

    // 5b) 高风险变更（删除 / 归档）必须人工确认，绝不自动覆盖（05 §5.3 风险分级）。
    const risks = highRiskReasons(loaded.domain, candidate.domain);
    const reviewedBy = request.reviewedBy?.trim();
    if (risks.length > 0 && !reviewedBy) {
      throw new ValidationError('high-risk import requires reviewedBy (manual confirmation)', {
        risks,
        diff,
        hint: 'review the semantic Diff, then resubmit with reviewedBy = <reviewer id>',
      });
    }

    // 6) 登记 external-import Operation 与语义 Commit。
    const actor: Actor = request.actor ?? { kind: 'external-import', id: 'filesystem' };
    if (actor.kind !== 'external-import') {
      throw new ValidationError('import.* requires actor.kind = external-import');
    }
    const at = this.clock.now();
    const semanticHash = computeSemanticHash(candidate.domain);
    const presentationHash = computePresentationHash(candidate.presentation);
    const operation: Operation = {
      operationId: request.operationId,
      type: 'import.externalChange',
      stateClass: 'domain',
      payload: { baseFileHash: request.baseFileHash, diff },
      actor,
      audit: {
        at,
        source: 'external-import',
        baseFileHash: request.baseFileHash,
        reason: reviewedBy ? `controlled import; reviewedBy=${reviewedBy}` : 'controlled import',
      },
    };
    const commit: Commit = {
      id: newCommitId(),
      parentId: null,
      operationIds: [request.operationId],
      semanticRevision: loaded.revisions.semanticRevision + 1,
      semanticHash,
    };

    // 7) 一次落盘，三类哈希与修订号重算（不静默丢字段）。
    const nextFile: BranchFile = {
      ...candidate,
      revisions: {
        semanticRevision: commit.semanticRevision,
        semanticHash,
        presentationRevision: loaded.revisions.presentationRevision + 1,
        presentationHash,
        fileHash: '',
        fileWriteVersion: loaded.revisions.fileWriteVersion + 1,
      },
    };
    nextFile.revisions.fileHash = computeFileHash(nextFile);
    await this.storage.save(nextFile);

    return { operation, commit, diff, file: nextFile };
  }
}
