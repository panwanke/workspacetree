import { describe, expect, it } from 'vitest';
import {
  computeFileHash,
  computeSemanticHash,
  migrateTasksV1ToV2,
  migrateToCurrent,
} from '@workspacetree/core';
import { BranchFileSchema } from '@workspacetree/schema';

describe('Markdown 与数据版本迁移 (v1 -> v2)', () => {
  it('migrateTasksV1ToV2 正确转换标记并跳过代码围栏', () => {
    const v1Markdown = [
      '- [*] 已完成任务',
      '  1. [\\*] 转义星号完成',
      '- [x] 旧废弃任务小写',
      '- [X] 旧废弃任务大写',
      '+ [?] 待定任务保持不变',
      '- [ ] 未完成保持不变',
      '> - [*] Callout 内部完成任务 #tag 📅 2026-11-20',
      '```',
      '- [*] 围栏内不应被转换',
      '- [x] 围栏内不应被转换',
      '```',
      '行内文字 `[*] 与 [x]` 也不变',
    ].join('\n');

    const migrated = migrateTasksV1ToV2(v1Markdown);

    expect(migrated).toContain('- [x] 已完成任务');
    expect(migrated).toContain('  1. [x] 转义星号完成');
    expect(migrated).toContain('- [-] 旧废弃任务小写');
    expect(migrated).toContain('- [-] 旧废弃任务大写');
    expect(migrated).toContain('+ [?] 待定任务保持不变');
    expect(migrated).toContain('- [ ] 未完成保持不变');
    expect(migrated).toContain('> - [x] Callout 内部完成任务 #tag 📅 2026-11-20');
    // 代码块内保持不变
    expect(migrated).toContain('```\n- [*] 围栏内不应被转换\n- [x] 围栏内不应被转换\n```');
    expect(migrated).toContain('行内文字 `[*] 与 [x]` 也不变');
  });

  it('完整 BranchFile 从 v1 升级至 v2：blocks 文本迁移、tasks 归一、初始化 assets 并重算哈希', () => {
    const v1File = {
      schemaVersion: 1,
      projectId: 'prj_migration_test',
      activeBranch: 'main',
      domain: {
        project: {
          id: 'prj_migration_test',
          title: '迁移测试项目',
          rootNodeId: 'n_root',
        },
        nodes: [
          { id: 'n_root', title: '根节点', parentId: null, blockIds: ['blk_1'], archived: false },
        ],
        edges: [],
        tasks: [
          { id: 'tsk_1', nodeId: 'n_root', title: '旧完成任务', done: true },
          { id: 'tsk_2', nodeId: 'n_root', title: '旧废弃任务', done: false, status: 'discarded' },
          { id: 'tsk_3', nodeId: 'n_root', title: '旧待定任务', done: false, status: 'pending' },
        ],
        spines: [],
        blocks: [
          {
            id: 'blk_1',
            kind: 'text',
            payload: {
              markdown: '# 笔记\n- [*] 完成项\n- [x] 废弃项\n- [?] 待定项',
            },
          },
        ],
        projectRefs: [],
        archived: false,
        archiveMeta: null,
      },
      presentation: {
        nodePositions: { n_root: { x: 0, y: 0 } },
        branchScales: {},
        collapsedByDefault: [],
        savedSpineDisplay: null,
      },
      revisions: {
        semanticRevision: 1,
        semanticHash: 'old_semantic',
        presentationRevision: 1,
        presentationHash: 'old_presentation',
        fileHash: 'old_file',
        fileWriteVersion: 1,
      },
    };

    const migrated = migrateToCurrent(v1File) as any;

    // schemaVersion 升级到 2
    expect(migrated.schemaVersion).toBe(2);

    // 文本块已转成 v2 语法
    expect(migrated.domain.blocks[0].payload.markdown).toBe(
      '# 笔记\n- [x] 完成项\n- [-] 废弃项\n- [?] 待定项',
    );

    // 结构化 tasks 状态一致性：停用/废弃/待定统一 done=false
    expect(migrated.domain.tasks[0]).toEqual({
      id: 'tsk_1',
      nodeId: 'n_root',
      title: '旧完成任务',
      done: true,
    });
    expect(migrated.domain.tasks[1]).toEqual({
      id: 'tsk_2',
      nodeId: 'n_root',
      title: '旧废弃任务',
      done: false,
      status: 'discarded',
    });
    expect(migrated.domain.tasks[2]).toEqual({
      id: 'tsk_3',
      nodeId: 'n_root',
      title: '旧待定任务',
      done: false,
      status: 'pending',
    });

    // 包含 assets 字典
    expect(migrated.domain.assets).toBeDefined();

    // 能够通过 BranchFileSchema 校验
    const parsed = BranchFileSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);

    // 哈希自洽性校验
    expect(migrated.revisions.semanticHash).toBe(computeSemanticHash(migrated.domain));
    expect(migrated.revisions.fileHash).toBe(computeFileHash(migrated));
  });

  it('同一文件重复迁移具有幂等性，不产生多余变更或错误哈希', () => {
    const v2File = {
      schemaVersion: 2,
      projectId: 'prj_idempotent',
      activeBranch: 'main',
      domain: {
        project: {
          id: 'prj_idempotent',
          title: '幂等项目',
          rootNodeId: 'n_root',
        },
        nodes: [
          { id: 'n_root', title: '根节点', parentId: null, blockIds: ['blk_1'], archived: false },
        ],
        edges: [],
        tasks: [
          { id: 'tsk_paused', nodeId: 'n_root', title: '暂停任务', done: false, status: 'paused' },
        ],
        spines: [],
        blocks: [
          {
            id: 'blk_1',
            kind: 'text',
            payload: { markdown: '- [x] 已完成\n- [-] 废弃\n- [~] 停用' },
          },
        ],
        projectRefs: [],
        assets: {},
        archived: false,
        archiveMeta: null,
      },
      presentation: {
        nodePositions: {},
        branchScales: {},
        collapsedByDefault: [],
        savedSpineDisplay: null,
      },
      revisions: {
        semanticRevision: 2,
        semanticHash: 'hash',
        presentationRevision: 1,
        presentationHash: 'hash',
        fileHash: 'hash',
        fileWriteVersion: 2,
      },
    };

    const first = migrateToCurrent(v2File);
    const second = migrateToCurrent(first);
    expect(second).toEqual(first);
  });
});
