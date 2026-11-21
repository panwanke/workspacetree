import { describe, expect, it } from 'vitest';
import {
  classifyLink,
  extractAllLinks,
  extractLocalPath,
  getLinkActionLabel,
  getLinkIconName,
  remarkWikilinks,
  createMarkdownProcessor,
} from '@workspacetree/markdown';
import { safeUrlTransform, renderInlineMarkdown } from '../../apps/web/src/MarkdownPreview.js';

describe('内嵌链接分类、路径提取与解析 (embedded-links)', () => {
  describe('classifyLink: 链接类型判定 (url, md, folder, generic)', () => {
    it('正确识别 URL 网页链接', () => {
      expect(classifyLink('https://github.com/panwanke/workspacetree')).toBe('url');
      expect(classifyLink('http://localhost:5173/demo')).toBe('url');
      expect(classifyLink('https://example.com')).toBe('url');
      expect(classifyLink('//cdn.jsdelivr.net/npm/pele')).toBe('url');
      expect(classifyLink('www.example.com')).toBe('url');
    });

    it('正确识别 Markdown 文档链接（含相对路径、绝对路径、特定协议与扩展名）', () => {
      expect(classifyLink('docs/rules.md')).toBe('md');
      expect(classifyLink('docs/architecture.markdown')).toBe('md');
      expect(classifyLink('https://example.com/docs/README.md')).toBe('md');
      expect(classifyLink('https://example.com/guide.md#section-2')).toBe('md');
      expect(classifyLink('file:///C:/Users/Wanke/notes.md')).toBe('md');
      expect(classifyLink('C:\\Users\\Wanke\\Documents\\project.md')).toBe('md');
      expect(classifyLink('D:/notes/ideas.markdown')).toBe('md');
      expect(classifyLink('obsidian://open?vault=Vault&file=Note')).toBe('md');
      expect(classifyLink('vscode://file/E:/code/workspacetree/README.md')).toBe('md');
    });

    it('正确识别文件夹目录路径（以 / 或 \\ 结尾，GitHub 在线目录，或无文件扩展名的本地目录）', () => {
      expect(classifyLink('docs/')).toBe('folder');
      expect(classifyLink('https://github.com/panwanke/workspacetree/tree/master/packages/')).toBe(
        'folder',
      );
      expect(classifyLink('file:///C:/Users/Wanke/Desktop/')).toBe('folder');
      expect(classifyLink('file:///C:/Users/Wanke/Desktop')).toBe('folder');
      expect(classifyLink('C:\\Users\\Wanke\\Documents')).toBe('folder');
      expect(classifyLink('D:/05code/43js_dev/workspacetree')).toBe('folder');
      expect(classifyLink('E:\\05code\\43js_dev\\workspacetree\\')).toBe('folder');
      expect(classifyLink('vscode://file/E:/05code/43js_dev/workspacetree')).toBe('folder');
    });

    it('识别通用或未知协议/文件类型', () => {
      expect(classifyLink('mailto:test@example.com')).toBe('generic');
      expect(classifyLink('')).toBe('generic');
    });
  });

  describe('extractLocalPath: 本地路径提取与 Windows 格式规范化', () => {
    it('去除 file:/// 并转为 Windows 驱动器标准反斜杠', () => {
      expect(extractLocalPath('file:///C:/Users/Wanke/Desktop/test.md')).toBe(
        'C:\\Users\\Wanke\\Desktop\\test.md',
      );
      expect(extractLocalPath('file:///D:/projects/workspacetree')).toBe(
        'D:\\projects\\workspacetree',
      );
    });

    it('去除 vscode://file/ 前缀', () => {
      expect(extractLocalPath('vscode://file/E:/code/workspacetree')).toBe(
        'E:\\code\\workspacetree',
      );
    });

    it('保留标准盘符路径并将正斜杠转换为反斜杠', () => {
      expect(extractLocalPath('D:/05code/workspacetree')).toBe('D:\\05code\\workspacetree');
      expect(extractLocalPath('C:\\Windows\\System32')).toBe('C:\\Windows\\System32');
    });
  });

  describe('getLinkIconName & getLinkActionLabel', () => {
    it('根据分类返回对应图标名称与操作提示', () => {
      expect(getLinkIconName('url')).toBe('globe');
      expect(getLinkIconName('md')).toBe('fileText');
      expect(getLinkIconName('folder')).toBe('folder');
      expect(getLinkIconName('generic')).toBe('externalLink');

      expect(getLinkActionLabel('url', 'https://example.com')).toContain('网页');
      expect(getLinkActionLabel('md', 'docs/rule.md')).toContain('Markdown 文档');
      expect(getLinkActionLabel('folder', 'C:\\folder')).toContain('文件夹');
    });
  });

  describe('remarkWikilinks 插件', () => {
    it('将 [[目标]] 与 [[目标|显示文字]] 转换解析为标准 link AST 节点', () => {
      const processor = createMarkdownProcessor().use(remarkWikilinks);
      const md = '参考文档 [[README.md]] 以及规范 [[docs/rules.md|核心规则]]。';
      const tree: any = processor.runSync(processor.parse(md));
      const paragraph = tree.children[0];

      expect(paragraph.children[1]).toMatchObject({
        type: 'link',
        url: 'README.md',
        children: [{ type: 'text', value: 'README.md' }],
      });

      expect(paragraph.children[3]).toMatchObject({
        type: 'link',
        url: 'docs/rules.md',
        children: [{ type: 'text', value: '核心规则' }],
      });
    });
  });

  describe('safeUrlTransform: 安全过滤与本地协议放行', () => {
    it('放行 file: / vscode: / obsidian: / Windows 本地盘符路径', () => {
      expect(safeUrlTransform('file:///C:/Users/test.md')).toBe('file:///C:/Users/test.md');
      expect(safeUrlTransform('vscode://file/E:/code')).toBe('vscode://file/E:/code');
      expect(safeUrlTransform('obsidian://open?vault=test')).toBe('obsidian://open?vault=test');
      expect(safeUrlTransform('C:\\Users\\Wanke\\note.md')).toBe('C:\\Users\\Wanke\\note.md');
      expect(safeUrlTransform('D:/workspace/docs')).toBe('D:/workspace/docs');
    });

    it('坚决过滤 javascript: 等危险脚本协议', () => {
      expect(safeUrlTransform('javascript:alert(1)')).toBe('');
      expect(safeUrlTransform('vbscript:msgbox(1)')).toBe('');
      expect(safeUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('');
    });
  });

  describe('renderInlineMarkdown: 行内 Markdown 与链接解析', () => {
    it('正确解析 Markdown 链接并生成包含图标的内嵌链接元素', () => {
      const result = renderInlineMarkdown('请查看 [开发文档](docs/rules.md) 了解详情');
      expect(result.length).toBe(3);
      expect(typeof result[0]).toBe('string');
      // result[1] is the EmbeddedLink element
      const linkElem: any = result[1];
      expect(linkElem.props.href).toBe('docs/rules.md');
    });

    it('正确解析 Wikilinks 双括号语法', () => {
      const result = renderInlineMarkdown('阅读 [[README.md|项目说明]] 快速上手');
      expect(result.length).toBe(3);
      const linkElem: any = result[1];
      expect(linkElem.props.href).toBe('README.md');
      expect(linkElem.props.children).toBe('项目说明');
    });
  });

  describe('extractAllLinks: 跨 Markdown 笔记全量提取链接', () => {
    it('正确提取各种标准链接与双链，并过滤图片', () => {
      const md = `
# 项目概要
- 外部主页: [官网](https://github.com/panwanke/workspacetree)
- 架构设计: [架构说明](docs/architecture.md)
- 插图示例: ![架构图](assets/arch.png)
- 相对目录: [组件库](src/components/)
- 双链笔记: [[note.md|开发便签]] 以及 [[spec.md]]
      `;
      const links = extractAllLinks(md);
      expect(links.length).toBe(5);

      expect(links[0]).toMatchObject({
        text: '官网',
        url: 'https://github.com/panwanke/workspacetree',
        type: 'url',
      });

      expect(links[1]).toMatchObject({
        text: '架构说明',
        url: 'docs/architecture.md',
        type: 'md',
      });

      expect(links[2]).toMatchObject({
        text: '组件库',
        url: 'src/components/',
        type: 'folder',
      });

      expect(links[3]).toMatchObject({
        text: '开发便签',
        url: 'note.md',
        type: 'md',
      });

      expect(links[4]).toMatchObject({
        text: 'spec.md',
        url: 'spec.md',
        type: 'md',
      });
    });
  });
});
