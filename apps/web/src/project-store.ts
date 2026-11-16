import type { StorageAdapter } from '@workspacetree/core';
import type { BranchFile } from '@workspacetree/schema';
import type { StoredProjectSummary } from '@workspacetree/storage';

export interface ProjectStorePort extends StorageAdapter {
  listProjects(): Promise<StoredProjectSummary[]>;
  createIfAbsent(file: BranchFile): Promise<BranchFile>;
  clear(projectId: string): Promise<void>;
}
