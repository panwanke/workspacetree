import { StartAtSchema, TAG_NAME_PATTERN } from '@workspacetree/schema';
import { parseMarkdown, getCodeBlockRanges, isLineInCodeBlock } from './parse.js';

export type MarkdownTaskStatus = 'open' | 'done' | 'discarded' | 'paused' | 'pending';

export const TASK_STATUS_CONFIG = {
  open: { marker: '[ ]', label: '未完成', done: false },
  done: { marker: '[x]', label: '已完成', done: true },
  discarded: { marker: '[-]', label: '已废弃', done: false, structuredStatus: 'discarded' },
  paused: { marker: '[~]', label: '已停用', done: false, structuredStatus: 'paused' },
  pending: { marker: '[?]', label: '待定', done: false, structuredStatus: 'pending' },
} as const satisfies Record<
  MarkdownTaskStatus,
  {
    marker: string;
    label: string;
    done: boolean;
    structuredStatus?: 'discarded' | 'paused' | 'pending';
  }
>;

export interface MarkdownTaskItem {
  lineIndex: number; // 0-based
  status: MarkdownTaskStatus;
  marker: string; // e.g. '[ ]', '[x]', '[-]', '[~]', '[?]'
  title: string;
  tags: string[];
  scheduledAt?: string;
  prefix: string; // e.g. '- ', '> - ', '  1. '
  raw: string;
}

export const V2_TASK_LINE_REGEX =
  /^(\s*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX\-~?])\][ \t]+(.*)$/;

export const V1_TASK_LINE_REGEX =
  /^(\s*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[(\\?\*|[ xX?])\]([ \t]+.*)$/;

const inlineCode = String.raw`(?<!\x60)(\x60+)(?!\x60).*?(?<!\x60)\1(?!\x60)`;
const markdownLink = String.raw`!?\[[^\]]*\]\([^)]*\)`;
const inlineTags = new RegExp(
  String.raw`${inlineCode}|${markdownLink}|https?:\/\/[^\s<>]+|(?:^|[ \t]+|(?<=[(（,;!?、，。；：！？]))#(${TAG_NAME_PATTERN})`,
  'gu',
);

export function extractTags(text: string): { title: string; tags: string[] } {
  const tags = new Set<string>();
  const title = text.replace(
    inlineTags,
    (match: string, _code: string | undefined, tag?: string) => {
      if (tag === undefined) return match;
      tags.add(tag);
      return '';
    },
  );
  return { title: title.trim(), tags: [...tags] };
}

export function extractScheduledAt(text: string): { text: string; scheduledAt?: string } {
  const dateMatch = /(?:^|\s)📅\s+(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (dateMatch && StartAtSchema.safeParse(dateMatch[1]).success) {
    const scheduledAt = dateMatch[1];
    const cleanedText = text.slice(0, dateMatch.index);
    return { text: cleanedText, scheduledAt };
  }
  return { text, scheduledAt: undefined };
}

function parseMarkerChar(char: string): MarkdownTaskStatus {
  switch (char) {
    case ' ':
      return 'open';
    case 'x':
    case 'X':
      return 'done';
    case '-':
      return 'discarded';
    case '~':
      return 'paused';
    case '?':
      return 'pending';
    default:
      return 'open';
  }
}

/**
 * 读取 Markdown 中的全部 Task 列表项（排除代码块与行内代码示例）。
 */
export function readMarkdownTasks(markdown: string): MarkdownTaskItem[] {
  const items: MarkdownTaskItem[] = [];
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0) return items;

  let codeRanges: ReturnType<typeof getCodeBlockRanges> = [];
  try {
    const ast = parseMarkdown(markdown);
    codeRanges = getCodeBlockRanges(ast);
  } catch {
    // AST 解析异常时回退到纯行解析
  }

  for (let i = 0; i < lines.length; i++) {
    const line1Based = i + 1;
    if (isLineInCodeBlock(line1Based, codeRanges)) {
      continue;
    }

    const line = lines[i]!;
    const match = V2_TASK_LINE_REGEX.exec(line);
    if (!match) continue;

    const prefix = match[1]!;
    const markerChar = match[2]!;
    const content = match[3]!;
    const status = parseMarkerChar(markerChar);

    const { text: textWithoutDate, scheduledAt } = extractScheduledAt(content);
    const { title, tags } = extractTags(textWithoutDate);

    if (!title && !scheduledAt && tags.length === 0) continue;

    items.push({
      lineIndex: i,
      status,
      marker: TASK_STATUS_CONFIG[status].marker,
      title,
      tags,
      ...(scheduledAt ? { scheduledAt } : {}),
      prefix,
      raw: line,
    });
  }

  return items;
}

/**
 * 迁移旧版 (v1) Markdown 任务标记为新版 (v2)：
 * - 旧 `[*]` / `[\*]` -> `[x]` (已完成)
 * - 旧 `[x]` / `[X]` -> `[-]` (已废弃)
 * - 原 `[?]` 保留
 * - 原 `[ ]` 保留
 * 跳过代码围栏与行内代码示例，保留缩进、换行符、标签和日期。
 */
export function migrateTasksV1ToV2(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0) return markdown;

  let codeRanges: ReturnType<typeof getCodeBlockRanges> = [];
  try {
    const ast = parseMarkdown(markdown);
    codeRanges = getCodeBlockRanges(ast);
  } catch {
    // 回退
  }

  const resultLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const line1Based = i + 1;

    if (isLineInCodeBlock(line1Based, codeRanges)) {
      resultLines.push(line);
      continue;
    }

    const match = V1_TASK_LINE_REGEX.exec(line);
    if (!match) {
      resultLines.push(line);
      continue;
    }

    const prefix = match[1]!;
    const marker = match[2]!.replace('\\', '');
    const rest = match[3]!;

    let newMarker = `[${marker}]`;
    if (marker === '*') {
      newMarker = '[x]';
    } else if (marker === 'x' || marker === 'X') {
      newMarker = '[-]';
    }

    resultLines.push(`${prefix}${newMarker}${rest}`);
  }

  // 保持换行符原样
  const isCrlf = markdown.includes('\r\n');
  return resultLines.join(isCrlf ? '\r\n' : '\n');
}

/**
 * 点击勾选切换：普通勾选只在 未完成 [ ] 与 已完成 [x] 之间切换。
 * 若当前行是 [-] / [~] / [?]，点击后切换为已完成 [x]。
 */
export function toggleTaskOnLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;

  const line = lines[lineIndex]!;
  const match = V2_TASK_LINE_REGEX.exec(line);
  if (!match) return markdown;

  const prefix = match[1]!;
  const markerChar = match[2]!;
  const rest = match[3]!;

  const currentStatus = parseMarkerChar(markerChar);
  const nextMarker = currentStatus === 'done' ? '[ ]' : '[x]';

  lines[lineIndex] = `${prefix}${nextMarker} ${rest}`;
  const isCrlf = markdown.includes('\r\n');
  return lines.join(isCrlf ? '\r\n' : '\n');
}

/**
 * 将指定行的任务状态设为目标状态
 */
export function setTaskStatusOnLine(
  markdown: string,
  lineIndex: number,
  status: MarkdownTaskStatus,
): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;

  const line = lines[lineIndex]!;
  const match = V2_TASK_LINE_REGEX.exec(line);
  if (!match) return markdown;

  const prefix = match[1]!;
  const rest = match[3]!;
  const marker = TASK_STATUS_CONFIG[status].marker;

  lines[lineIndex] = `${prefix}${marker} ${rest}`;
  const isCrlf = markdown.includes('\r\n');
  return lines.join(isCrlf ? '\r\n' : '\n');
}
