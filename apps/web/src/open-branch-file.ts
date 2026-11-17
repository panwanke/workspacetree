import {
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  migrateToCurrent,
  validateDomain,
  validatePresentation,
} from '@workspacetree/core';
import { resolveLayoutDirection } from '@workspacetree/layout';
import { BranchFileSchema, type BranchFile } from '@workspacetree/schema';
import type { ProjectStorePort } from './project-store';

export function branchSnapshotHash(file: BranchFile): string {
  const presentation = {
    ...file.presentation,
    layoutDirection: resolveLayoutDirection(file.presentation),
  };
  return computeFileHash({
    ...file,
    presentation,
    revisions: {
      ...file.revisions,
      semanticHash: computeSemanticHash(file.domain),
      presentationHash: computePresentationHash(presentation),
    },
  });
}

export function parseBranchFile(name: string, content: string): BranchFile {
  try {
    if (!name.toLowerCase().endsWith('.json')) throw new Error('Expected a .branch.json file');
    const raw: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    const parsed = BranchFileSchema.safeParse(migrateToCurrent(raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${issue.path.join('.')}: ${issue.message}`);
    }
    const file = parsed.data;
    if (file.projectId !== file.domain.project.id) throw new Error('Project IDs do not match');
    validateDomain(file.domain);
    validatePresentation({
      ...file.presentation,
      layoutDirection: file.presentation.layoutDirection ?? undefined,
    });
    const checked = {
      ...file,
      revisions: {
        ...file.revisions,
        semanticHash: computeSemanticHash(file.domain),
        presentationHash: computePresentationHash(file.presentation),
        fileHash: '',
      },
    };
    checked.revisions.fileHash = computeFileHash(checked);
    return checked;
  } catch (cause) {
    throw branchFileError(name, cause);
  }
}

function branchFileError(name: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${name}: ${reason}`, { cause });
}

export async function openBranchFile(
  input: Pick<File, 'name' | 'text'>,
  storage: Pick<ProjectStorePort, 'createIfAbsent'>,
): Promise<{ file: BranchFile; readOnly: boolean; snapshotHash: string }> {
  let content;
  try {
    content = await input.text();
  } catch (cause) {
    throw branchFileError(input.name, cause);
  }
  const file = parseBranchFile(input.name, content);
  const snapshotHash = branchSnapshotHash(file);
  try {
    const persisted = await storage.createIfAbsent(file);
    const readOnly = branchSnapshotHash(persisted) !== snapshotHash;
    return { file: readOnly ? file : persisted, readOnly, snapshotHash };
  } catch (cause) {
    throw branchFileError(input.name, cause);
  }
}
