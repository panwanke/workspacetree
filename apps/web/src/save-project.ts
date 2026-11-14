import { FILE_SUFFIX, type BranchFile } from '@workspacetree/schema';

/**
 * 清洗文件名，去除 Windows / Linux / macOS 不允许的文件名字符
 */
export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  return sanitized.length > 0 ? sanitized : 'project';
}

/**
 * 获取项目默认建议保存的文件名（如 "博士论文 · 研究与写作全流程.branch.json"）
 */
export function getProjectSuggestedFilename(file: BranchFile): string {
  const title = file.domain.project.title?.trim();
  const base = sanitizeFilename(title || file.projectId);
  return `${base}${FILE_SUFFIX.project}`;
}

export function hasNativeSavePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  );
}

/**
 * 触发浏览器底层下载
 */
export function triggerDownload(
  filename: string,
  content: string,
  mime = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SaveProjectResult =
  | { success: true; filename: string; method: 'picker' | 'download' }
  | { success: false; aborted: true }
  | { success: false; error: string };

/**
 * 保存项目文件：
 * 优先调用浏览器原生 File System Access API (showSaveFilePicker)，唤起系统原生「另存为」弹窗，
 * 允许用户自由选择磁盘保存目录（改位置）并自定义文件名（重命名）；
 * 若环境不支持或报错，则降级为由调用方打开保存弹窗或执行直接下载。
 */
export async function saveProjectWithNativePicker(
  file: BranchFile,
  customFilename?: string,
): Promise<SaveProjectResult | { fallbackNeeded: true }> {
  if (!hasNativeSavePicker()) {
    return { fallbackNeeded: true };
  }

  const defaultName = getProjectSuggestedFilename(file);
  let suggestedName = customFilename ? sanitizeFilename(customFilename) : defaultName;
  if (!suggestedName.endsWith(FILE_SUFFIX.project)) {
    suggestedName = `${suggestedName}${FILE_SUFFIX.project}`;
  }

  const content = `${JSON.stringify(file, null, 2)}\n`;

  try {
    const picker = (
      window as unknown as {
        showSaveFilePicker: (options: {
          suggestedName: string;
          types: Array<{
            description: string;
            accept: Record<string, string[]>;
          }>;
        }) => Promise<{
          name?: string;
          createWritable: () => Promise<{
            write: (data: string) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;

    const handle = await picker({
      suggestedName,
      types: [
        {
          description: 'WorkspaceTree 分支项目文件 (*.branch.json)',
          accept: {
            'application/json': ['.branch.json', '.json'],
          },
        },
      ],
    });

    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();

    return {
      success: true,
      filename: handle.name || suggestedName,
      method: 'picker',
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      return { success: false, aborted: true };
    }
    console.warn('Native showSaveFilePicker failed, needs fallback:', err);
    return { fallbackNeeded: true };
  }
}
