export const WORKSPACE_SESSION_STORAGE_KEY = 'workspacetree_session_v1';

export interface SavedWorkspaceTab {
  id: string;
  projectId: string;
  title: string;
  branchName: string;
  readOnly?: boolean;
}

export interface SavedWorkspaceSession {
  tabs: SavedWorkspaceTab[];
  activeTabId: string;
}

function getStorage(): Storage | null {
  if (
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  ) {
    return localStorage;
  }
  return null;
}

export function loadWorkspaceSession(
  key: string = WORKSPACE_SESSION_STORAGE_KEY,
): SavedWorkspaceSession | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedWorkspaceSession;
    if (
      parsed &&
      Array.isArray(parsed.tabs) &&
      parsed.tabs.length > 0 &&
      typeof parsed.activeTabId === 'string'
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to parse saved workspace session:', error);
  }
  return null;
}

export function saveWorkspaceSession(
  session: SavedWorkspaceSession,
  key: string = WORKSPACE_SESSION_STORAGE_KEY,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(session));
  } catch (error) {
    console.warn('Failed to save workspace session:', error);
  }
}

export function clearWorkspaceSession(key: string = WORKSPACE_SESSION_STORAGE_KEY): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn('Failed to clear workspace session:', error);
  }
}
