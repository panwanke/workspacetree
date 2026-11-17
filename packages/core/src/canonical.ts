/**
 * 规范序列化与三类哈希（契约 6；05 §8.1）。
 * 纯 TS 同构实现：不依赖 node:crypto / TextEncoder 等平台 API，可在无 UI 环境运行。
 * 语义哈希只覆盖 DomainState；呈现哈希只覆盖 SavedPresentation；fileHash 排除自身字段防自指。
 */
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  BranchFile,
  DomainState,
  Revisions,
  SavedPresentation,
  StateClass,
} from '@workspacetree/schema';

/** 手写 UTF-8 编码，避免依赖 DOM 的 TextEncoder 或 Node Buffer。 */
export function utf8Bytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8Bytes(input)));
}

export function computeBytesSha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** 递归按 key 排序，剔除 undefined，保证相同逻辑状态输出字节一致。 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) {
        sorted[key] = normalize(source[key]);
      }
    }
    return sorted;
  }
  return value;
}

export function computeSemanticHash(domain: DomainState): string {
  return sha256Hex(canonicalize(domain));
}

/**
 * 全默认的 Phase 2 字段按旧格式省略，保证旧文件与显式默认字段状态的哈希一致；
 * 一旦方向、纵向坐标或节点缩放含非默认状态，三个字段全部参与规范哈希。
 */
function canonicalPresentation(presentation: SavedPresentation): SavedPresentation {
  const layoutDirection = presentation.layoutDirection ?? 'horizontal';
  const verticalNodePositions = presentation.verticalNodePositions ?? {};
  const nodeScales = presentation.nodeScales ?? {};
  const edgeStyles = presentation.edgeStyles ?? {};
  const hasPhase2State =
    layoutDirection !== 'horizontal' ||
    Object.keys(verticalNodePositions).length > 0 ||
    Object.keys(nodeScales).length > 0;
  const normalized: SavedPresentation = {
    ...presentation,
    layoutDirection,
    verticalNodePositions,
    nodeScales,
    edgeStyles,
  };
  if (!hasPhase2State) {
    delete normalized.layoutDirection;
    delete normalized.verticalNodePositions;
    delete normalized.nodeScales;
  }
  if (Object.keys(edgeStyles).length === 0) delete normalized.edgeStyles;
  return normalized;
}

export function computePresentationHash(presentation: SavedPresentation): string {
  return sha256Hex(canonicalize(canonicalPresentation(presentation)));
}

export function computeFileHash(file: BranchFile): string {
  const withoutSelf: BranchFile = {
    ...file,
    presentation: canonicalPresentation(file.presentation),
    revisions: { ...file.revisions, fileHash: '' },
  };
  return sha256Hex(canonicalize(withoutSelf));
}

/** 三类修订号独立推进：语义 / 呈现各自 +1，fileWriteVersion 每次成功写盘 +1。 */
export function advanceRevisions(
  previous: Revisions,
  stateClass: StateClass,
  semanticHash: string,
  presentationHash: string,
): Revisions {
  return {
    semanticRevision: previous.semanticRevision + (stateClass === 'domain' ? 1 : 0),
    semanticHash,
    presentationRevision: previous.presentationRevision + (stateClass === 'presentation' ? 1 : 0),
    presentationHash,
    fileHash: '',
    fileWriteVersion: previous.fileWriteVersion + 1,
  };
}
