/** 06 §二 Phase 0 验收 1 / 12：创建合法 .branch.json、保存 / 读回同一 DomainState；CLI smoke。 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalize, CommandService } from '@workspacetree/core';
import { BranchFileSchema } from '@workspacetree/schema';
import { FileStorageAdapter } from '@workspacetree/storage';
import { createMinimalBranchFile, runCli } from '@workspacetree/cli';

const tempDir = await mkdtemp(join(tmpdir(), 'wst-loop-'));
const target = join(tempDir, 'minimal.branch.json');
afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('T-14 文件读写回环', () => {
  it('新建实例读回的 DomainState 与写入时语义一致', async () => {
    const writer = new FileStorageAdapter(tempDir);
    const file = createMinimalBranchFile();
    await writer.save(file);
    const reader = new FileStorageAdapter(tempDir);
    const loaded = await reader.load(file.projectId);
    expect(loaded).not.toBeNull();
    expect(canonicalize(loaded!.domain)).toBe(canonicalize(file.domain));
    expect(loaded!.revisions.fileHash).toBe(file.revisions.fileHash);
  });

  it('经 Command Service 的一次语义写入可持久化并重开', async () => {
    const writer = new FileStorageAdapter(tempDir);
    const file = createMinimalBranchFile();
    await writer.save(file);
    const service = new CommandService(writer);
    await service.execute({
      operationId: 'op_loop_domain',
      projectId: file.projectId,
      stateClass: 'domain',
      expectedRevision: 0,
      actor: { kind: 'human', id: 'tester' },
      command: { type: 'node.add', payload: { id: 'n_loop', title: 'Persisted node' } },
    });
    const reader = new FileStorageAdapter(tempDir);
    const loaded = await reader.load(file.projectId);
    expect(loaded!.domain.nodes.map((node) => node.id)).toContain('n_loop');
    expect(loaded!.revisions.semanticRevision).toBe(1);
  });
});

describe('T-15 CLI create / validate / read', () => {
  it('创建的文件带 .branch.json 后缀且可被 Schema 解析', async () => {
    const created = await runCli(['create', '--out', target]);
    expect(created).toContain('created');
    expect(target.endsWith('.branch.json')).toBe(true);
    const parsed = BranchFileSchema.parse(JSON.parse(await readFile(target, 'utf8')));
    expect(parsed.projectId).toBe('prj_fixture_0001');
  });

  it('validate 与 read 均可复现', async () => {
    expect(await runCli(['validate', '--in', target])).toContain('OK');
    const output = await runCli(['read', '--in', target]);
    expect(output).toContain('prj_fixture_0001');
    expect(output).toContain('semanticHash');
  });
});
