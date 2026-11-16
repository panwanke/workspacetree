/**
 * 工作区仓储选择：登录前后用同一套 ProjectStorePort，UI 不依赖具体实现类。
 *
 * - local   → IndexedDB（游客 / 未配置云服务），既有行为完全不变。
 * - account → 云端数据库（已登录），项目按账号隔离（RLS）。
 */
import { createBrowserStorageAdapter } from '@workspacetree/storage';
import { getCloudRuntime, isCloudEnabled } from './client';
import { CloudProjectStore, resolveStorageScope } from './project-store';
import type { AccountSnapshot } from './account';
import type { ProjectStorePort } from '../project-store';
import type { StorageScope } from '../workspace-session';

export function storageScopeFor(snapshot: AccountSnapshot): StorageScope {
  return resolveStorageScope(snapshot.status === 'signed-in', isCloudEnabled());
}

export function createWorkspaceStorage(
  scope: StorageScope,
): Promise<ProjectStorePort> | ProjectStorePort {
  if (scope === 'account') {
    const runtime = getCloudRuntime();
    if (!runtime) {
      throw new Error('云服务尚未配置，无法切换到账号项目空间。');
    }
    return new CloudProjectStore({ projects: runtime.projects });
  }
  return createBrowserStorageAdapter();
}
