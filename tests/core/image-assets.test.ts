import { describe, expect, it } from 'vitest';
import { applyCommand, ValidationError } from '@workspacetree/core';
import type { AssetRecord, CommandEnvelope } from '@workspacetree/schema';
import { createMinimalBranchFile } from '@workspacetree/cli';
import { setNodeNoteEntry } from '../../apps/web/src/history.js';
import { transferBranch } from '../../apps/web/src/branch-editing.js';
import { computeAssetId, createAssetRecord } from '../../apps/web/src/images/image-assets.js';

function makeEnvelope(command: CommandEnvelope['command'], id = 'op_asset_1'): CommandEnvelope {
  return {
    operationId: id,
    projectId: 'prj_fixture_0001',
    stateClass: 'domain',
    expectedRevision: 0,
    actor: { kind: 'human', id: 'tester' },
    command,
  };
}

describe('阶段 3: 图片资产领域契约与管理 (tests/core/image-assets.test.ts)', () => {
  const sampleAsset: AssetRecord = {
    mime: 'image/png',
    byteLength: 1024,
    width: 200,
    height: 150,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  it('asset.put: 向 domain.assets 添加资产，严格校验 schema', () => {
    const file = createMinimalBranchFile();
    const env = makeEnvelope({
      type: 'asset.put',
      payload: { id: 'sha256_test1', asset: sampleAsset },
    });

    const result = applyCommand(file.domain, file.presentation, env);
    expect(result.domain.assets).toBeDefined();
    expect(result.domain.assets?.['sha256_test1']).toEqual(sampleAsset);
    expect(result.commit).not.toBeNull();

    // 校验失败（缺失必填字段）
    const invalidEnv = makeEnvelope({
      type: 'asset.put',
      payload: { id: 'sha256_invalid', asset: { mime: 'image/png' } },
    });
    expect(() => applyCommand(file.domain, file.presentation, invalidEnv)).toThrow(ValidationError);
  });

  it('asset.remove: 从 domain.assets 移除指定资产', () => {
    const file = createMinimalBranchFile();
    file.domain.assets = {
      sha256_to_remove: sampleAsset,
      sha256_to_keep: sampleAsset,
    };

    const env = makeEnvelope({
      type: 'asset.remove',
      payload: { id: 'sha256_to_remove' },
    });
    const result = applyCommand(file.domain, file.presentation, env);
    expect(result.domain.assets?.['sha256_to_remove']).toBeUndefined();
    expect(result.domain.assets?.['sha256_to_keep']).toBeDefined();
  });

  it('node.setNoteWithAssets: 原子提交笔记和关联资产', () => {
    const file = createMinimalBranchFile();
    const nodeId = file.domain.nodes[0]!.id;
    const noteText = '# 测试\n![图片](asset:sha256_test1)';

    const env = makeEnvelope({
      type: 'node.setNoteWithAssets',
      payload: {
        id: nodeId,
        markdown: noteText,
        assets: { sha256_test1: sampleAsset },
      },
    });

    const result = applyCommand(file.domain, file.presentation, env);
    expect(result.domain.assets?.['sha256_test1']).toEqual(sampleAsset);
    const node = result.domain.nodes.find((n) => n.id === nodeId);
    const block = result.domain.blocks.find((b) => node?.blockIds.includes(b.id));
    expect(block?.payload).toEqual({ markdown: noteText });
  });

  it('setNodeNoteEntry: 生成带反向资产清理的历史记录', () => {
    const file = createMinimalBranchFile();
    const nodeId = file.domain.nodes[0]!.id;
    const noteText = '![图片](asset:sha256_test1)';

    const historyEntry = setNodeNoteEntry(file.domain, nodeId, noteText, {
      sha256_test1: sampleAsset,
    });

    expect(historyEntry.forward).toHaveLength(1);
    expect(historyEntry.forward[0]?.type).toBe('node.setNoteWithAssets');

    // 反向命令包含恢复原笔记以及删除新增的资产
    expect(historyEntry.inverse).toHaveLength(2);
    expect(historyEntry.inverse[0]?.type).toBe('node.setNote');
    expect(historyEntry.inverse[1]?.type).toBe('asset.remove');
    expect(historyEntry.inverse[1]?.payload).toEqual({ id: 'sha256_test1' });
  });

  it('transferBranch: 跨项目分支转移时完整复制 Markdown 所引用的资产', () => {
    const sourceFile = createMinimalBranchFile();
    const targetFile = createMinimalBranchFile();
    const childId = 'n_child';
    const assetId = 'sha256_referenced';

    const noteEnv = makeEnvelope({
      type: 'node.setNoteWithAssets',
      payload: {
        id: childId,
        markdown: `包含了图片: ![图](asset:${assetId}){width=80%}`,
        assets: { [assetId]: sampleAsset },
      },
    });
    const step = applyCommand(sourceFile.domain, sourceFile.presentation, noteEnv);
    sourceFile.domain = step.domain;
    sourceFile.domain.assets = {
      ...sourceFile.domain.assets,
      sha256_unreferenced: sampleAsset,
    };

    const result = transferBranch(sourceFile, targetFile, childId, 'n_root', 'timeline');
    const targetPayload = result.receive.forward[0]?.payload as { domain: typeof targetFile.domain } | undefined;
    const targetDomain = targetPayload?.domain;

    // 目标项目应只复制被引用的资产，未引用的不复制
    expect(targetDomain?.assets?.[assetId]).toEqual(sampleAsset);
    expect(targetDomain?.assets?.['sha256_unreferenced']).toBeUndefined();
  });

  it('同一图片二进制内容去重计算相同的 SHA-256 ID', () => {
    const bytes1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const bytes2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const id1 = computeAssetId(bytes1);
    const id2 = computeAssetId(bytes2);
    expect(id1).toBe(id2);

    const rec1 = createAssetRecord(bytes1, 'image/png', 100, 100);
    const rec2 = createAssetRecord(bytes2, 'image/png', 100, 100);
    expect(rec1.id).toBe(rec2.id);
    expect(rec1.record.base64).toBe(rec2.record.base64);
  });
});
