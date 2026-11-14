/**
 * schemaVersion 迁移框架（契约 1）。
 * 旧版本正确迁移或明确拒绝；迁移必须保留未知字段，不得静默丢字段（06 §二 验收 3）。
 */
import { MIGRATIONS, SCHEMA_VERSION, registerMigration } from '@workspacetree/schema';
import { migrateTasksV1ToV2 } from '@workspacetree/markdown';
import { computeSemanticHash, computePresentationHash, computeFileHash } from './canonical.js';
import { SchemaMigrationError } from './errors.js';

export { migrateTasksV1ToV2 };

export function migrateV1ToV2(input: Record<string, unknown>): Record<string, unknown> {
  const output = { ...input };

  if (output.domain && typeof output.domain === 'object' && !Array.isArray(output.domain)) {
    const rawDomain = output.domain as Record<string, unknown>;
    const domain = { ...rawDomain };

    // 1. 迁移 blocks 中的 Markdown 文本 (旧 [*] -> [x], 旧 [x] -> [-])
    if (Array.isArray(domain.blocks)) {
      domain.blocks = domain.blocks.map((block) => {
        if (!block || typeof block !== 'object') return block;
        const b = { ...(block as Record<string, unknown>) };
        if (b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload)) {
          const payload = { ...(b.payload as Record<string, unknown>) };
          if (typeof payload.markdown === 'string') {
            payload.markdown = migrateTasksV1ToV2(payload.markdown);
          }
          b.payload = payload;
        } else if (typeof b.payload === 'string') {
          b.payload = migrateTasksV1ToV2(b.payload);
        }
        return b;
      });
    }

    // 2. 迁移 tasks 结构体：停用、废弃、待定统一设置 done=false
    if (Array.isArray(domain.tasks)) {
      domain.tasks = domain.tasks.map((task) => {
        if (!task || typeof task !== 'object') return task;
        const t = { ...(task as Record<string, unknown>) };
        if (t.status === 'discarded' || t.status === 'paused' || t.status === 'pending') {
          t.done = false;
        } else if (t.done === true) {
          delete t.status;
        }
        return t;
      });
    }

    // 3. 初始化 assets 字段（如果不存在）
    if (!domain.assets || typeof domain.assets !== 'object') {
      domain.assets = {};
    }

    output.domain = domain;
  }

  // 4. 更新 revisions 哈希（若包含完整 revisions / presentation）
  if (
    output.domain &&
    output.presentation &&
    output.revisions &&
    typeof output.revisions === 'object'
  ) {
    const domain = output.domain as any;
    const presentation = output.presentation as any;
    const revisions = { ...(output.revisions as Record<string, unknown>) };

    try {
      const semanticHash = computeSemanticHash(domain);
      const presentationHash = computePresentationHash(presentation);
      revisions.semanticHash = semanticHash;
      revisions.presentationHash = presentationHash;
      revisions.fileHash = '';

      const tempFile = {
        ...output,
        schemaVersion: 2,
        revisions,
      } as any;
      revisions.fileHash = computeFileHash(tempFile);
      output.revisions = revisions;
    } catch {
      // 容错
    }
  }

  return output;
}

// 自动注册 v1 -> v2 迁移
registerMigration(1, migrateV1ToV2);

export function migrateToCurrent(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SchemaMigrationError('schemaVersion migration expects an object');
  }
  let state = input as Record<string, unknown>;
  const raw = state.schemaVersion;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new SchemaMigrationError('missing or invalid schemaVersion', { schemaVersion: raw });
  }
  if (raw > SCHEMA_VERSION) {
    throw new SchemaMigrationError(`unknown future schemaVersion ${raw}; refusing to load`, {
      schemaVersion: raw,
      supported: SCHEMA_VERSION,
    });
  }

  let version = raw;
  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      throw new SchemaMigrationError(`no migration registered for schemaVersion ${version}`, {
        schemaVersion: version,
      });
    }
    const next = migration(state);
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      throw new SchemaMigrationError(`migration ${version} returned a non-object`, {
        schemaVersion: version,
      });
    }
    state = { ...state, ...next, schemaVersion: version + 1 };
    version += 1;
  }
  return state;
}
