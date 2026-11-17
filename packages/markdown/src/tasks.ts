import { StartAtSchema, TAG_NAME_PATTERN } from '@workspacetree/schema';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
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
  completedAt?: string;
  hasContinuation: boolean;
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

const dateMarkers = { scheduledAt: '📅', completedAt: '✅' } as const;
type TaskDate = keyof typeof dateMarkers;
const dateSuffix = /(?:^|[ \t]+)(📅|✅)[ \t]+(\d{4}-\d{2}-\d{2})$/;
const literalTitleEntities = {
  '&': '&amp;',
  '#': '&#35;',
  '📅': '&#128197;',
  '✅': '&#9989;',
  '\r': '&#13;',
  '\n': '&#10;',
} as const;
const literalTitleCharacters = new Map<string, string>(
  Object.entries(literalTitleEntities).map(([character, entity]) => [entity, character]),
);

export function escapeTaskTitle(title: string): string {
  return title.replace(
    /[&#📅✅\r\n]/gu,
    (character) => literalTitleEntities[character as keyof typeof literalTitleEntities],
  );
}

export function decodeTaskTitle(title: string): string {
  return title.replace(
    /&(?:amp|#35|#128197|#9989|#13|#10);/g,
    (entity) => literalTitleCharacters.get(entity) ?? entity,
  );
}

function taskContent(content: string) {
  let text = content.trimEnd();
  const trailing = content.slice(text.length);
  const dates: Partial<Record<TaskDate, string>> = {};
  const tokens: { field: TaskDate; raw: string }[] = [];
  for (let match = dateSuffix.exec(text); match; match = dateSuffix.exec(text)) {
    const field = match[1] === dateMarkers.scheduledAt ? 'scheduledAt' : 'completedAt';
    const parsed = StartAtSchema.safeParse(match[2]);
    if (!parsed.success || dates[field]) break;
    dates[field] = parsed.data;
    tokens.unshift({ field, raw: match[0] });
    text = text.slice(0, match.index);
  }
  return { text, trailing, dates, tokens };
}

export function extractScheduledAt(text: string): { text: string; scheduledAt?: string } {
  const { text: body, dates } = taskContent(text);
  return { text: dates.scheduledAt ? body : text, scheduledAt: dates.scheduledAt };
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
export function readMarkdownTasks(markdown: string, ast?: Root): MarkdownTaskItem[] {
  const items: MarkdownTaskItem[] = [];
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0) return items;

  let codeRanges: ReturnType<typeof getCodeBlockRanges> = [];
  const continuation = new Set<number>();
  try {
    const tree = ast ?? parseMarkdown(markdown);
    codeRanges = getCodeBlockRanges(tree);
    visit(tree, 'html', ({ position }, _index, parent) => {
      if (
        position &&
        (parent?.type === 'root' || parent?.type === 'blockquote' || parent?.type === 'listItem')
      ) {
        codeRanges.push({ startLine: position.start.line, endLine: position.end.line });
      }
    });
    visit(tree, 'listItem', ({ position }) => {
      if (position && position.end.line > position.start.line) {
        continuation.add(position.start.line);
      }
    });
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

    const {
      text,
      dates: { scheduledAt, completedAt },
    } = taskContent(content);
    const { title, tags } = extractTags(text);

    if (!title && !scheduledAt && !completedAt && tags.length === 0) continue;

    items.push({
      lineIndex: i,
      status,
      marker: TASK_STATUS_CONFIG[status].marker,
      title,
      tags,
      ...(scheduledAt ? { scheduledAt } : {}),
      ...(status === 'done' && completedAt ? { completedAt } : {}),
      hasContinuation: continuation.has(line1Based),
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
export function toggleTaskOnLine(markdown: string, lineIndex: number, day?: string): string {
  const task = readMarkdownTasks(markdown).find((item) => item.lineIndex === lineIndex);
  if (!task) return markdown;
  return changeStatus(markdown, task, task.status === 'done' ? 'open' : 'done', day);
}

/**
 * 将指定行的任务状态设为目标状态
 */
export function setTaskStatusOnLine(
  markdown: string,
  lineIndex: number,
  status: MarkdownTaskStatus,
  day?: string,
): string {
  const task = readMarkdownTasks(markdown).find((item) => item.lineIndex === lineIndex);
  return task ? changeStatus(markdown, task, status, day) : markdown;
}

function changeStatus(
  markdown: string,
  task: MarkdownTaskItem,
  status: MarkdownTaskStatus,
  day: string | undefined,
): string {
  if (task.status === status) return markdown;
  return replaceMarkdownTaskLine(
    markdown,
    task,
    editMarkdownTaskLine(task.raw, {
      status,
      completedAt: status === 'done' ? day : null,
    }),
  );
}

export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface MarkdownTaskUpdate {
  title?: string;
  tags?: readonly string[];
  status?: MarkdownTaskStatus;
  scheduledAt?: string | null;
  completedAt?: string | null;
}

export function editMarkdownTaskLine(line: string, update: MarkdownTaskUpdate): string {
  const match = V2_TASK_LINE_REGEX.exec(line);
  if (!match) return line;
  const [, prefix, status, content] = match;
  const marker =
    update.status === undefined ? `[${status}]` : TASK_STATUS_CONFIG[update.status].marker;
  const spacing = line.slice(prefix.length + 3, line.length - content.length);
  const { text, trailing, tokens } = taskContent(content);
  let nextText = text;
  if (update.title !== undefined || update.tags !== undefined) {
    const before = extractTags(text);
    nextText = [
      update.title ?? before.title,
      ...(update.tags ?? before.tags).map((tag) => '#' + tag),
    ]
      .filter(Boolean)
      .join(' ');
  }
  const fields = new Set(tokens.map(({ field }) => field));
  const metadata = tokens.map(({ field, raw }) => {
    const value = update[field];
    return value === undefined ? raw : value ? ` ${dateMarkers[field]} ${value}` : '';
  });
  for (const field of Object.keys(dateMarkers) as TaskDate[]) {
    if (!fields.has(field) && update[field]) {
      metadata.push(` ${dateMarkers[field]} ${update[field]}`);
    }
  }
  const nextContent = (nextText + metadata.join('')).trimStart() || '未命名 TODO';
  return prefix + marker + spacing + nextContent + trailing;
}

export function replaceMarkdownTaskLine(
  markdown: string,
  task: MarkdownTaskItem,
  replacement: string,
): string {
  const parts = markdown.split(/(\r?\n)/);
  parts[task.lineIndex * 2] = replacement;
  return parts.join('');
}

export function removeMarkdownTask(markdown: string, task: MarkdownTaskItem): string {
  if (task.hasContinuation) {
    const content = V2_TASK_LINE_REGEX.exec(task.raw)?.[3] ?? '';
    const { text, trailing } = taskContent(content);
    const plainText = /^\[[ xX\-~?]\](?:[ \t]|$)/.test(text) ? '\\' + text : text;
    return replaceMarkdownTaskLine(markdown, task, task.prefix + plainText + trailing);
  }
  const lines = markdown.split(/(\r?\n)/);
  const index = task.lineIndex * 2;
  lines.splice(index === lines.length - 1 && index > 0 ? index - 1 : index, 2);
  return lines.join('');
}

export function prependMarkdownTask(markdown: string, line: string): string {
  if (!markdown) return line;
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  // 空行隔离，避免新任务行与原内容（列表延续、代码块、段落）相互吞并。
  return line + newline + newline + markdown;
}

export function appendMarkdownTask(markdown: string, line: string): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const separator = markdown && !markdown.endsWith('\n') ? newline : '';
  const appended = markdown + separator + line;
  const lastLineIndex = appended.split(/\r?\n/).length - 1;
  return readMarkdownTasks(appended).some((task) => task.lineIndex === lastLineIndex)
    ? appended
    : line + newline + newline + markdown;
}

export const remarkTaskCheckboxes: Plugin<[], Root> = () => (tree, file) => {
  const tasks = new Map(
    readMarkdownTasks(String(file), tree).map((task) => [task.lineIndex + 1, task]),
  );
  visit(tree, 'listItem', (node) => {
    const task = tasks.get(node.position?.start.line ?? 0);
    if (!task) return;
    if (typeof node.checked !== 'boolean') {
      const first = node.children[0];
      const text = first?.type === 'paragraph' ? first.children[0] : undefined;
      if (text?.type !== 'text' || !/^\[[ xX\-~?]\][ \t]+/.test(text.value)) return;
      text.value = text.value.replace(/^\[[ xX\-~?]\][ \t]+/, '');
    }
    node.checked = task.status === 'done';
    const data = (node.data ??= {});
    data.hProperties = {
      ...data.hProperties,
      'data-task-line': task.lineIndex,
      'data-task-label':
        decodeTaskTitle(task.title) || task.tags.map((tag) => '#' + tag).join(' ') || '未命名 TODO',
      'data-task-status': task.status,
    };
  });
};
