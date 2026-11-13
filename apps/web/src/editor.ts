/**
 * 画布编辑控制器：把 UI 动作接到唯一 CommandService 上（C6）。
 * 不含 React / DOM，可在 Node 下用 MemoryStorageAdapter 完整跑通 Undo/Redo 与拖动合批。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { CommandService, validateDomain, type StorageAdapter } from '@workspacetree/core';
import type { LayoutStrategy } from '@workspacetree/layout';
import {
  BranchFileSchema,
  type BranchFile,
  type Command,
  type LayoutDirection,
} from '@workspacetree/schema';
import {
  DragCoalescer,
  replaceDomainEntry,
  replacePresentationEntry,
  type HistoryEntry,
  type Point,
} from './history';
import { translateBranchEntry } from './branch-editing';

export interface EditorStats {
  persistedBatches: number;
  presentationBatches: number;
  semanticCommits: number;
  persistedCommands: number;
  lastDragFrames: number;
}

export interface EditorSnapshot {
  file: BranchFile;
  previewExpandedNodeIds: readonly string[];
  undoDepth: number;
  redoDepth: number;
  stats: EditorStats;
  lastAction: string;
  error: string | null;
}

export class EditorController {
  private static readonly pairedEdits = new WeakMap<
    HistoryEntry,
    { editor: EditorController; entry: HistoryEntry }
  >();
  private file: BranchFile;
  private readonly previewExpanded = new Set<string>();
  private readonly service: CommandService;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly drag = new DragCoalescer();
  private dragDirection: LayoutDirection = 'horizontal';
  private readonly listeners = new Set<() => void>();
  private operationCounter = 0;
  private stats: EditorStats = {
    persistedBatches: 0,
    presentationBatches: 0,
    semanticCommits: 0,
    persistedCommands: 0,
    lastDragFrames: 0,
  };
  private lastAction = '就绪';
  private error: string | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    file: BranchFile,
    service?: CommandService,
    readonly isReadOnly = false,
  ) {
    this.file = file;
    this.service = service ?? new CommandService(storage);
  }

  static preview(file: BranchFile): EditorController {
    const snapshot = structuredClone(file);
    const storage: StorageAdapter = {
      load: async (projectId) => (projectId === snapshot.projectId ? snapshot : null),
      save: async () => {
        throw new Error('This tab is read-only');
      },
    };
    return new EditorController(storage, snapshot, undefined, true);
  }

  expandPreviewAncestors(nodeIds: readonly string[]): void {
    if (!this.isReadOnly) return;
    for (const nodeId of nodeIds) this.previewExpanded.add(nodeId);
    this.error = null;
    this.emit();
  }

  /** 首次启动：存储无数据时写入演示文件；刷新 / 重启后直接读回，数据不丢。 */
  static async bootstrap(
    storage: StorageAdapter & { createIfAbsent?: (file: BranchFile) => Promise<BranchFile> },
    fallback: () => BranchFile,
  ): Promise<EditorController> {
    const seed = fallback();
    let file = await storage.load(seed.projectId);
    if (!file) {
      if (storage.createIfAbsent) {
        file = await storage.createIfAbsent(seed);
      } else {
        await storage.save(seed);
        file = await storage.load(seed.projectId);
      }
    }
    if (!file) throw new Error('failed to bootstrap branch file');
    validateDomain(file.domain);
    return new EditorController(storage, file);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): EditorSnapshot {
    return {
      file: this.file,
      previewExpandedNodeIds: [...this.previewExpanded],
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      stats: { ...this.stats },
      lastAction: this.lastAction,
      error: this.error,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private nextOperationId(): string {
    this.operationCounter += 1;
    return `op_phase1_${this.operationCounter}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private async applyCommands(entry: HistoryEntry, commands: Command[]): Promise<void> {
    const stateClass = entry.stateClass;
    const expectedRevision =
      stateClass === 'domain'
        ? this.file.revisions.semanticRevision
        : this.file.revisions.presentationRevision;
    const outcome = await this.service.executeBatch({
      operationId: this.nextOperationId(),
      projectId: this.file.projectId,
      stateClass,
      expectedRevision,
      actor: { kind: entry.actorKind, id: 'local-canvas' },
      commands,
    });
    const reloaded = await this.storage.load(this.file.projectId);
    if (!reloaded) throw new Error('branch file vanished after write');
    this.file = reloaded;
    this.stats.persistedBatches += 1;
    this.stats.persistedCommands += commands.length;
    if (stateClass === 'presentation') this.stats.presentationBatches += 1;
    if (outcome.commit) this.stats.semanticCommits += 1;
    this.error = null;
  }

  private async applyEntry(entry: HistoryEntry, phase: 'forward' | 'inverse'): Promise<void> {
    const commands = entry[phase];
    if (entry.atomic && entry.chained) {
      const operationId = this.nextOperationId();
      const actor = { kind: entry.actorKind, id: 'local-canvas' };
      const projectId = this.file.projectId;
      const presentation = entry.chained[phase];
      const outcome = await this.service.executeCombined(
        {
          operationId,
          actor,
          projectId,
          commands,
          stateClass: 'domain',
          expectedRevision: this.file.revisions.semanticRevision,
        },
        {
          operationId,
          actor,
          projectId,
          commands: presentation,
          stateClass: 'presentation',
          expectedRevision: this.file.revisions.presentationRevision,
        },
      );
      if (
        outcome.file.revisions.presentationRevision !== this.file.revisions.presentationRevision
      ) {
        this.stats.presentationBatches++;
      }
      this.file = outcome.file;
      this.stats.persistedBatches++;
      this.stats.persistedCommands += commands.length + presentation.length;
      if (outcome.commit) this.stats.semanticCommits++;
      this.error = null;
      return;
    }
    if (commands.length > 0) await this.applyCommands(entry, commands);
    if (!entry.chained) return;
    try {
      await this.applyEntry(entry.chained, phase);
    } catch (cause) {
      if (phase === 'forward' && entry.inverse.length > 0) {
        await this.applyCommands(entry, entry.inverse);
      }
      throw cause;
    }
  }

  private async safely(action: () => Promise<void>): Promise<void> {
    try {
      if (this.isReadOnly) throw new Error('This tab is read-only');
      await action();
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
    this.emit();
  }

  async run(entry: HistoryEntry): Promise<void> {
    await this.safely(async () => {
      await this.applyEntry(entry, 'forward');
      this.undoStack.push(entry);
      this.redoStack.length = 0;
      this.lastAction = entry.label;
    });
  }

  /** Stage each project's commands through the service and publish both in one transaction. */
  private async applyPair(
    entry: HistoryEntry,
    other: EditorController,
    otherEntry: HistoryEntry,
    phase: 'forward' | 'inverse',
  ): Promise<void> {
    if (
      this.isReadOnly ||
      other.isReadOnly ||
      this.storage !== other.storage ||
      !this.storage.savePair
    ) {
      throw new Error('两个项目必须在同一工作区且可编辑');
    }
    const stage = async (editor: EditorController, edit: HistoryEntry) => {
      const before = editor.file;
      const staged = new EditorController(
        { load: async () => before, save: async () => {} },
        before,
      );
      await staged.applyEntry(edit, phase);
      return { before, after: staged.file, stats: staged.stats };
    };
    const [here, there] = await Promise.all([stage(this, entry), stage(other, otherEntry)]);
    await this.storage.savePair([here, there]);
    for (const [editor, result] of [
      [this, here],
      [other, there],
    ] as const) {
      editor.file = result.after;
      editor.stats.persistedBatches += result.stats.persistedBatches;
      editor.stats.presentationBatches += result.stats.presentationBatches;
      editor.stats.semanticCommits += result.stats.semanticCommits;
      editor.stats.persistedCommands += result.stats.persistedCommands;
      editor.error = null;
    }
  }

  async moveBetween(
    entry: HistoryEntry,
    source: EditorController,
    removal: HistoryEntry,
  ): Promise<void> {
    await this.safely(async () => {
      await this.applyPair(entry, source, removal, 'forward');
      EditorController.pairedEdits.set(entry, { editor: source, entry: removal });
      EditorController.pairedEdits.set(removal, { editor: this, entry });
      for (const [editor, edit] of [
        [this, entry],
        [source, removal],
      ] as const) {
        editor.undoStack.push(edit);
        editor.redoStack.length = 0;
        editor.lastAction = entry.label;
      }
      source.emit();
    });
  }

  private async replayPair(item: HistoryEntry, undo: boolean): Promise<boolean> {
    const paired = EditorController.pairedEdits.get(item);
    if (!paired) return false;
    const { editor, entry } = paired;
    const from = undo ? editor.undoStack : editor.redoStack;
    const to = undo ? editor.redoStack : editor.undoStack;
    if (from.at(-1) !== entry) {
      throw new Error('请先处理另一个标签页中较新的编辑，再撤销或重做这次移动');
    }
    await this.applyPair(item, editor, entry, undo ? 'inverse' : 'forward');
    from.pop();
    to.push(entry);
    editor.lastAction = `${undo ? '撤销' : '重做'}：${item.label}`;
    editor.emit();
    return true;
  }

  async undo(): Promise<void> {
    await this.safely(async () => {
      const item = this.undoStack.pop();
      if (!item) {
        this.lastAction = '无可撤销操作';
        return;
      }
      try {
        if (!(await this.replayPair(item, true))) await this.applyEntry(item, 'inverse');
        this.redoStack.push(item);
        this.lastAction = `撤销：${item.label}`;
      } catch (cause) {
        this.undoStack.push(item);
        throw cause;
      }
    });
  }

  async redo(): Promise<void> {
    await this.safely(async () => {
      const item = this.redoStack.pop();
      if (!item) {
        this.lastAction = '无可重做操作';
        return;
      }
      try {
        if (!(await this.replayPair(item, false))) await this.applyEntry(item, 'forward');
        this.undoStack.push(item);
        this.lastAction = `重做：${item.label}`;
      } catch (cause) {
        this.redoStack.push(item);
        throw cause;
      }
    });
  }

  /** 同一导入动作分 domain / presentation 两批经 CommandService，单次 Undo 同时还原。 */
  async importFile(next: BranchFile): Promise<void> {
    await this.safely(async () => {
      const imported = BranchFileSchema.parse(next);
      if (imported.projectId !== this.file.projectId) {
        throw new Error('imported branch file belongs to a different project');
      }
      const domainEntry = replaceDomainEntry(this.file.domain, imported.domain);
      const entry: HistoryEntry = {
        ...domainEntry,
        chained: replacePresentationEntry(this.file.presentation, imported.presentation),
      };
      await this.applyEntry(entry, 'forward');
      this.undoStack.push(entry);
      this.redoStack.length = 0;
      this.lastAction = entry.label;
    });
  }

  dragBegin(nodeId: string, at: Point, direction: LayoutDirection = 'horizontal'): void {
    if (this.isReadOnly) return;
    this.dragDirection = direction;
    this.drag.begin(nodeId, at, direction);
  }

  dragMove(nodeId: string, at: Point, direction?: LayoutDirection): void {
    if (this.isReadOnly) return;
    if (direction) this.dragDirection = direction;
    this.drag.move(nodeId, at, direction);
  }

  get dragFrames(): number {
    return this.drag.frameCount;
  }

  async dragEnd(
    direction: LayoutDirection = this.dragDirection,
    strategy: LayoutStrategy = 'timeline',
  ): Promise<void> {
    const batch = this.drag.finish(direction);
    if (!batch) return;
    this.stats.lastDragFrames = batch.frames;
    await this.safely(async () => {
      const moved = batch.entry.forward[0].payload as { nodeId: string; x: number; y: number };
      const folded = this.file.presentation.collapsedByDefault.includes(moved.nodeId);
      const positions =
        direction === 'vertical'
          ? this.file.presentation.verticalNodePositions
          : this.file.presentation.nodePositions;
      const dragEdit = folded
        ? translateBranchEntry(this.file, moved.nodeId, direction, moved, strategy)
        : {
            ...batch.entry,
            inverse: batch.entry.forward.map((command): Command => {
              const { nodeId } = command.payload as { nodeId: string };
              const previous = positions?.[nodeId];
              return previous
                ? { type: 'presentation.moveNode', payload: { nodeId, direction, ...previous } }
                : { type: 'presentation.clearManualPosition', payload: { nodeId, direction } };
            }),
          };
      await this.applyEntry(dragEdit, 'forward');
      this.undoStack.push(dragEdit);
      this.redoStack.length = 0;
      this.lastAction = folded
        ? '拖动折叠分支'
        : `拖动合批：${batch.frames} 帧 → ${batch.mergedCommands} 命令 / 1 批次`;
    });
  }
}
