import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
  WORKSPACE_SESSION_STORAGE_KEY,
  type SavedWorkspaceSession,
} from '../../apps/web/src/workspace-session';

describe('workspace-session', () => {
  let store: Map<string, string>;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    store = new Map();
    const fakeStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it('returns null when storage is empty', () => {
    expect(loadWorkspaceSession()).toBeNull();
  });

  it('saves and loads workspace session', () => {
    const session: SavedWorkspaceSession = {
      tabs: [
        { id: 'tab_1', projectId: 'prj_1', title: '项目 1', branchName: 'main' },
        { id: 'tab_2', projectId: 'prj_2', title: '项目 2', branchName: 'dev', readOnly: true },
      ],
      activeTabId: 'tab_2',
    };
    saveWorkspaceSession(session);
    const loaded = loadWorkspaceSession();
    expect(loaded).toEqual(session);
  });

  it('ignores corrupted json in localStorage', () => {
    localStorage.setItem(WORKSPACE_SESSION_STORAGE_KEY, 'not valid json {{{');
    expect(loadWorkspaceSession()).toBeNull();
  });

  it('ignores invalid structure in localStorage', () => {
    localStorage.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify({ tabs: [] }));
    expect(loadWorkspaceSession()).toBeNull();
  });

  it('clears workspace session', () => {
    saveWorkspaceSession({
      tabs: [{ id: 'tab_1', projectId: 'prj_1', title: '项目 1', branchName: 'main' }],
      activeTabId: 'tab_1',
    });
    expect(loadWorkspaceSession()).not.toBeNull();
    clearWorkspaceSession();
    expect(loadWorkspaceSession()).toBeNull();
  });
});
