/** 06 §二 Phase 0 验收 3 / 12 / 任务 2：11 个中性 Schema、JSON Schema 产物、schemaVersion 迁移。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateToCurrent, SchemaMigrationError } from '@workspacetree/core';
import {
  BranchFileSchema,
  CommandEnvelopeSchema,
  DomainStateSchema,
  EdgeStyleSchema,
  SCHEMA_VERSION,
  SessionViewSchema,
} from '@workspacetree/schema';
import { createMinimalBranchFile } from '@workspacetree/cli';

const generatedPath = resolve(process.cwd(), 'packages/schema/generated/schemas.json');

function readGenerated(): { $defs: Record<string, unknown> } {
  return JSON.parse(readFileSync(generatedPath, 'utf8')) as { $defs: Record<string, unknown> };
}

describe('T-01 中性 Zod Schema', () => {
  it('最小 .branch.json 能被 BranchFileSchema 解析', () => {
    const file = createMinimalBranchFile();
    expect(BranchFileSchema.parse(file)).toEqual(file);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('DomainState 拒绝缺少 project 的非法输入', () => {
    expect(() => DomainStateSchema.parse({ nodes: [] })).toThrow();
  });

  it('Command Envelope 拒绝缺字段 / 未知命令域', () => {
    expect(() => CommandEnvelopeSchema.parse({ operationId: 'op_1' })).toThrow();
    const bad = {
      operationId: 'op_1',
      projectId: 'prj_1',
      stateClass: 'domain',
      expectedRevision: 0,
      actor: { kind: 'human', id: 'tester' },
      command: { type: 'unknown.action', payload: {} },
    };
    expect(() => CommandEnvelopeSchema.parse(bad)).toThrow();
    expect(
      SessionViewSchema.parse({
        pan: { x: 0, y: 0 },
        zoom: 1,
        selection: [],
        highlightSpineId: null,
      }),
    ).toBeTruthy();
  });
});

describe('T-02 自动生成的 JSON Schema', () => {
  it('包含 11 个契约 Schema + Envelope + BranchFile', () => {
    const defs = readGenerated().$defs;
    for (const name of [
      'Project',
      'Node',
      'Edge',
      'Task',
      'Spine',
      'DomainState',
      'SavedPresentation',
      'SessionView',
      'Command',
      'Operation',
      'Commit',
      'CommandEnvelope',
      'BranchFile',
    ]) {
      expect(Object.keys(defs)).toContain(name);
    }
  });

  it('生成的 Schema 不包含产品展示名称', () => {
    const raw = readFileSync(generatedPath, 'utf8');
    expect(raw).not.toContain('WorkspaceTree');
  });
});

describe('T-03 schemaVersion 迁移', () => {
  it('当前版本原样返回，不丢未知字段', () => {
    const input = { schemaVersion: SCHEMA_VERSION, customField: 'keep-me' };
    expect(migrateToCurrent(input)).toEqual(input);
  });

  it('未来版本 / 缺失版本明确拒绝', () => {
    expect(() => migrateToCurrent({ schemaVersion: SCHEMA_VERSION + 999 })).toThrow(
      SchemaMigrationError,
    );
    expect(() => migrateToCurrent({})).toThrow(SchemaMigrationError);
  });

  it('v2 迁移到 v4 初始化 edgeStyles / visualScales 并保留未知字段', () => {
    const input = {
      schemaVersion: 2,
      presentation: { customView: 'keep-me' },
      customRoot: 'keep-root',
    };
    const migrated = migrateToCurrent(input) as Record<string, any>;
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.presentation.edgeStyles).toEqual({});
    expect(migrated.presentation.branchVisualScales).toEqual({});
    expect(migrated.presentation.nodeVisualScales).toEqual({});
    expect(migrated.presentation.customView).toBe('keep-me');
    expect(migrated.customRoot).toBe('keep-root');
  });

  it('v3 迁移到 v4 初始化 branchVisualScales 与 nodeVisualScales', () => {
    const input = {
      schemaVersion: 3,
      presentation: { branchScales: { n_1: 0.8 }, nodeScales: { n_1: 1.2 } },
    };
    const migrated = migrateToCurrent(input) as Record<string, any>;
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.presentation.branchScales).toEqual({ n_1: 0.8 });
    expect(migrated.presentation.nodeScales).toEqual({ n_1: 1.2 });
    expect(migrated.presentation.branchVisualScales).toEqual({});
    expect(migrated.presentation.nodeVisualScales).toEqual({});
  });

  it('EdgeStyle 约束颜色、宽度和枚举', () => {
    expect(
      EdgeStyleSchema.safeParse({
        color: '#123abc',
        width: 3,
        lineStyle: 'dotted',
        arrow: 'both',
      }).success,
    ).toBe(true);
    expect(EdgeStyleSchema.safeParse({ color: '#fff' }).success).toBe(false);
    expect(EdgeStyleSchema.safeParse({ width: 20 }).success).toBe(false);
    expect(EdgeStyleSchema.safeParse({ arrow: 'sideways' }).success).toBe(false);
  });
});
