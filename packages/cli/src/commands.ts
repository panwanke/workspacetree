/**
 * CLI 子命令：create / validate / read。
 * 与 GUI 共用同一套 Schema 与哈希契约；Phase 1+ 的写入统一走 Command Service。
 * 开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  computeFileHash,
  computePresentationHash,
  computeSemanticHash,
  migrateToCurrent,
} from '@workspacetree/core';
import {
  BranchFileSchema,
  SCHEMA_VERSION,
  type BranchFile,
  type DomainState,
} from '@workspacetree/schema';

export const FIXTURE_PROJECT_ID = 'prj_fixture_0001';

/** 最小合法样例（不是固定种子 Golden Fixture，见 06 §一.7）。 */
export function createMinimalBranchFile(): BranchFile {
  const domain: DomainState = {
    project: {
      id: FIXTURE_PROJECT_ID,
      title: 'Minimal fixture',
      rootNodeId: 'n_root',
    },
    nodes: [
      { id: 'n_root', title: 'Root', parentId: null, blockIds: [], archived: false },
      { id: 'n_child', title: 'Child', parentId: 'n_root', blockIds: [], archived: false },
    ],
    edges: [{ id: 'e_hierarchy_1', type: 'hierarchy', fromNodeId: 'n_root', toNodeId: 'n_child' }],
    tasks: [{ id: 'tsk_1', nodeId: 'n_child', title: 'Sample task', done: false }],
    spines: [{ id: 'spn_main', title: 'Main', nodeIds: ['n_root', 'n_child'] }],
    blocks: [],
    projectRefs: [],
    archived: false,
    archiveMeta: null,
  };

  const file: BranchFile = {
    schemaVersion: SCHEMA_VERSION,
    projectId: FIXTURE_PROJECT_ID,
    activeBranch: 'main',
    domain,
    presentation: {
      nodePositions: {},
      branchScales: {},
      collapsedByDefault: [],
      savedSpineDisplay: null,
    },
    revisions: {
      semanticRevision: 0,
      semanticHash: '',
      presentationRevision: 0,
      presentationHash: '',
      fileHash: '',
      fileWriteVersion: 0,
    },
  };
  file.revisions.semanticHash = computeSemanticHash(file.domain);
  file.revisions.presentationHash = computePresentationHash(file.presentation);
  file.revisions.fileHash = computeFileHash(file);
  return file;
}

function flag(args: string[], name: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function loadBranchFile(path: string): Promise<BranchFile> {
  const raw = await readFile(path, 'utf8');
  return BranchFileSchema.parse(migrateToCurrent(JSON.parse(raw)));
}

export async function runCli(args: string[]): Promise<string> {
  const [command, ...rest] = args;
  switch (command) {
    case 'create': {
      const out = flag(rest, 'out');
      const file = createMinimalBranchFile();
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      return `created ${out} (schemaVersion=${file.schemaVersion}, semanticHash=${file.revisions.semanticHash.slice(0, 12)}...)`;
    }
    case 'validate': {
      const file = await loadBranchFile(flag(rest, 'in'));
      return `OK: ${file.projectId} is a valid branch file (schemaVersion=${file.schemaVersion})`;
    }
    case 'read': {
      const file = await loadBranchFile(flag(rest, 'in'));
      return [
        `projectId      : ${file.projectId}`,
        `activeBranch   : ${file.activeBranch}`,
        `nodes / tasks  : ${file.domain.nodes.length} / ${file.domain.tasks.length}`,
        `semanticHash   : ${file.revisions.semanticHash}`,
        `presentationRev: ${file.revisions.presentationRevision}`,
        `fileWriteVer   : ${file.revisions.fileWriteVersion}`,
      ].join('\n');
    }
    default:
      throw new Error('usage: create --out <path> | validate --in <path> | read --in <path>');
  }
}
