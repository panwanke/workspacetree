import type { StorageAdapter } from '@workspacetree/core';
import type { BranchFile } from '@workspacetree/schema';
import { parseBranchFile } from './open-branch-file';

interface WritableBranchFile {
  name: string;
  getFile(): Promise<Pick<File, 'text'>>;
  createWritable(options: FileSystemCreateWritableOptions & { mode: 'exclusive' }): Promise<{
    write(content: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

export class LinkedFileChangedError extends Error {
  constructor() {
    super('The linked project file changed on disk before the edit could be saved.');
  }
}

export class LinkedBranchFile implements StorageAdapter {
  private constructor(
    private readonly handle: WritableBranchFile,
    private content: string,
    private file: BranchFile,
  ) {}

  static async open(handle: WritableBranchFile): Promise<LinkedBranchFile> {
    const content = await (await handle.getFile()).text();
    return new LinkedBranchFile(handle, content, parseBranchFile(handle.name, content));
  }

  get snapshot(): BranchFile {
    return this.file;
  }

  async load(projectId: string): Promise<BranchFile | null> {
    return projectId === this.file.projectId ? this.file : null;
  }

  async refresh(canApply: () => boolean): Promise<BranchFile | null> {
    const content = await this.readText();
    if (content === this.content) return null;
    const file = parseBranchFile(this.handle.name, content);
    if (file.projectId !== this.file.projectId) {
      throw new Error('The linked file now contains a different project.');
    }
    if (file.revisions.fileHash === this.file.revisions.fileHash) {
      this.content = content;
      return null;
    }
    if (!canApply()) throw new LinkedFileChangedError();
    this.content = content;
    this.file = file;
    return file;
  }

  async save(file: BranchFile): Promise<void> {
    if (file.projectId !== this.file.projectId) throw new Error('Project IDs do not match.');
    await this.assertUnchanged();
    const content = `${JSON.stringify(file, null, 2)}\n`;
    const writable = await this.handle.createWritable({ mode: 'exclusive' });
    try {
      await writable.write(content);
      // The browser stages writes until close. Verify the original again before publishing.
      await this.assertUnchanged();
      await writable.close();
    } catch (cause) {
      await writable.abort().catch(() => {});
      throw cause;
    }
    this.content = content;
    this.file = file;
  }

  private async readText(): Promise<string> {
    return (await this.handle.getFile()).text();
  }

  private async assertUnchanged(): Promise<void> {
    if ((await this.readText()) !== this.content) throw new LinkedFileChangedError();
  }
}
