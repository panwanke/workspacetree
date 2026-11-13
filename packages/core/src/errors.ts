/**
 * 结构化错误类型与可读 Diff（契约 7；05 §九 REVISION_CONFLICT）。
 * 所有错误带稳定 code，便于 CLI / Agent 判定，不依赖异常消息文本。
 */
import { ERROR_CODE } from '@workspacetree/schema';
import type { DomainState } from '@workspacetree/schema';

export class ContractError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(name: string, code: string, message: string, details?: unknown) {
    super(message);
    this.name = name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('ValidationError', ERROR_CODE.VALIDATION, message, details);
  }
}

export class InvalidGraphError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('InvalidGraphError', ERROR_CODE.INVALID_GRAPH, message, details);
  }
}

export class SchemaMigrationError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('SchemaMigrationError', ERROR_CODE.SCHEMA_MIGRATION, message, details);
  }
}

export class DuplicateOperationError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('DuplicateOperationError', ERROR_CODE.DUPLICATE_OPERATION, message, details);
  }
}

export class RevisionConflictError extends ContractError {
  readonly domain: 'semanticRevision' | 'presentationRevision';
  readonly expected: number;
  readonly current: number;
  readonly diff: string;

  constructor(
    domain: 'semanticRevision' | 'presentationRevision',
    expected: number,
    current: number,
    diff: string,
  ) {
    super(
      'RevisionConflictError',
      ERROR_CODE.REVISION_CONFLICT,
      `${domain} conflict: expected ${expected}, current ${current}`,
      { domain, expected, current, diff },
    );
    this.domain = domain;
    this.expected = expected;
    this.current = current;
    this.diff = diff;
  }
}

export class NotFoundError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('NotFoundError', ERROR_CODE.NOT_FOUND, message, details);
  }
}

export class StorageError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('StorageError', ERROR_CODE.STORAGE, message, details);
  }
}

/** activeBranch 切换时存在未提交更改：绝不静默覆盖（05 §5.2 / U06）。 */
export class UncommittedChangesError extends ContractError {
  constructor(projectId: string, currentBranch: string, targetBranch: string, details?: unknown) {
    super(
      'UncommittedChangesError',
      ERROR_CODE.UNCOMMITTED_CHANGES,
      `cannot switch ${projectId} from "${currentBranch}" to "${targetBranch}": uncommitted changes present`,
      {
        projectId,
        currentBranch,
        targetBranch,
        hint: 'commit or back up the current state before switching; no silent overwrite is allowed',
        ...(typeof details === 'object' && details !== null ? details : {}),
      },
    );
  }
}

/** 受控导入检测到外部修改 / 内存未保存内容：两侧内容均保留并提示冲突（05 §5.3）。 */
export class ExternalChangeError extends ContractError {
  constructor(message: string, details?: unknown) {
    super('ExternalChangeError', ERROR_CODE.EXTERNAL_CHANGE, message, {
      bothSidesPreserved: true,
      ...(typeof details === 'object' && details !== null ? details : {}),
    });
  }
}

/**
 * 按稳定 ID 比较两次 DomainState，产出 Semantic Diff 的可读摘要（05 §5.1 / §5.3 步骤 4）。
 * 覆盖节点、边、任务、主干、Block、项目引用与归档决策；纯呈现变化不在此处出现。
 */
export function describeDomainChange(before: DomainState, after: DomainState): string {
  const lines: string[] = [];
  const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
    new Map(items.map((item) => [item.id, item]));

  const beforeNodes = byId(before.nodes);
  const afterNodes = byId(after.nodes);
  for (const [id, node] of afterNodes) {
    const old = beforeNodes.get(id);
    if (!old) {
      lines.push(`+ node ${id} "${node.title}"`);
      continue;
    }
    if (old.title !== node.title) lines.push(`~ node ${id} title changed`);
    if (old.parentId !== node.parentId) {
      lines.push(`~ node ${id} parentId ${old.parentId ?? 'null'} -> ${node.parentId ?? 'null'}`);
    }
    if (old.archived !== node.archived) lines.push(`~ node ${id} archived=${node.archived}`);
    if (JSON.stringify(old.tags) !== JSON.stringify(node.tags))
      lines.push('~ node ' + id + ' tags changed');
    if (old.blockIds.join(',') !== node.blockIds.join(',')) {
      lines.push(`~ node ${id} blockIds changed`);
    }
  }
  for (const id of beforeNodes.keys()) {
    if (!afterNodes.has(id)) lines.push(`- node ${id}`);
  }

  const beforeEdges = byId(before.edges);
  const afterEdges = byId(after.edges);
  for (const [id, edge] of afterEdges) {
    const old = beforeEdges.get(id);
    if (!old) {
      lines.push(`+ edge ${id} ${edge.type} ${edge.fromNodeId} -> ${edge.toNodeId}`);
      continue;
    }
    if (
      old.type !== edge.type ||
      old.fromNodeId !== edge.fromNodeId ||
      old.toNodeId !== edge.toNodeId
    ) {
      lines.push(
        `~ edge ${id} ${old.type} ${old.fromNodeId}->${old.toNodeId} => ${edge.type} ${edge.fromNodeId}->${edge.toNodeId}`,
      );
    }
    if (old.note !== edge.note) lines.push(`~ edge ${id} note changed`);
  }
  for (const id of beforeEdges.keys()) {
    if (!afterEdges.has(id)) lines.push(`- edge ${id}`);
  }

  const beforeTasks = byId(before.tasks);
  const afterTasks = byId(after.tasks);
  for (const [id, task] of afterTasks) {
    const old = beforeTasks.get(id);
    if (!old) {
      lines.push(`+ task ${id} "${task.title}"`);
      continue;
    }
    if (old.done !== task.done) lines.push(`~ task ${id} done=${task.done}`);
    if (old.title !== task.title) lines.push(`~ task ${id} title changed`);
    if (old.nodeId !== task.nodeId) lines.push(`~ task ${id} nodeId changed`);
    if (old.scheduledAt !== task.scheduledAt) lines.push(`~ task ${id} scheduledAt changed`);
    if (old.status !== task.status) lines.push(`~ task ${id} status changed`);
    if (JSON.stringify(old.tags) !== JSON.stringify(task.tags))
      lines.push('~ task ' + id + ' tags changed');
  }
  for (const id of beforeTasks.keys()) {
    if (!afterTasks.has(id)) lines.push(`- task ${id}`);
  }

  const beforeSpines = byId(before.spines);
  const afterSpines = byId(after.spines);
  for (const [id, spine] of afterSpines) {
    const old = beforeSpines.get(id);
    if (!old) lines.push(`+ spine ${id} "${spine.title}"`);
    else if (old.title !== spine.title || old.nodeIds.join(',') !== spine.nodeIds.join(',')) {
      lines.push(`~ spine ${id} path changed`);
    }
  }
  for (const id of beforeSpines.keys()) {
    if (!afterSpines.has(id)) lines.push(`- spine ${id}`);
  }

  const beforeBlocks = byId(before.blocks);
  const afterBlocks = byId(after.blocks);
  for (const [id, block] of afterBlocks) {
    const old = beforeBlocks.get(id);
    if (!old) lines.push(`+ block ${id} ${block.kind}`);
    else if (
      old.kind !== block.kind ||
      JSON.stringify(old.payload) !== JSON.stringify(block.payload)
    ) {
      lines.push(`~ block ${id} payload changed`);
    }
  }
  for (const id of beforeBlocks.keys()) {
    if (!afterBlocks.has(id)) lines.push(`- block ${id}`);
  }

  const refKey = (ref: DomainState['projectRefs'][number]): string =>
    `${ref.projectId}@${ref.hostNodeId ?? '-'}`;
  const beforeRefs = new Map(before.projectRefs.map((ref) => [refKey(ref), ref]));
  const afterRefs = new Map(after.projectRefs.map((ref) => [refKey(ref), ref]));
  for (const [key, ref] of afterRefs) {
    const old = beforeRefs.get(key);
    if (!old) lines.push(`+ projectRef ${ref.projectId} ${ref.mode}`);
    else if (old.mode !== ref.mode) lines.push(`~ projectRef ${ref.projectId} mode=${ref.mode}`);
  }
  for (const key of beforeRefs.keys()) {
    if (!afterRefs.has(key)) lines.push(`- projectRef ${key}`);
  }

  if (before.project.title !== after.project.title) lines.push('~ project title changed');
  if (before.project.rootNodeId !== after.project.rootNodeId)
    lines.push('~ project rootNodeId changed');
  if (before.archived !== after.archived) {
    lines.push(
      `~ project archived=${after.archived}` +
        (after.archiveMeta ? ` reason="${after.archiveMeta.reason}"` : ''),
    );
  } else if (JSON.stringify(before.archiveMeta) !== JSON.stringify(after.archiveMeta)) {
    lines.push('~ project archiveMeta changed');
  }

  return lines.length > 0 ? lines.join('\n') : '(no semantic change)';
}

/** 并发冲突的可读说明，附当前修订号与恢复建议。 */
export function formatRevisionDiff(
  domain: 'semanticRevision' | 'presentationRevision',
  expected: number,
  current: number,
): string {
  return [
    `Conflict on ${domain}`,
    `  expected : ${expected}`,
    `  current  : ${current}`,
    `  hint     : re-read the branch file and resubmit with expectedRevision = ${current}`,
  ].join('\n');
}
