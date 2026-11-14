/**
 * schemaVersion 迁移注册表（契约 1）。
 * 旧版本必须正确迁移或明确拒绝，不得静默丢字段（06 §二 Phase 0 验收 3）。
 * 本轮仅登记当前版本；新增版本时在此追加迁移函数并保留旧条目。
 */
import { SCHEMA_VERSION } from './common.js';

export type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

export const KNOWN_SCHEMA_VERSIONS: readonly number[] = [1, SCHEMA_VERSION];

/** key = 源版本号，value = 迁移到下一版本的纯函数；必须保留未知字段。 */
export const MIGRATIONS: Record<number, Migration> = {};

export function registerMigration(version: number, migration: Migration): void {
  MIGRATIONS[version] = migration;
}

export function isKnownSchemaVersion(version: number): boolean {
  return KNOWN_SCHEMA_VERSIONS.includes(version);
}
