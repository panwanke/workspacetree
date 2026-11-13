import { StartAtSchema, TAG_NAME_PATTERN } from '@workspacetree/schema';

const markerStatuses = {
  ' ': 'open',
  '*': 'done',
  x: 'discarded',
  '?': 'pending',
} as const;

export type TodoStatus = (typeof markerStatuses)[keyof typeof markerStatuses];

export const TODO_STATUS = {
  open: { marker: '[ ]', label: '未完成' },
  done: { marker: '[*]', label: '已完成' },
  discarded: { marker: '[x]', label: '已废弃' },
  pending: { marker: '[?]', label: '待定' },
} satisfies Record<TodoStatus, { marker: string; label: string }>;

interface MarkdownTodo {
  lineIndex: number;
  status: TodoStatus;
  title: string;
  tags: string[];
  scheduledAt?: string;
}

export const TODO_LINE = /^(\s*(?:[-+*]|\d+[.)])[ \t]+)\[(\\?\*|[ xX?])\][ \t]+(.+?)\s*$/;

const inlineCode = String.raw`(?<!\x60)(\x60+)(?!\x60).*?(?<!\x60)\1(?!\x60)`;
const markdownLink = String.raw`!?\[[^\]]*\]\([^)]*\)`;
const inlineTags = new RegExp(
  String.raw`${inlineCode}|${markdownLink}|https?:\/\/[^\s<>]+|(?:^|[ \t]+|(?<=[(（,;!?、，。；：！？]))#(${TAG_NAME_PATTERN})`,
  'gu',
);

function extractTags(text: string): Pick<MarkdownTodo, 'title' | 'tags'> {
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

export function readMarkdownTodos(markdown: string): MarkdownTodo[] {
  const items: MarkdownTodo[] = [];
  let fence: string | undefined;

  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    const delimiter = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length &&
        delimiter[2].trim() === ''
      ) {
        fence = undefined;
      }
      continue;
    }
    if (delimiter) {
      fence = delimiter[1];
      continue;
    }
    const match = TODO_LINE.exec(line);
    if (match) {
      const marker = match[2].replace('\\', '').toLowerCase() as keyof typeof markerStatuses;
      const date = /(?:^|\s)📅\s+(\d{4}-\d{2}-\d{2})$/.exec(match[3]);
      const scheduledAt = date && StartAtSchema.safeParse(date[1]).success ? date[1] : undefined;
      const text = scheduledAt && date ? match[3].slice(0, date.index) : match[3];
      if (!text.trim() && !scheduledAt) continue;
      items.push({
        lineIndex,
        status: markerStatuses[marker],
        ...extractTags(text),
        ...(scheduledAt ? { scheduledAt } : {}),
      });
    }
  }
  return items;
}
