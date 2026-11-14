import type { DomainState } from '@workspacetree/schema';
import { describe, expect, it } from 'vitest';
import { readMarkdownTodos } from '../../apps/web/src/markdown-todos';
import {
  collectProjectTodos,
  filterProjectTodos,
  groupProjectTodos,
  projectTodoSections,
  type TodoScope,
  type TodoStatusFilter,
} from '../../apps/web/src/project-todos';

const domain: DomainState = {
  project: { id: 'prj_test', title: 'Project', rootNodeId: 'n_root' },
  nodes: [
    { id: 'n_root', title: 'Project', parentId: null, blockIds: [], archived: false },
    { id: 'n_a', title: 'Writing', parentId: 'n_root', blockIds: ['blk_a'], archived: false },
    { id: 'n_b', title: 'Experiment', parentId: 'n_root', blockIds: [], archived: false },
    {
      id: 'n_leaf',
      title: 'Methods',
      parentId: 'n_b',
      blockIds: ['blk_leaf', 'blk_extra'],
      archived: true,
    },
  ],
  edges: [
    { id: 'e_a', type: 'hierarchy', fromNodeId: 'n_a', toNodeId: 'n_leaf' },
    { id: 'e_b', type: 'reference', fromNodeId: 'n_b', toNodeId: 'n_leaf' },
  ],
  tasks: [
    { id: 'tsk_root', nodeId: 'n_root', title: 'Project planning', done: false },
    { id: 'tsk_b', nodeId: 'n_b', title: 'Run experiment', done: true },
    { id: 'tsk_leaf', nodeId: 'n_leaf', title: 'Write methods', done: false },
  ],
  blocks: [
    { id: 'blk_a', kind: 'text', payload: { markdown: '- [x] Draft outline' } },
    { id: 'blk_leaf', kind: 'text', payload: { markdown: '- [?] Review methods' } },
    { id: 'blk_extra', kind: 'checklist', payload: { markdown: '- [-] Alternate methods' } },
  ],
  spines: [],
  projectRefs: [],
  archived: false,
  archiveMeta: null,
};

describe('Markdown TODOs', () => {
  it('reads the four status markers from lists and skips fenced examples', () => {
    const markdown = [
      '- [ ] Open',
      '  1. [x] Complete',
      '* [-] Dropped',
      '+ [?] Pending',
      '- [~] Paused',
      '~~~md',
      '- [ ] Example',
      '~~~',
      'A sentence containing [x] is not a task.',
      '- [x]   ',
      '- [X] Uppercase',
    ].join('\r\n');

    expect(readMarkdownTodos(markdown)).toEqual([
      { lineIndex: 0, status: 'open', title: 'Open', tags: [] },
      { lineIndex: 1, status: 'done', title: 'Complete', tags: [] },
      { lineIndex: 2, status: 'discarded', title: 'Dropped', tags: [] },
      { lineIndex: 3, status: 'pending', title: 'Pending', tags: [] },
      { lineIndex: 4, status: 'paused', title: 'Paused', tags: [] },
      { lineIndex: 10, status: 'done', title: 'Uppercase', tags: [] },
    ]);
  });

  it('extracts inline tags, including tag-only TODOs, while preserving code, escapes and URLs', () => {
    const markdown = [
      '- [-]  #实验',
      '- [ ] #招募 核对 #数据质量，#招募 与 `#code`、\\#literal、[引用](https://example.test/#ref) #QC-1',
      '- [?] Use ``value ` #code`` https://example.test/?q=1;#section #QC-1',
    ].join('\n');

    expect(readMarkdownTodos(markdown)).toEqual([
      { lineIndex: 0, status: 'discarded', title: '', tags: ['实验'] },
      {
        lineIndex: 1,
        status: 'open',
        title: '核对， 与 `#code`、\\#literal、[引用](https://example.test/#ref)',
        tags: ['招募', '数据质量', 'QC-1'],
      },
      {
        lineIndex: 2,
        status: 'pending',
        title: 'Use ``value ` #code`` https://example.test/?q=1;#section',
        tags: ['QC-1'],
      },
    ]);
  });
});

describe('project TODOs', () => {
  it('keeps inbox and empty branches available for quick add in the branch view', () => {
    const empty = structuredClone(domain);
    empty.tasks = [];
    empty.blocks = [];
    empty.nodes.forEach((node) => {
      node.blockIds = [];
    });
    const groups = collectProjectTodos(empty, { includeEmpty: true });
    expect(
      projectTodoSections(groups, [], 'all', 'branch').map((group) => [group.id, group.title]),
    ).toEqual([
      ['', '待分配'],
      ['n_root', '项目级'],
      ['n_a', 'Writing'],
      ['n_b', 'Experiment'],
    ]);
    expect(projectTodoSections(groups, [], 'inbox', 'branch').map((group) => group.id)).toEqual([
      '',
    ]);
    expect(projectTodoSections(groups, [], 'all', 'todoTag')).toEqual([]);
  });

  it('groups structured tasks and Markdown items under their top-level branch', () => {
    expect(
      collectProjectTodos(domain).map(({ title, items }) => [
        title,
        items.map(({ title, status, source }) => [title, status, source]),
      ]),
    ).toEqual([
      ['项目级', [['Project planning', 'open', 'task']]],
      [
        'Writing',
        [
          ['Draft outline', 'done', 'markdown'],
          ['Write methods', 'open', 'task'],
          ['Review methods', 'pending', 'markdown'],
          ['Alternate methods', 'discarded', 'markdown'],
        ],
      ],
      ['Experiment', [['Run experiment', 'done', 'task']]],
    ]);
  });

  it('combines terminal-node scope and status filters independently', () => {
    const groups = collectProjectTodos(domain);
    const titles = (scope: TodoScope, status: TodoStatusFilter) =>
      filterProjectTodos(groups, scope, status).flatMap(({ items }) =>
        items.map((item) => item.title),
      );

    expect(titles('leaves', 'all')).toEqual([
      'Write methods',
      'Review methods',
      'Alternate methods',
      'Run experiment',
    ]);
    expect(titles('all', 'done')).toEqual(['Draft outline', 'Run experiment']);
    expect(titles('leaves', 'done')).toEqual(['Run experiment']);
    expect(titles('leaves', 'discarded')).toEqual(['Alternate methods']);
  });

  it('includes standalone branches without repeating the designated project subtree', () => {
    const mixed = structuredClone(domain);
    mixed.nodes.push({
      id: 'n_independent',
      title: 'Independent',
      parentId: null,
      blockIds: [],
      archived: false,
    });
    mixed.nodes[0].parentId = 'n_independent';
    mixed.tasks.push({
      id: 'tsk_independent',
      nodeId: 'n_independent',
      title: 'Independent task',
      done: false,
    });

    const groups = collectProjectTodos(mixed);
    expect(
      groups.find((group) => group.id === 'n_independent')?.items.map((item) => item.id),
    ).toEqual(['tsk_independent']);
    expect(groups.flatMap((group) => group.items)).toHaveLength(7);
  });

  it('filters by direct node tags and task tags independently, then groups by either kind', () => {
    const tagged = structuredClone(domain);
    tagged.nodes[0].tags = ['根节点'];
    tagged.nodes[1].tags = ['实验'];
    tagged.nodes[3].tags = ['实验', '方法'];
    tagged.tasks[2].tags = ['写作'];
    tagged.blocks[1].payload = { markdown: '- [?] Review methods #方法 #写作' };

    const groups = collectProjectTodos(tagged);
    const nodeMatches = filterProjectTodos(groups, 'leaves', 'all', { nodeTag: '实验' });
    expect(nodeMatches.flatMap((group) => group.items.map((item) => item.title))).toEqual([
      'Write methods',
      'Review methods',
      'Alternate methods',
    ]);
    const todoMatches = filterProjectTodos(groups, 'all', 'all', { todoTag: '方法' });
    expect(todoMatches.flatMap((group) => group.items.map((item) => item.title))).toEqual([
      'Review methods',
    ]);
    expect(
      filterProjectTodos(groups, 'leaves', 'done', { nodeTag: '实验', todoTag: '方法' }),
    ).toEqual([]);
    expect(filterProjectTodos(groups, 'leaves', 'all', { nodeTag: '根节点' })).toEqual([]);

    const byTodoTag = groupProjectTodos(nodeMatches, 'todoTag');
    expect(byTodoTag.find((group) => group.title === '#写作')?.items).toHaveLength(2);
    expect(byTodoTag.find((group) => group.title === '无 TODO 标签')?.items).toHaveLength(1);
    const byNodeTag = groupProjectTodos(todoMatches, 'nodeTag');
    expect(byNodeTag.map((group) => group.title).sort()).toEqual(['#实验', '#方法']);
  });
});
