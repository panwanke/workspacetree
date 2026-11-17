import { idbGet, idbWrite } from '@workspacetree/storage/browser';
import type { BranchFile } from '@workspacetree/schema';
import { LinkedBranchFile, LinkedFileChangedError } from './linked-branch-file';

const permission = { mode: 'readwrite' } as const;
const store = 'handles';

export type LocalFileHandle = FileSystemFileHandle & {
  queryPermission(options: typeof permission): Promise<PermissionState>;
  requestPermission(options: typeof permission): Promise<PermissionState>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<LocalFileHandle[]>;
};

export interface LinkedProjectTab {
  handle?: LocalFileHandle;
  file?: BranchFile;
  storage?: LinkedBranchFile;
  issue?: string;
}

interface SavedLinkedProject {
  handle: LocalFileHandle;
  file: BranchFile;
}

export function supportsLocalFileSync(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as PickerWindow).showOpenFilePicker === 'function'
  );
}

export async function pickLocalProjectFile(): Promise<LocalFileHandle | undefined> {
  const handles = await (window as PickerWindow).showOpenFilePicker?.({
    multiple: false,
    types: [{ description: 'WorkspaceTree 项目文件', accept: { 'application/json': ['.json'] } }],
  });
  return handles?.[0];
}

export async function requestLocalProjectPermission(handle: LocalFileHandle): Promise<void> {
  if ((await handle.requestPermission(permission)) !== 'granted') {
    throw new DOMException('File read and write permission was denied.', 'NotAllowedError');
  }
}

async function withHandleStore<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('workspacetree-linked-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

export async function connectLocalProjectFile(
  id: string,
  handle: LocalFileHandle,
  expectedProjectId?: string,
): Promise<{ handle: LocalFileHandle; file: BranchFile; storage: LinkedBranchFile }> {
  const saveBackup = (file: BranchFile) =>
    withHandleStore((db) =>
      idbWrite(db, [{ store, mode: 'put', key: id, value: { handle, file } }]),
    );
  const storage = await LinkedBranchFile.open(handle, saveBackup);
  const file = storage.snapshot;
  if (expectedProjectId && file.projectId !== expectedProjectId) {
    throw new Error('The selected file contains a different project.');
  }
  await saveBackup(file);
  return { handle, file, storage };
}

export async function restoreLocalProjectFile(
  id: string,
  projectId: string,
): Promise<LinkedProjectTab> {
  const saved = await withHandleStore((db) =>
    idbGet<SavedLinkedProject | LocalFileHandle>(db, store, id),
  );
  if (!saved) return { issue: '请选择原文件以恢复同步。' };
  const handle = 'handle' in saved ? saved.handle : saved;
  const cached = 'file' in saved && saved.file.projectId === projectId ? saved.file : undefined;
  try {
    if ((await handle.queryPermission(permission)) === 'granted') {
      return await connectLocalProjectFile(id, handle, projectId);
    }
    // A legacy link may still have read permission, but has no cached snapshot yet.
    const recovered =
      cached ?? (await connectLocalProjectFile(id, handle, projectId).catch(() => null))?.file;
    return { handle, file: recovered, issue: '请重新授权以恢复本地文件同步。' };
  } catch (cause) {
    return { handle, file: cached, issue: localFileSyncMessage(cause) };
  }
}

export async function getDroppedProjectFile(
  transfer: DataTransfer,
): Promise<LocalFileHandle | undefined> {
  type FileItem = DataTransferItem & {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  };
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  const handle = items.length === 1 ? await (items[0] as FileItem).getAsFileSystemHandle?.() : null;
  return handle?.kind === 'file' ? (handle as LocalFileHandle) : undefined;
}

export function localFileSyncMessage(cause: unknown): string {
  if (cause instanceof LinkedFileChangedError) {
    return '磁盘文件已更改。请结束当前编辑，等画布更新后再保存。';
  }
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return '本地文件的读写权限不可用，请重新授权。';
  }
  if (cause instanceof DOMException && cause.name === 'NotFoundError') {
    return '找不到本地文件，请通过「导入并同步」重新选择。';
  }
  return `本地文件同步失败。${cause instanceof Error ? cause.message : String(cause)}`;
}
