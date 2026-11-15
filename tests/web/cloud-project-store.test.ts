import { describe, expect, it, afterEach } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import type { BranchFile } from '@workspacetree/schema';
import { setCloudRuntimeForTests } from '../../apps/web/src/cloud/client';
import { CLOUD_NOT_CONFIGURED_MESSAGE } from '../../apps/web/src/cloud/public-config';
import { CloudProjectStore, resolveStorageScope } from '../../apps/web/src/cloud/project-store';
import type {
  CloudProjectRow,
  CloudProjectSummaryRow,
  CloudProjectTablePort,
  CloudResultLike,
  CloudSessionLike,
} from '../../apps/web/src/cloud/ports';

/** 内存版「数据库」：按 owner 隔离，模拟 RLS 的读过滤与写空数组。 */
function fakeTable(currentOwner: () => string) {
  const rows = new Map<string, { owner: string; row: CloudProjectRow }>();
  const calls: string[] = [];
  let forcedError: { message: string; code?: string; kind?: string } | null = null;

  const key = (owner: string, projectId: string) => `${owner}:${projectId}`;
  const visible = () => Array.from(rows.values()).filter((entry) => entry.owner === currentOwner());

  const table: CloudProjectTablePort = {
    async list() {
      calls.push('list');
      if (forcedError) return { data: null, error: forcedError };
      const data: CloudProjectSummaryRow[] = visible().map(({ row }) => ({
        project_id: row.project_id,
        title: row.title,
        active_branch: row.active_branch,
        node_count: row.node_count,
        updated_at: row.updated_at,
      }));
      return { data, error: null };
    },
    async get(projectId) {
      calls.push(`get:${projectId}`);
      if (forcedError) return { data: null, error: forcedError };
      const found = rows.get(key(currentOwner(), projectId));
      return { data: found ? found.row : null, error: null };
    },
    async upsert(row) {
      calls.push(`upsert:${row.project_id}`);
      if (forcedError) return { data: null, error: forcedError };
      // 模拟唯一约束 (owner_id, project_id)：其他账号的同名 id 不影响当前账号。
      rows.set(key(currentOwner(), row.project_id), { owner: currentOwner(), row });
      return { data: { affected: 1 }, error: null };
    },
    async remove(projectId) {
      calls.push(`remove:${projectId}`);
      if (forcedError) return { data: null, error: forcedError };
      const existed = rows.delete(key(currentOwner(), projectId));
      return { data: { affected: existed ? 1 : 0 }, error: null };
    },
  };

  return {
    table,
    calls,
    setError: (error: typeof forcedError) => {
      forcedError = error;
    },
    seed: (owner: string, row: CloudProjectRow) => {
      rows.set(key(owner, row.project_id), { owner, row });
    },
    size: () => rows.size,
  };
}

function fileWith(title: string, id = 'prj_a'): BranchFile {
  const file = createMinimalBranchFile();
  file.projectId = id;
  file.domain.project.id = id;
  file.domain.project.title = title;
  return file;
}

function rowOf(file: BranchFile): CloudProjectRow {
  return {
    project_id: file.projectId,
    title: file.domain.project.title,
    active_branch: file.activeBranch,
    node_count: file.domain.nodes.length,
    payload: file,
  };
}

function sessionReader(
  session: () => CloudSessionLike | null,
  error: () => { message: string } | null = () => null,
) {
  return async (): Promise<CloudResultLike<CloudSessionLike>> => ({
    data: session(),
    error: error(),
  });
}

describe('CloudProjectStore', () => {
  afterEach(() => setCloudRuntimeForTests(null));

  it('blocks every read and write when there is no signed-in session', async () => {
    const db = fakeTable(() => 'user_a');
    const store = new CloudProjectStore({
      projects: db.table,
      getSession: sessionReader(() => null),
    });
    await expect(store.load('prj_a')).rejects.toThrow('请先登录');
    await expect(store.save(fileWith('A'))).rejects.toThrow('请先登录');
    await expect(store.listProjects()).rejects.toThrow('请先登录');
    await expect(store.clear('prj_a')).rejects.toThrow('请先登录');
    expect(db.calls).toEqual([]);
  });

  it('saves a new project into the current account and reads it back', async () => {
    const db = fakeTable(() => 'user_a');
    const store = new CloudProjectStore({
      projects: db.table,
      getSession: sessionReader(() => ({ user: { id: 'user_a' } })),
    });
    const file = fileWith('我的论文项目');
    await store.save(file);
    expect(await store.load(file.projectId)).toEqual(file);
    expect(await store.listProjects()).toMatchObject([
      { projectId: 'prj_a', title: '我的论文项目', activeBranch: 'main' },
    ]);
  });

  it('isolates projects per account: another user never sees or overwrites them', async () => {
    // 同一份云端数据、两个不同登录会话：每次操作前切换当前会话，
    // fakeTable 的读写过滤与 getSession 都会按当前 owner 生效（等价于 RLS）。
    let owner = 'user_a';
    const db = fakeTable(() => owner);
    const getSession = sessionReader(() => ({ user: { id: owner } }));
    const storeA = new CloudProjectStore({ projects: db.table, getSession });
    const storeB = new CloudProjectStore({ projects: db.table, getSession });
    const asA = <T>(fn: () => Promise<T>): Promise<T> => {
      owner = 'user_a';
      return fn();
    };
    const asB = <T>(fn: () => Promise<T>): Promise<T> => {
      owner = 'user_b';
      return fn();
    };

    await asA(() => storeA.save(fileWith('A 的项目')));
    expect(await asB(() => storeB.listProjects())).toEqual([]);
    expect(await asB(() => storeB.load('prj_a'))).toBeNull();

    await asB(() => storeB.save(fileWith('B 的项目')));
    expect((await asA(() => storeA.load('prj_a')))?.domain.project.title).toBe('A 的项目');
    expect((await asB(() => storeB.load('prj_a')))?.domain.project.title).toBe('B 的项目');
    expect(db.size()).toBe(2);
  });

  it('surfaces an empty write result (RLS blocked) instead of treating it as success', async () => {
    const db = fakeTable(() => 'user_a');
    db.seed('user_b', rowOf(fileWith('别人的项目')));
    const store = new CloudProjectStore({
      projects: db.table,
      getSession: sessionReader(() => ({ user: { id: 'user_a' } })),
    });
    await expect(store.clear('prj_a')).rejects.toThrow('项目未删除');
  });

  it('createIfAbsent keeps an existing project instead of overwriting it', async () => {
    const db = fakeTable(() => 'user_a');
    const existing = rowOf(fileWith('已存在'));
    db.seed('user_a', existing);
    const store = new CloudProjectStore({
      projects: db.table,
      getSession: sessionReader(() => ({ user: { id: 'user_a' } })),
    });
    expect(await store.createIfAbsent(fileWith('新版本'))).toEqual(existing.payload);
  });

  it('maps missing-table, permission and network errors to clear messages', async () => {
    const db = fakeTable(() => 'user_a');
    const store = new CloudProjectStore({
      projects: db.table,
      getSession: sessionReader(() => ({ user: { id: 'user_a' } })),
    });
    db.setError({ message: 'relation does not exist', code: '42P01' });
    await expect(store.listProjects()).rejects.toThrow('云端项目表尚未创建');
    db.setError({ message: 'permission denied', kind: 'permission-denied' });
    await expect(store.save(fileWith('A'))).rejects.toThrow('没有权限访问该账号下的项目');
    db.setError({ message: 'offline', kind: 'network' });
    await expect(store.clear('prj_a')).rejects.toThrow('云服务暂时不可用');
  });

  it('reports an explicit configuration error when cloud is not wired', async () => {
    setCloudRuntimeForTests(null);
    const store = new CloudProjectStore();
    expect(store.available).toBe(false);
    await expect(store.load('prj_a')).rejects.toThrow(CLOUD_NOT_CONFIGURED_MESSAGE);
  });
});

describe('resolveStorageScope', () => {
  it('uses the account store only when signed in AND cloud is enabled', () => {
    expect(resolveStorageScope(false, false)).toBe('local');
    expect(resolveStorageScope(true, false)).toBe('local');
    expect(resolveStorageScope(false, true)).toBe('local');
    expect(resolveStorageScope(true, true)).toBe('account');
  });
});
