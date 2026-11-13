/**
 * 双实现验证尖刺的共享契约（05 §十 / U06 / ADR-027）。
 * 本文件只有类型，零运行时依赖：浏览器与桌面实现、同一份六类场景测试共用。
 */
import type { StorageAdapter } from '@workspacetree/core';

export type WriteStep = 'intent' | 'temp' | 'replace' | 'commit';

export interface CrashPlan {
  /** 在指定步骤完成后模拟进程崩溃，留现场给下一次启动恢复。 */
  failAt?: WriteStep;
  /** 在指定步骤模拟权限被撤销（EACCES）。 */
  denyAt?: WriteStep;
}

export type RecoveryOutcome = 'none' | 'rolled-forward' | 'completed' | 'conflict';

export interface RecoveryReport {
  outcome: RecoveryOutcome;
  projectId: string;
  currentHash: string;
  baseHash?: string;
  newHash?: string;
  reason?: string;
  /** 目录 fsync 是否可用；null = 该后端无目录 fsync 语义或未执行。 */
  directoryFsync: boolean | null;
}

export type ScenarioKey =
  'persistence' | 'concurrency' | 'interruption' | 'reopen' | 'permission' | 'import-export';

export interface ScenarioResult {
  id: number;
  key: ScenarioKey;
  title: string;
  passed: boolean;
  detail: string;
  steps?: string[];
  durationMs: number;
}

export interface RuntimeInfo {
  backend: string;
  runtime: string;
  versions: Record<string, string>;
}

/** 六类场景所需的最小能力集；任何 StorageAdapter 实现满足即可参与同一组实测。 */
export interface SpikeAdapter extends StorageAdapter {
  readonly backend: string;
  /** 模拟进程重启：新建实例、丢弃内存态，但保留同一持久化介质。 */
  reopen(): Promise<SpikeAdapter>;
  recover(projectId: string): Promise<RecoveryReport>;
  hasPendingWrites(projectId: string): Promise<boolean>;
  setCrash(plan: CrashPlan): void;
  clearCrash(): void;
  exportPack(projectId: string): Promise<string | null>;
  importPack(raw: string): Promise<void>;
  clear(projectId: string): Promise<void>;
  setDenied(denied: boolean): Promise<void>;
  close(): Promise<void>;
}
