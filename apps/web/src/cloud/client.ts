/**
 * 云服务客户端 —— 全应用唯一初始化点。
 *
 * endpoint / oauthRelayBaseUrl / publishableKey 全部来自 publicConfig（见 public-config.ts）。
 * 绝不从 window.location、环境变量或约定拼接推导 endpoint。
 * 未配置时 getCloudRuntime() 返回 null，应用保持本地游客模式。
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';
import { isCloudConfigured, publicConfig } from './public-config';
import type {
  CloudAuthPort,
  CloudErrorLike,
  CloudProjectRow,
  CloudProjectSummaryRow,
  CloudProjectTablePort,
  CloudResultLike,
} from './ports';

export interface CloudRuntime {
  auth: CloudAuthPort;
  projects: CloudProjectTablePort;
}

let cached: CloudRuntime | null = null;
let injected: CloudRuntime | null | undefined;

/** 仅测试使用：注入内存 fake，绕过 SDK 初始化。 */
export function setCloudRuntimeForTests(runtime: CloudRuntime | null): void {
  injected = runtime;
}

export function isCloudEnabled(): boolean {
  return injected === undefined ? isCloudConfigured() : injected !== null;
}

export function getCloudRuntime(): CloudRuntime | null {
  if (injected !== undefined) return injected;
  if (!isCloudConfigured()) return null;
  if (cached) return cached;

  const cloud = createWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
    publishableKey: publicConfig.publishableKey,
  });

  cached = {
    auth: cloud.auth as unknown as CloudAuthPort,
    projects: createProjectTable(cloud.database),
  };
  return cached;
}

interface QueryResult {
  data: unknown;
  error: CloudErrorLike | null;
}

/** PostgREST 构造器是 thenable；统一在这里收窄为 { data, error }。 */
function run(builder: unknown): Promise<QueryResult> {
  return Promise.resolve(builder as PromiseLike<QueryResult>);
}

function normalize(error: CloudErrorLike | null): CloudErrorLike | null {
  if (!error) return null;
  return {
    message: typeof error.message === 'string' ? error.message : '云服务请求失败',
    kind: error.kind,
    code: error.code,
  };
}

function envelope<T>(result: QueryResult, pick: (data: unknown) => T): CloudResultLike<T> {
  return result.error
    ? { data: null, error: normalize(result.error) }
    : { data: pick(result.data), error: null };
}

interface DatabaseLike {
  from(table: string): unknown;
}

interface TableBuilder {
  select(columns: string): TableBuilder;
  upsert(payload: Record<string, unknown>, options?: { onConflict?: string }): TableBuilder;
  delete(): TableBuilder;
  eq(column: string, value: string): TableBuilder;
  order(column: string, options?: { ascending?: boolean }): TableBuilder;
  maybeSingle(): TableBuilder;
}

const SUMMARY_COLUMNS = 'project_id, title, active_branch, node_count, updated_at';

function createProjectTable(database: DatabaseLike): CloudProjectTablePort {
  const table = (): TableBuilder =>
    database.from('workspacetree_projects') as unknown as TableBuilder;

  return {
    async list() {
      const result = await run(
        table().select(SUMMARY_COLUMNS).order('updated_at', { ascending: false }),
      );
      return envelope(result, (data) =>
        Array.isArray(data) ? (data as CloudProjectSummaryRow[]) : [],
      );
    },
    async get(projectId) {
      const result = await run(
        table()
          .select('project_id, title, active_branch, node_count, payload, updated_at')
          .eq('project_id', projectId)
          .maybeSingle(),
      );
      return envelope(result, (data) => (data ? (data as CloudProjectRow) : null));
    },
    async upsert(row) {
      // owner_id 由数据库 DEFAULT auth.uid() 填充，前端绝不传；RLS 负责按账号隔离。
      const payload: Record<string, unknown> = {
        project_id: row.project_id,
        title: row.title,
        active_branch: row.active_branch,
        node_count: row.node_count,
        payload: row.payload,
        updated_at: row.updated_at ?? new Date().toISOString(),
      };
      const result = await run(
        table().upsert(payload, { onConflict: 'owner_id,project_id' }).select('project_id'),
      );
      return envelope(result, (data) => ({
        affected: Array.isArray(data) ? data.length : 1,
      }));
    },
    async remove(projectId) {
      const result = await run(table().delete().eq('project_id', projectId).select('project_id'));
      return envelope(result, (data) => ({
        affected: Array.isArray(data) ? data.length : 1,
      }));
    },
  };
}
