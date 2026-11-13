import { describe, expect, it } from 'vitest';
import {
  formatKeyboardEventToKeybinding,
  isEventMatchingKeybinding,
  loadKeybindings,
  saveKeybindings,
} from '../../apps/web/src/keybindings.js';

describe('keybindings matching & formatting', () => {
  it('正确匹配单键 Delete 与 Backspace', () => {
    const deleteEvent = { key: 'Delete' };
    const backspaceEvent = { key: 'Backspace' };
    const enterEvent = { key: 'Enter' };

    expect(isEventMatchingKeybinding(deleteEvent, 'Delete')).toBe(true);
    expect(isEventMatchingKeybinding(backspaceEvent, 'Delete')).toBe(true);
    expect(isEventMatchingKeybinding(enterEvent, 'Delete')).toBe(false);
  });

  it('正确匹配组合键 Ctrl+Z 与 Ctrl+Y', () => {
    const ctrlZ = { key: 'z', ctrlKey: true };
    const metaZ = { key: 'Z', metaKey: true };
    const justZ = { key: 'z' };

    expect(isEventMatchingKeybinding(ctrlZ, 'Ctrl+Z')).toBe(true);
    expect(isEventMatchingKeybinding(metaZ, 'Ctrl+Z')).toBe(true);
    expect(isEventMatchingKeybinding(justZ, 'Ctrl+Z')).toBe(false);
  });

  it('正确匹配单字母快捷键 r / f', () => {
    const rEvent = { key: 'r' };
    const capREvent = { key: 'R' };
    const ctrlREvent = { key: 'r', ctrlKey: true };

    expect(isEventMatchingKeybinding(rEvent, 'r')).toBe(true);
    expect(isEventMatchingKeybinding(capREvent, 'r')).toBe(true);
    expect(isEventMatchingKeybinding(ctrlREvent, 'r')).toBe(false);
  });

  it('将按键事件格式化为可读字符串', () => {
    expect(formatKeyboardEventToKeybinding({ key: 'Control' })).toBe(null);
    expect(formatKeyboardEventToKeybinding({ key: 'd', ctrlKey: true })).toBe('Ctrl+D');
    expect(formatKeyboardEventToKeybinding({ key: 'Delete' })).toBe('Delete');
  });

  it('支持读取与重置默认快捷键并保存', () => {
    const keys = loadKeybindings();
    expect(keys.deleteNode).toBe('Delete');
    expect(keys.addRandomBranch).toBe('r');
    expect(keys.saveBranch).toBe('Ctrl+S');
    expect(isEventMatchingKeybinding({ key: 's', ctrlKey: true }, keys.saveBranch)).toBe(true);
    saveKeybindings({ ...keys, deleteNode: 'Backspace' });
  });
});
