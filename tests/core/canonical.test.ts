/** 06 §二 Phase 0 验收 4 / 9：规范序列化稳定、三类哈希与修订号独立。 */
import { describe, expect, it } from 'vitest';
import {
  advanceRevisions,
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
} from '@workspacetree/core';
import type { DomainState, Revisions } from '@workspacetree/schema';
import { createMinimalBranchFile } from '@workspacetree/cli';

const base = createMinimalBranchFile();

function reorderedDomain(): DomainState {
  const original = base.domain;
  return {
    archiveMeta: original.archiveMeta,
    archived: original.archived,
    projectRefs: original.projectRefs,
    blocks: original.blocks,
    spines: original.spines,
    tasks: original.tasks,
    edges: original.edges,
    nodes: original.nodes,
    project: original.project,
  };
}

const emptyRevisions: Revisions = {
  semanticRevision: 3,
  semanticHash: 'a',
  presentationRevision: 7,
  presentationHash: 'b',
  fileHash: 'c',
  fileWriteVersion: 11,
};

describe('T-04 规范序列化与三类哈希', () => {
  it('相同逻辑 DomainState 不同插入顺序输出相同 semanticHash', () => {
    expect(computeSemanticHash(reorderedDomain())).toBe(computeSemanticHash(base.domain));
  });

  it('呈现修改只改变 presentationHash，不改变 semanticHash', () => {
    const changed = {
      ...base.presentation,
      nodePositions: { n_root: { x: 10, y: 20 } },
      branchScales: { n_child: 0.45 },
    };
    expect(computePresentationHash(changed)).not.toBe(computePresentationHash(base.presentation));
    expect(computeSemanticHash(base.domain)).toBe(computeSemanticHash(reorderedDomain()));
  });

  it('归档元数据进入语义哈希', () => {
    const archived: DomainState = {
      ...base.domain,
      archived: true,
      archiveMeta: { reason: 'superseded', at: '2026-11-11T00:00:00Z', replacementBranchId: null },
    };
    expect(computeSemanticHash(archived)).not.toBe(computeSemanticHash(base.domain));
  });

  it('fileHash 排除自身字段，不产生自指', () => {
    const first = computeFileHash(base);
    const withDifferentSelf = { ...base, revisions: { ...base.revisions, fileHash: 'other' } };
    expect(computeFileHash(withDifferentSelf)).toBe(first);
  });

  it('三类修订号各自独立推进，fileWriteVersion 每次 +1', () => {
    const semantic = advanceRevisions(emptyRevisions, 'domain', 's', 'p');
    expect(semantic.semanticRevision).toBe(4);
    expect(semantic.presentationRevision).toBe(7);
    expect(semantic.fileWriteVersion).toBe(12);

    const presentation = advanceRevisions(emptyRevisions, 'presentation', 's', 'p');
    expect(presentation.semanticRevision).toBe(3);
    expect(presentation.presentationRevision).toBe(8);
    expect(presentation.fileWriteVersion).toBe(12);
  });
});
