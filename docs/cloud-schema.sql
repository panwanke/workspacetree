-- WorkspaceTree 账号项目空间：部署前在 WorkBuddy Cloud Service 的 SQL 编辑器执行本文件。
--
-- 设计约定（与 apps/web/src/cloud/client.ts 一一对应）：
--   * 前端 upsert 只发送 project_id / title / active_branch / node_count / payload / updated_at，
--     绝不发送 owner_id；owner_id 一律由服务端 DEFAULT auth.uid() 填充。
--   * upsert 使用 onConflict: 'owner_id,project_id'，因此下面的复合唯一约束是必需的。
--   * 读、写、删全部由 RLS 按 owner_id = auth.uid() 隔离；前端不做「这行是不是我的」判断。
--   * RLS 拦截写入时 PostgREST 返回空数组而非 error，client.ts 会把空写入当作失败处理。
--
-- 若你的环境里 auth.uid() 已经返回 text，请把下面的 auth.uid()::text 改为 auth.uid()。
-- 若使用 anon 以外的数据库角色，请同步调整 grant 与 policy 的 to 子句。

create table if not exists public.workspacetree_projects (
  id            bigint generated always as identity primary key,
  owner_id      text        not null default (auth.uid()::text),
  project_id    text        not null,
  title         text        not null,
  active_branch text        not null default 'main',
  node_count    integer     not null default 0,
  payload       jsonb       not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint workspacetree_projects_owner_project_key unique (owner_id, project_id)
);

create index if not exists workspacetree_projects_owner_updated_idx
  on public.workspacetree_projects (owner_id, updated_at desc);

alter table public.workspacetree_projects enable row level security;

-- 幂等：重复执行不会堆叠同名策略。
drop policy if exists "workspacetree_projects_select_own" on public.workspacetree_projects;
drop policy if exists "workspacetree_projects_insert_own" on public.workspacetree_projects;
drop policy if exists "workspacetree_projects_update_own" on public.workspacetree_projects;
drop policy if exists "workspacetree_projects_delete_own" on public.workspacetree_projects;

create policy "workspacetree_projects_select_own"
  on public.workspacetree_projects
  for select to authenticated
  using (owner_id = auth.uid()::text);

create policy "workspacetree_projects_insert_own"
  on public.workspacetree_projects
  for insert to authenticated
  with check (owner_id = auth.uid()::text);

create policy "workspacetree_projects_update_own"
  on public.workspacetree_projects
  for update to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);

create policy "workspacetree_projects_delete_own"
  on public.workspacetree_projects
  for delete to authenticated
  using (owner_id = auth.uid()::text);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.workspacetree_projects to authenticated;

-- 验证（用已登录账号在前端执行更可靠；SQL 编辑器里 auth.uid() 可能为 null）：
--   select count(*) from public.workspacetree_projects;
-- 期望：未登录时 0 行；登录后只返回当前账号自己的项目。
