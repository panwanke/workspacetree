/**
 * schemaVersion 迁移框架（契约 1）。
 * 旧版本正确迁移或明确拒绝；迁移必须保留未知字段，不得静默丢字段（06 §二 验收 3）。
 */
import { MIGRATIONS, SCHEMA_VERSION } from '@workspacetree/schema';
import { SchemaMigrationError } from './errors.js';

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
