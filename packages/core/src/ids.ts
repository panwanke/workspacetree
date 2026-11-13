/**
 * 稳定 ID（契约 2）。Crockford Base32 + 时间 + 随机；now / random 可注入以便确定性测试。
 * 不依赖 Node crypto，纯 ES 全局，可在无 UI 环境运行。
 */
import { ID_PREFIX } from '@workspacetree/schema';

export interface IdDependencies {
  now(): number;
  random(): number;
}

const DEFAULT_DEPS: IdDependencies = {
  now: () => Date.now(),
  random: () => Math.random(),
};

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(value: number, length: number): string {
  let rest = Math.max(0, Math.floor(value));
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

export function makeId(prefix: string, deps: IdDependencies = DEFAULT_DEPS): string {
  const timePart = encode(deps.now(), 10);
  const randomPart = encode(deps.random() * 32 ** 16, 16);
  return `${prefix}${timePart}${randomPart}`;
}

export function newProjectId(deps?: IdDependencies): string {
  return makeId(ID_PREFIX.project, deps);
}

export function newNodeId(deps?: IdDependencies): string {
  return makeId(ID_PREFIX.node, deps);
}

export function newOperationId(deps?: IdDependencies): string {
  return makeId(ID_PREFIX.operation, deps);
}

export function newCommitId(deps?: IdDependencies): string {
  return makeId(ID_PREFIX.commit, deps);
}
