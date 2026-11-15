/**
 * 账号项目仓库：把当前登录账号新建/编辑的项目保存到云端数据库。
 *
 * 隔离由数据库 RLS 负责（owner_id TEXT NOT NULL DEFAULT auth.uid()），
 * 前端绝不发送 owner_id / user id，也不在 JS 里做「这行是不是我的」过滤。
 * 每次读写前都做 auth gate；未登录、表缺失、RLS 拒绝、跨账号写入返回空数组，
 * 一律给出明确错误，不静默当成成功。
 */
import { migrateToCurrent } from '@workspacetree/core';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import { getCloudRuntime } from './client';
import { CLOUD_NOT_CONFIGURED_MESSAGE } from './public-config';
import {
  CloudServiceError,
  describeCloudError,
  type CloudProjectRow,
  type CloudProjectTablePort,
  type CloudSessionLike,
  type ProjectStorePort,
  type StoredProjectSummary,
} from './ports';

export type StorageScope = 'local' | 'account';

export interface CloudProjectStoreOptions {
  projects?: CloudProjectTablePort;
  getSession?: () => Promise<{ data: CloudSessionLike | null; error: { message: string } | null }>;
}

function summaryOf(
  file: BranchFile,
): Pick<CloudProjectRow, 'title' | 'active_branch' | 'node_count'> {
  return {
    title: file.domain.project.title || file.projectId,
    active_branch: file.activeBranch || 'main',
    node_count: Array.isArray(file.domain.nodes) ? file.domain.nodes.length : 0,
  };
}

function toRow(file: BranchFile): CloudProjectRow {
  return {
    project_id: file.projectId,
    ...summaryOf(file),
    payload: file,
    updated_at: new Date().toISOString(),
  };
}

function parseFile(payload: unknown): BranchFile | null {
  if (!payload) return null;
  try {
    return BranchFileSchema.parse(migrateToCurrent(payload));
  } catch (cause) {
    throw new CloudServiceError(
      `云端项目数据校验失败：${cause instanceof Error ? cause.message : String(cause)}`,
      'unknown',
    );
  }
}

export class CloudProjectStore implements ProjectStorePort {
  private readonly projects: CloudProjectTablePort | null;
  private readonly sessionReader: NonNullable<CloudProjectStoreOptions['getSession']> | null;

  constructor(options: CloudProjectStoreOptions = {}) {
    const runtime = getCloudRuntime();
    this.projects = options.projects ?? runtime?.projects ?? null;
    this.sessionReader = options.getSession ?? (runtime ? () => runtime.auth.getSession() : null);
  }

  get available(): boolean {
    return this.projects !== null && this.sessionReader !== null;
  }

  private async assertSignedIn(): Promise<CloudProjectTablePort> {
    if (!this.projects || !this.sessionReader) {
      throw new CloudServiceError(CLOUD_NOT_CONFIGURED_MESSAGE, 'unconfigured');
    }
    const { data: session, error } = await this.sessionReader();
    if (error || !session) {
      throw new CloudServiceError('请先登录账号后再读取或保存云端项目。', 'unauthenticated');
    }
    return this.projects;
  }

  private static unwrap<T>(
    result: { data: T | null; error: { message: string; kind?: string; code?: string } | null },
    fallback: T,
  ): T {
    if (result.error) {
      const kind = result.error.kind;
      const mapped =
        kind === 'unauthenticated' || kind === 'permission-denied' || kind === 'network'
          ? (kind as 'unauthenticated' | 'permission' | 'network')
          : 'unknown';
      throw new CloudServiceError(describeCloudError(result.error), mapped);
    }
    return result.data ?? fallback;
  }

  async load(projectId: string): Promise<BranchFile | null> {
    const projects = await this.assertSignedIn();
    const result = CloudProjectStore.unwrap(await projects.get(projectId), null);
    return result ? parseFile(result.payload) : null;
  }

  async save(file: BranchFile): Promise<void> {
    const projects = await this.assertSignedIn();
    const outcome = CloudProjectStore.unwrap(await projects.upsert(toRow(file)), { affected: 0 });
    // PostgREST 在 RLS 拦截时返回空数组而非 error，必须显式判定，不能当成成功。
    if (outcome.affected === 0) {
      throw new CloudServiceError(
        '项目未写入云端：可能不属于当前账号，或云端项目表尚未创建。',
        'permission',
      );
    }
  }

  async listProjects(): Promise<StoredProjectSummary[]> {
    const projects = await this.assertSignedIn();
    const rows = CloudProjectStore.unwrap(await projects.list(), []);
    return rows.map((row) => ({
      projectId: row.project_id,
      title: row.title || row.project_id,
      activeBranch: row.active_branch || 'main',
      nodeCount: Number.isFinite(row.node_count) ? row.node_count : 0,
      updatedAt: row.updated_at,
    }));
  }

  async createIfAbsent(file: BranchFile): Promise<BranchFile> {
    const existing = await this.load(file.projectId);
    if (existing) return existing;
    await this.save(file);
    return file;
  }

  async clear(projectId: string): Promise<void> {
    const projects = await this.assertSignedIn();
    const outcome = CloudProjectStore.unwrap(await projects.remove(projectId), { affected: 0 });
    if (outcome.affected === 0) {
      throw new CloudServiceError('项目未删除：可能不存在或不属于当前账号。', 'permission');
    }
  }
}

/** 登录态决定仓储：已登录走账号云端，未登录走本地 IndexedDB。 */
export function resolveStorageScope(signedIn: boolean, cloudEnabled: boolean): StorageScope {
  return signedIn && cloudEnabled ? 'account' : 'local';
}
