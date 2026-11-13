/**
 * 06 §二 Phase 0 验收 18（T-23）：固定种子 Golden Fixture 可复现、结构完整、三类哈希自洽。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  validateDomain,
} from '@workspacetree/core';
import { BranchFileSchema } from '@workspacetree/schema';
import { createGoldenBranchFile, GOLDEN_SEED } from '../support/generate-golden';

describe('T-23 固定种子 Golden Fixture', () => {
  it('同一种子输出逐字节一致，不同种子产生不同布局', () => {
    const a = createGoldenBranchFile(GOLDEN_SEED);
    const b = createGoldenBranchFile(GOLDEN_SEED);
    const c = createGoldenBranchFile(GOLDEN_SEED + 1);
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).not.toBe(canonicalize(c));
  });

  it('通过 Zod Schema 且三类哈希自洽', () => {
    const file = createGoldenBranchFile();
    expect(BranchFileSchema.safeParse(file).success).toBe(true);
    expect(file.revisions.semanticHash).toBe(computeSemanticHash(file.domain));
    expect(file.revisions.presentationHash).toBe(computePresentationHash(file.presentation));
    expect(file.revisions.fileHash).toBe(computeFileHash(file));
  });

  it('含论文总项目、WPT/PDD 子项目引用、多主干、任务、跨边、归档及缩放分支', () => {
    const file = createGoldenBranchFile();
    expect(file.domain.project.rootNodeId).toBe('n_thesis');
    expect(file.domain.projectRefs.map((ref) => ref.projectId)).toEqual([
      'prj_wpt_sub',
      'prj_pdd_sub',
    ]);
    expect(file.domain.nodes.filter((node) => node.id.startsWith('n_wpt')).length).toBeGreaterThan(
      2,
    );
    expect(file.domain.nodes.filter((node) => node.id.startsWith('n_pdd')).length).toBeGreaterThan(
      1,
    );
    expect(file.domain.spines).toHaveLength(3);
    for (const spine of file.domain.spines) {
      expect(spine.nodeIds.slice(0, 2)).toEqual(['n_thesis', 'n_theory']);
    }
    expect(file.domain.tasks.filter((task) => task.nodeId?.startsWith('n_wpt'))).toHaveLength(4);
    expect(file.domain.edges.filter((edge) => edge.type !== 'hierarchy').length).toBeGreaterThan(3);
    expect(file.domain.nodes.some((node) => node.archived)).toBe(true);
    expect(Object.keys(file.presentation.branchScales).length).toBeGreaterThan(0);
  });

  it('归档与缩放分离：归档节点不是被缩放分支，项目本身未归档', () => {
    const file = createGoldenBranchFile();
    const archivedIds = file.domain.nodes.filter((node) => node.archived).map((node) => node.id);
    expect(file.domain.archived).toBe(false);
    expect(archivedIds).toEqual(['n_legacy_theory']);
    expect(file.presentation.branchScales.n_wpt).toBe(0.45);
    expect(file.presentation.branchScales.n_legacy_theory).not.toBe(0.45);
  });

  it('落盘 fixture 与生成器输出一致', () => {
    const raw = readFileSync(resolve(process.cwd(), 'tests/fixtures/golden.branch.json'), 'utf8');
    expect(canonicalize(JSON.parse(raw))).toBe(canonicalize(createGoldenBranchFile()));
  });

  it('3 条主干共享前缀、由连续层级边构成，且整份 fixture 通过图校验', () => {
    const file = createGoldenBranchFile();
    const parents = new Map(
      file.domain.edges
        .filter((edge) => edge.type === 'hierarchy')
        .map((edge) => [edge.toNodeId, edge.fromNodeId]),
    );
    for (const spine of file.domain.spines) {
      expect(spine.nodeIds.slice(0, 2)).toEqual(['n_thesis', 'n_theory']);
      for (let index = 1; index < spine.nodeIds.length; index += 1) {
        expect(parents.get(spine.nodeIds[index]!)).toBe(spine.nodeIds[index - 1]!);
      }
    }
    expect(() => validateDomain(file.domain)).not.toThrow();
  });
});
