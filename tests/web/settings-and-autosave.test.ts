import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type WorkspaceSettings,
} from '../../apps/web/src/settings.js';
import {
  createNodeEntry,
  setBranchVisualScaleEntry,
  setNodeVisualScaleEntry,
  setScaleSettingsEntry,
} from '../../apps/web/src/history.js';
import { createMinimalBranchFile } from '@workspacetree/cli';
import {
  DEFAULT_SCALE_SETTINGS,
  type BranchFile,
  type SavedPresentation,
} from '@workspacetree/schema';

describe('设置系统 (settings.ts)', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store: Record<string, string> = {};
    // @ts-expect-error mock localStorage
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  it('默认设置应开启节点自动保存，间隔为 5000ms', () => {
    const settings = loadSettings();
    expect(settings.autoSaveNode).toBe(true);
    expect(settings.autoSaveInterval).toBe(5000);
    expect(settings.markdownCss).toBe('');
  });

  it('正确保存和读取自定义设置', () => {
    const custom: WorkspaceSettings = {
      autoSaveNode: false,
      autoSaveInterval: 3000,
      markdownCss: ':scope { line-height: 1.6; }\n:scope ul { padding-inline-start: 1em; }',
    };
    saveSettings(custom);

    const loaded = loadSettings();
    expect(loaded.autoSaveNode).toBe(false);
    expect(loaded.autoSaveInterval).toBe(3000);
    expect(loaded.markdownCss).toBe(custom.markdownCss);
  });

  it('loads older settings with an empty CSS override', () => {
    globalThis.localStorage.setItem('workspacetree_settings_v1', '{"autoSaveNode":false}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, autoSaveNode: false, markdownCss: '' });
  });

  it('在 localStorage 存储无效数据时能够优雅回退到默认设置', () => {
    globalThis.localStorage.setItem('workspacetree_settings_v1', '{ not_valid_json');
    const loaded = loadSettings();
    expect(loaded.autoSaveNode).toBe(DEFAULT_SETTINGS.autoSaveNode);
    expect(loaded.autoSaveInterval).toBe(DEFAULT_SETTINGS.autoSaveInterval);
  });
});

describe('节点编辑自动保存策略模拟', () => {
  it('每 5 秒自动保存：检测到内容变动时触发静默保存，无变动时不触发', () => {
    vi.useFakeTimers();

    const onAutoSave = vi.fn();
    const original = { title: '原标题', note: '原笔记', assets: {} };
    let currentTitle = '新标题';
    const currentNote = '原笔记';
    let lastSaved = { ...original };

    const intervalMs = 5000;
    const tick = () => {
      const hasChanged = currentTitle !== lastSaved.title || currentNote !== lastSaved.note;
      if (hasChanged) {
        lastSaved = { title: currentTitle, note: currentNote, assets: {} };
        onAutoSave('n_1', currentTitle, currentNote, {});
      }
    };

    const timer = setInterval(tick, intervalMs);

    // 运行 5 秒，应该触发一次保存
    vi.advanceTimersByTime(5000);
    expect(onAutoSave).toHaveBeenCalledTimes(1);
    expect(onAutoSave).toHaveBeenCalledWith('n_1', '新标题', '原笔记', {});

    // 再过 5 秒，内容未变，不应重复触发
    vi.advanceTimersByTime(5000);
    expect(onAutoSave).toHaveBeenCalledTimes(1);

    // 修改内容后，再过 5 秒，应再次触发
    currentTitle = '最新标题';
    vi.advanceTimersByTime(5000);
    expect(onAutoSave).toHaveBeenCalledTimes(2);
    expect(onAutoSave).toHaveBeenCalledWith('n_1', '最新标题', '原笔记', {});

    clearInterval(timer);
    vi.useRealTimers();
  });

  it('离开节点自动保存：点击外部时如果开启自动保存则提交修改，取消操作则不触发保存', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    let isCancelling = false;
    const autoSaveEnabled = true;

    const handlePointerDownOutside = (isOutside: boolean) => {
      if (isCancelling) return;
      if (isOutside && autoSaveEnabled) {
        onCommit('n_1', '编辑后的标题', '编辑后的笔记', {});
      }
    };

    // 1. 点击外部且未取消：自动提交
    handlePointerDownOutside(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('n_1', '编辑后的标题', '编辑后的笔记', {});

    // 2. 模拟用户点击取消按钮或按 Esc
    isCancelling = true;
    onCancel();
    handlePointerDownOutside(true);
    // onCommit 依然只有之前的 1 次，没有被再次调用
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('双层缩放设置与历史条目 (Dual-Layer Scale Settings & History)', () => {
  const dummyFile: BranchFile = (() => {
    const file = createMinimalBranchFile();
    file.presentation.scaleSettings = DEFAULT_SCALE_SETTINGS;
    return file;
  })();

  it('setScaleSettingsEntry 生成合法的正向与逆向命令', () => {
    const nextSettings = {
      ...DEFAULT_SCALE_SETTINGS,
      defaultChildMode: 'visual' as const,
      childVisualRatio: 0.85,
    };
    const historyEntry = setScaleSettingsEntry(dummyFile, nextSettings);
    expect(historyEntry.label).toBe('更新缩放设置');
    expect(historyEntry.forward).toEqual([
      {
        type: 'presentation.setScaleSettings',
        payload: { settings: nextSettings },
      },
    ]);
    expect(historyEntry.inverse).toEqual([
      {
        type: 'presentation.setScaleSettings',
        payload: { settings: DEFAULT_SCALE_SETTINGS },
      },
    ]);
  });

  it('setNodeVisualScaleEntry 与 setBranchVisualScaleEntry 生成正反向命令', () => {
    const fileWithScales: BranchFile = {
      ...dummyFile,
      presentation: {
        ...dummyFile.presentation,
        nodeVisualScales: { n_1: 1.0 },
        branchVisualScales: { n_root: 1.0 },
      },
    };
    const nodeEntry = setNodeVisualScaleEntry(fileWithScales, 'n_1', 1.25);
    expect(nodeEntry.forward).toEqual([
      { type: 'presentation.setNodeVisualScale', payload: { nodeId: 'n_1', scale: 1.25 } },
    ]);
    expect(nodeEntry.inverse).toEqual([
      { type: 'presentation.setNodeVisualScale', payload: { nodeId: 'n_1', scale: 1.0 } },
    ]);

    const branchEntry = setBranchVisualScaleEntry(fileWithScales, 'n_root', 0.8);
    expect(branchEntry.forward).toEqual([
      { type: 'presentation.setVisualScale', payload: { nodeId: 'n_root', scale: 0.8 } },
    ]);
    expect(branchEntry.inverse).toEqual([
      { type: 'presentation.setVisualScale', payload: { nodeId: 'n_root', scale: 1.0 } },
    ]);

    // 未初始化的条目使用 presentation.replace 进行精确无损逆向回退
    const emptyEntry = setNodeVisualScaleEntry(dummyFile, 'n_1', 1.5);
    expect(emptyEntry.inverse[0]?.type).toBe('presentation.replace');
  });

  it('createNodeEntry 根据 scaleSettings.defaultChildMode 适配子节点缩放', () => {
    const presentation: SavedPresentation = {
      ...dummyFile.presentation,
      nodeScales: { n_root: 1.0 },
      nodeVisualScales: { n_root: 1.0 },
      scaleSettings: {
        ...DEFAULT_SCALE_SETTINGS,
        defaultChildMode: 'both',
        childLayoutStep: -0.15,
        childVisualRatio: 0.8,
      },
    };

    const entryWithBoth = createNodeEntry(
      'n_child',
      '子节点',
      'n_root',
      'e_h_1',
      presentation,
    );

    // chained presentation 命令中应包含 layout 缩放 (1.0 - 0.15 = 0.85) 与 visual 缩放 (1.0 * 0.8 = 0.8)
    const chainedCmds = entryWithBoth.chained?.forward ?? [];
    const scaleCmd = chainedCmds.find((c) => c.type === 'presentation.setNodeScale');
    const visualScaleCmd = chainedCmds.find((c) => c.type === 'presentation.setNodeVisualScale');

    expect(scaleCmd).toEqual({
      type: 'presentation.setNodeScale',
      payload: { nodeId: 'n_child', scale: 0.85 },
    });
    expect(visualScaleCmd).toEqual({
      type: 'presentation.setNodeVisualScale',
      payload: { nodeId: 'n_child', scale: 0.8 },
    });
  });
});
