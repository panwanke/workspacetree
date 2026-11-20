import { describe, expect, it, vi, afterEach } from 'vitest';
import { createMinimalBranchFile } from '@workspacetree/cli';
import {
  getProjectSuggestedFilename,
  hasNativeSavePicker,
  sanitizeFilename,
  saveProjectWithNativePicker,
} from '../../apps/web/src/save-project';

describe('save-project utilities', () => {
  it('sanitizes filename and replaces invalid OS characters', () => {
    expect(sanitizeFilename('my/project:name*test?')).toBe('my_project_name_test');
    expect(sanitizeFilename('  valid-name  ')).toBe('valid-name');
    expect(sanitizeFilename(':::***???///')).toBe('project');
    expect(sanitizeFilename('')).toBe('project');
  });

  it('generates suggested filename with .branch.json suffix', () => {
    const file = createMinimalBranchFile();
    file.domain.project.title = '测试研究/方案1';
    expect(getProjectSuggestedFilename(file)).toBe('测试研究_方案1.branch.json');

    file.domain.project.title = '';
    file.projectId = 'prj_abc123';
    expect(getProjectSuggestedFilename(file)).toBe('prj_abc123.branch.json');
  });

  describe('native save file picker', () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
      globalThis.window = originalWindow;
    });

    it('returns fallbackNeeded when showSaveFilePicker is missing', async () => {
      const file = createMinimalBranchFile();
      const result = await saveProjectWithNativePicker(file);
      expect(result).toEqual({ fallbackNeeded: true });
    });

    it('writes content and returns success when native picker succeeds', async () => {
      const written: string[] = [];
      const mockWritable = {
        write: vi.fn(async (data: string) => {
          written.push(data);
        }),
        close: vi.fn(async () => {}),
      };
      const mockHandle = {
        name: 'custom-export.branch.json',
        createWritable: vi.fn(async () => mockWritable),
      };
      const mockShowSaveFilePicker = vi.fn(async () => mockHandle);

      Object.defineProperty(globalThis, 'window', {
        value: {
          showSaveFilePicker: mockShowSaveFilePicker,
        },
        writable: true,
        configurable: true,
      });

      expect(hasNativeSavePicker()).toBe(true);

      const file = createMinimalBranchFile();
      file.domain.project.title = '论文分析';
      const result = await saveProjectWithNativePicker(file, '论文分析-v2');

      expect(mockShowSaveFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestedName: '论文分析-v2.branch.json',
        }),
      );
      expect(mockWritable.write).toHaveBeenCalled();
      expect(mockWritable.close).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        filename: 'custom-export.branch.json',
        method: 'picker',
      });
    });

    it('returns aborted when user cancels native picker', async () => {
      const abortError = new Error('User aborted');
      abortError.name = 'AbortError';

      Object.defineProperty(globalThis, 'window', {
        value: {
          showSaveFilePicker: vi.fn(async () => {
            throw abortError;
          }),
        },
        writable: true,
        configurable: true,
      });

      const file = createMinimalBranchFile();
      const result = await saveProjectWithNativePicker(file);
      expect(result).toEqual({ success: false, aborted: true });
    });
  });
});
