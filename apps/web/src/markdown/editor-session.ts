/**
 * 草稿会话管理器 (EditorSession)
 * 统一管理当前节点笔记草稿，支持画布卡片与侧栏检查器共用同一个草稿状态，
 * 跟踪脏状态、退出前保护提示与原子提交。
 */

export interface NoteDraftSession {
  projectId: string;
  nodeId: string;
  blockId: string;
  initialMarkdown: string;
  currentMarkdown: string;
  isDirty: boolean;
  sourceMode: boolean;
  activeEditorId?: string; // 当前获得焦点的编辑器标识（'canvas' | 'inspector'）
}

type SessionListener = (sessions: Map<string, NoteDraftSession>) => void;

class EditorSessionStore {
  private sessions = new Map<string, NoteDraftSession>();
  private listeners = new Set<SessionListener>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (event) => {
        if (this.hasDirtyDrafts()) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    }
  }

  private sessionKey(projectId: string, nodeId: string): string {
    return `${projectId}:${nodeId}`;
  }

  get(projectId: string, nodeId: string): NoteDraftSession | undefined {
    return this.sessions.get(this.sessionKey(projectId, nodeId));
  }

  getOrCreate(
    projectId: string,
    nodeId: string,
    blockId: string,
    initialMarkdown: string,
  ): NoteDraftSession {
    const key = this.sessionKey(projectId, nodeId);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }
    const session: NoteDraftSession = {
      projectId,
      nodeId,
      blockId,
      initialMarkdown,
      currentMarkdown: initialMarkdown,
      isDirty: false,
      sourceMode: false,
    };
    this.sessions.set(key, session);
    this.notify();
    return session;
  }

  update(
    projectId: string,
    nodeId: string,
    updateFn: (prev: NoteDraftSession) => NoteDraftSession,
  ): NoteDraftSession | undefined {
    const key = this.sessionKey(projectId, nodeId);
    const prev = this.sessions.get(key);
    if (!prev) return undefined;
    const next = updateFn(prev);
    next.isDirty = next.currentMarkdown !== next.initialMarkdown;
    this.sessions.set(key, next);
    this.notify();
    return next;
  }

  updateMarkdown(projectId: string, nodeId: string, markdown: string): void {
    this.update(projectId, nodeId, (prev) => ({
      ...prev,
      currentMarkdown: markdown,
    }));
  }

  toggleSourceMode(projectId: string, nodeId: string): boolean {
    let mode = false;
    this.update(projectId, nodeId, (prev) => {
      mode = !prev.sourceMode;
      return { ...prev, sourceMode: mode };
    });
    return mode;
  }

  close(projectId: string, nodeId: string): void {
    const key = this.sessionKey(projectId, nodeId);
    if (this.sessions.delete(key)) {
      this.notify();
    }
  }

  hasDirtyDrafts(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isDirty) return true;
    }
    return false;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.sessions);
    }
  }
}

export const editorSessionStore = new EditorSessionStore();
