import { idbGet, idbWrite } from '@workspacetree/storage/browser';
import { LinkedBranchFile, LinkedFileChangedError } from './linked-branch-file';

const permission = { mode: 'readwrite' } as const;
const store = 'handles';

type LocalFileHandle = FileSystemFileHandle & {
  queryPermission(options: typeof permission): Promise<PermissionState>;
  requestPermission(options: typeof permission): Promise<PermissionState>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<LocalFileHandle[]>;
};

export interface LocalFileConnection {
  handle: LocalFileHandle;
  storage: LinkedBranchFile;
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

export async function connectLocalProjectFile(
  handle: LocalFileHandle,
): Promise<LocalFileConnection> {
  if ((await handle.requestPermission(permission)) !== 'granted') {
    throw new DOMException('File read and write permission was denied.', 'NotAllowedError');
  }
  return { handle, storage: await LinkedBranchFile.open(handle) };
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

export async function rememberLocalProjectFile(id: string, handle: LocalFileHandle): Promise<void> {
  await withHandleStore((db) => idbWrite(db, [{ store, mode: 'put', key: id, value: handle }]));
}

export async function forgetLocalProjectFile(id: string): Promise<void> {
  await withHandleStore((db) => idbWrite(db, [{ store, mode: 'delete', key: id }]));
}

export async function restoreLocalProjectFile(id: string): Promise<LocalFileConnection> {
  const handle = await withHandleStore((db) => idbGet<LocalFileHandle>(db, store, id));
  if (!handle || (await handle.queryPermission(permission)) !== 'granted') {
    throw new DOMException('File read and write permission is required.', 'NotAllowedError');
  }
  return { handle, storage: await LinkedBranchFile.open(handle) };
}

export function localFileSyncMessage(cause: unknown): string {
  if (cause instanceof LinkedFileChangedError) {
    return '磁盘文件已更改。请结束当前编辑，等画布更新后再保存。';
  }
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return '本地文件的读写权限不可用，请通过「打开并同步」重新授权。';
  }
  if (cause instanceof DOMException && cause.name === 'NotFoundError') {
    return '找不到本地文件，请通过「打开并同步」重新选择。';
  }
  return `本地文件同步失败。${cause instanceof Error ? cause.message : String(cause)}`;
}
