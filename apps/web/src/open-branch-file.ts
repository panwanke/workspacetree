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

export async function openBranchFile(
  input: Pick<File, 'name' | 'text'>,
  storage: Pick<ProjectStorePort, 'createIfAbsent'>,
): Promise<{ file: BranchFile; readOnly: boolean; snapshotHash: string }> {
  try {
    if (!input.name.toLowerCase().endsWith('.json'))
      throw new Error('Expected a .branch.json file');
    const raw: unknown = JSON.parse((await input.text()).replace(/^\uFEFF/, ''));
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
    const snapshotHash = branchSnapshotHash(file);
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
    const persisted = await storage.createIfAbsent(checked);
    const readOnly = branchSnapshotHash(persisted) !== snapshotHash;
    return { file: readOnly ? file : persisted, readOnly, snapshotHash };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${input.name}: ${reason}`, { cause });
  }
}
