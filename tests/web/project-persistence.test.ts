import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createMemoryKeyValueStore, IdbJsonStorageAdapter } from '@workspacetree/storage';
import { createDemoBranchFile, createEmptyBranchFile } from '../../apps/web/src/demo';
import { EditorController } from '../../apps/web/src/editor';
import { renameProjectEntry } from '../../apps/web/src/history';
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  type SavedWorkspaceSession,
} from '../../apps/web/src/workspace-session';

describe('Project and tab session persistence across refresh', () => {
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

  it('restores multiple open tabs and active tab after simulated reload', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = new IdbJsonStorageAdapter(kv);

    // 1. Initial boot: creates demo project
    const demo = await EditorController.bootstrap(storage, createDemoBranchFile);

    // 2. User creates a new project (e.g. "+" button in tab bar)
    const newProject = createEmptyBranchFile('新研究项目', 'main');
    await storage.createIfAbsent(newProject);

    // 3. User now has two tabs open, and has selected the second tab
    const sessionState: SavedWorkspaceSession = {
      tabs: [
        {
          id: 'tab_demo',
          projectId: demo.getSnapshot().file.projectId,
          title: demo.getSnapshot().file.domain.project.title,
          branchName: demo.getSnapshot().file.activeBranch,
        },
        {
          id: 'tab_new',
          projectId: newProject.projectId,
          title: newProject.domain.project.title,
          branchName: newProject.activeBranch,
        },
      ],
      activeTabId: 'tab_new',
    };
    saveWorkspaceSession(sessionState);

    // 4. Simulate page refresh / new session:
    // New storage connection pointing to the same underlying KV store
    const reloadedStorage = new IdbJsonStorageAdapter(kv);
    const savedSession = loadWorkspaceSession();
    expect(savedSession).not.toBeNull();

    const restoredTabs = [];
    for (const savedTab of savedSession!.tabs) {
      const file = await reloadedStorage.load(savedTab.projectId);
      expect(file).not.toBeNull();
      restoredTabs.push({
        id: savedTab.id,
        title: file!.domain.project.title,
        projectId: file!.projectId,
        branchName: file!.activeBranch,
        controller: new EditorController(reloadedStorage, file!),
      });
    }

    expect(restoredTabs).toHaveLength(2);
    expect(restoredTabs[0].title).toBe('博士论文 · 研究与写作全流程');
    expect(restoredTabs[1].title).toBe('新研究项目');
    expect(savedSession!.activeTabId).toBe('tab_new');

    // Projects list should also contain both
    const projects = await reloadedStorage.listProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.title).sort()).toEqual([
      '博士论文 · 研究与写作全流程',
      '新研究项目',
    ]);
  });

  it('gracefully drops deleted projects from tabs and falls back when empty', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = new IdbJsonStorageAdapter(kv);

    const project = createEmptyBranchFile('即将删除的项目', 'main');
    await storage.createIfAbsent(project);

    saveWorkspaceSession({
      tabs: [
        {
          id: 'tab_deleted',
          projectId: project.projectId,
          title: project.domain.project.title,
          branchName: project.activeBranch,
        },
      ],
      activeTabId: 'tab_deleted',
    });

    // Delete project from storage
    await storage.clear(project.projectId);

    // On simulated reload
    const reloadedStorage = new IdbJsonStorageAdapter(kv);
    const session = loadWorkspaceSession();
    const loadedTabs = [];
    for (const st of session!.tabs) {
      const file = await reloadedStorage.load(st.projectId);
      if (file) {
        loadedTabs.push({ id: st.id, file });
      }
    }

    // Since the project was deleted from storage, loadedTabs is empty -> fall back to bootstrap demo
    expect(loadedTabs).toHaveLength(0);
    const fallbackEditor = await EditorController.bootstrap(reloadedStorage, createDemoBranchFile);
    expect(fallbackEditor.getSnapshot().file.domain.project.title).toBe(
      '博士论文 · 研究与写作全流程',
    );
  });

  it('通过 renameProjectEntry 重命名项目，更新快照、落盘存储并支持 Undo 撤销', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = new IdbJsonStorageAdapter(kv);
    const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
    const oldTitle = editor.getSnapshot().file.domain.project.title;

    await editor.run(renameProjectEntry(editor.getSnapshot().file.domain, '认知神经科学实验总览'));
    expect(editor.getSnapshot().file.domain.project.title).toBe('认知神经科学实验总览');

    const summaries = await storage.listProjects();
    expect(summaries.find((s) => s.projectId === editor.getSnapshot().file.projectId)?.title).toBe(
      '认知神经科学实验总览',
    );

    await editor.undo();
    expect(editor.getSnapshot().file.domain.project.title).toBe(oldTitle);
  });
});
