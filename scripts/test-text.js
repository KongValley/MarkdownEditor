'use strict';

const assert = require('assert');
const text = require('../src/shared/text');

// 查找：字面量、大小写、正则、错误与零长度
let result = text.findMatches('abcABC', 'abc');
assert.strictEqual(result.ranges.length, 2);
result = text.findMatches('abcABC', 'abc', { caseSensitive: true });
assert.strictEqual(result.ranges.length, 1);
result = text.findMatches('a1 b22 c333', '\\d+', { regex: true });
assert.strictEqual(result.ranges.length, 3);
assert.deepStrictEqual(result.ranges[2], { start: 8, end: 11 });
assert(text.findMatches('abc', '(', { regex: true }).error, '非法正则应返回错误');
assert.strictEqual(text.findMatches('abc', '^', { regex: true }).ranges.length, 0, '零长度匹配不应死循环');
assert.strictEqual(text.findMatches('abc', '').ranges.length, 0);

// 替换
let replaced = text.replaceAll('a1 b2', '\\d', 'N', { regex: true });
assert.strictEqual(replaced.text, 'aN bN');
assert.strictEqual(replaced.count, 2);
replaced = text.replaceAll('Abc abc', 'abc', 'X');
assert.strictEqual(replaced.text, 'X X');
replaced = text.replaceAll('abc', '(', 'X', { regex: true });
assert(replaced.error, '非法正则应返回错误');

// 列表续行
assert.strictEqual(text.listContinuation('hello', 5), null);
assert.deepStrictEqual(text.listContinuation('- item', 6), { type: 'continue', insert: '\n- ' });
assert.deepStrictEqual(text.listContinuation('- ', 2), { type: 'exit', from: 0, to: 2 });
assert.deepStrictEqual(text.listContinuation('  2. item', 9), { type: 'continue', insert: '\n  3. ' });
assert.deepStrictEqual(text.listContinuation('- [x] done', 10), { type: 'continue', insert: '\n- [ ] ' });
assert.deepStrictEqual(text.listContinuation('> quote', 7), { type: 'continue', insert: '\n> ' });
assert.strictEqual(text.listContinuation('```\n- item', 11), null, '代码围栏内不续行');
assert.strictEqual(text.listContinuation('- item\ntail', 3), null, '仅行尾续行');

// 大纲
const outline = text.extractHeadings([
  '# 标题一',
  '',
  '## 标题二 **加粗**',
  '',
  '```',
  '# 代码里的井号',
  '```',
  '### 标题三'
].join('\n'));
assert.deepStrictEqual(outline.map((item) => [item.level, item.text, item.line]), [
  [1, '标题一', 0],
  [2, '标题二 加粗', 2],
  [3, '标题三', 7]
]);
const hashHeadings = text.extractHeadings('# C#\n## 标题 ##\n# C #\n### A#B');
assert.deepStrictEqual(hashHeadings.map((item) => item.text), ['C#', '标题', 'C', 'A#B']);

// 表格对齐
const table = text.buildTable(['名称', '值'], [['苹果', '1']]);
assert.strictEqual(table, [
  '| 名称 | 值  |',
  '| ---- | --- |',
  '| 苹果 | 1   |'
].join('\n'));

// 表格单元格跳转
const grid = [
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |'
].join('\n');
const aStart = grid.indexOf('A');
const bStart = grid.indexOf('B');
const oneStart = grid.indexOf('1');
const twoStart = grid.lastIndexOf('2');
assert.deepStrictEqual(text.nextTableCell(grid, aStart, 1), { start: bStart, end: bStart + 1 });
assert.deepStrictEqual(text.nextTableCell(grid, bStart, 1), { start: oneStart, end: oneStart + 1 }, '应跳过分隔行');
assert.deepStrictEqual(text.nextTableCell(grid, twoStart, 1), { start: aStart, end: aStart + 1 }, '末格应回绕');
assert.deepStrictEqual(text.nextTableCell(grid, aStart, -1), { start: twoStart, end: twoStart + 1 }, '反向应回绕到末格');
assert.strictEqual(text.nextTableCell('普通段落', 0, 1), null);

// 字数与阅读时间
assert.strictEqual(text.countWords('你好 world'), 3);
assert.strictEqual(text.readingMinutes('你好 world', 1), 3);
assert.strictEqual(text.displayWidth('苹果'), 4);

// Frontmatter
const decorated = '---\ntitle: "标题"\ntags: [知识库, 测试]\n---\n# 正文\n';
const parsed = text.parseFrontmatter(decorated);
assert.strictEqual(parsed.hasFrontmatter, true);
assert.strictEqual(parsed.title, '标题');
assert.deepStrictEqual(parsed.tags, ['知识库', '测试']);
assert.strictEqual(parsed.body, '# 正文\n');
assert.strictEqual(parsed.bodyStart, decorated.indexOf('# 正文'));
assert.strictEqual(text.stripFrontmatter(decorated), '# 正文\n');
assert.deepStrictEqual(text.parseFrontmatter('# 普通').tags, []);
assert.strictEqual(text.parseFrontmatter('# 普通').body, '# 普通');
assert.strictEqual(text.parseFrontmatter('---\ntags: [a]\n没有闭合').body, '---\ntags: [a]\n没有闭合', '未闭合不裁剪');
const listTags = text.parseFrontmatter('---\ntags:\n  - 一\n  - 二\n---\n正文');
assert.deepStrictEqual(listTags.tags, ['一', '二']);
assert.deepStrictEqual(text.parseFrontmatter('---\ntags: a，b\n---\nx').tags, ['a', 'b']);
assert.deepStrictEqual(text.parseFrontmatter('---\ntags: "a, b"\n---\nx').tags, ['a', 'b']);
assert.deepStrictEqual(text.parseFrontmatter('---\ntags: [a, A, #b]\n---\nx').tags, ['a', 'b']);
assert.strictEqual(text.parseFrontmatter('---\r\ntags: [x]\r\n---\r\nbody').body, 'body');
assert.strictEqual(text.parseFrontmatter('---\r\ntags: [x]\r\n---\r\nbody').tags[0], 'x');
assert.strictEqual(text.parseFrontmatter('---\n\n---\n正文').hasFrontmatter, false, '顶部分隔线不应当 frontmatter');
assert.strictEqual(text.parseFrontmatter('---\ntitle: T\n---\n正文').title, 'T');

// Wiki 链接
const wikiLinks = text.extractWikiLinks('[[a]] [[b|别名]] [[a]]\n`[[code]]`\n```\n[[fence]]\n```\n');
assert.deepStrictEqual(wikiLinks, ['a', 'b']);
assert.deepStrictEqual(text.extractWikiLinks('[[x|]] [[|y]]'), ['x']);
assert.deepStrictEqual(text.documentTitle('---\ntitle: T\n---\n# H', 'file'), 'T');
assert.strictEqual(text.documentTitle('# H1\n## H2', 'file'), 'H1');
assert.strictEqual(text.documentTitle('## H2', 'file'), 'H2');
assert.strictEqual(text.documentTitle('正文', 'file'), 'file');
assert.strictEqual(text.stripInline('[[任务|别名]]'), '别名');
assert.strictEqual(text.stripInline('[[任务]]'), '任务');
assert.deepStrictEqual(text.extractHeadings('# [[任务|别名]]').map((item) => item.text), ['别名']);

const documents = [
  { relPath: 'dir/任务.md', name: '任务.md', title: '今日任务', links: [] },
  { relPath: '笔记.md', name: '笔记.md', title: '笔记', links: ['任务'] },
  { relPath: 'a/笔记.md', name: '笔记.md', title: '另一篇', links: [] }
];
assert.strictEqual(text.resolveWikilink('任务', documents).relPath, 'dir/任务.md');
assert.strictEqual(text.resolveWikilink('任务.md', documents).relPath, 'dir/任务.md');
assert.strictEqual(text.resolveWikilink('今日任务', documents).relPath, 'dir/任务.md');
assert.strictEqual(text.resolveWikilink('dir/任务', documents).relPath, 'dir/任务.md');
assert.strictEqual(text.resolveWikilink('笔记', documents).relPath, '笔记.md');
assert.strictEqual(text.resolveWikilink('missing', documents), null);
const ambiguous = [
  { relPath: 'b/同.md', name: '同.md', title: 'B', links: [] },
  { relPath: 'a/同.md', name: '同.md', title: 'A', links: [] }
];
assert.strictEqual(text.resolveWikilink('同', ambiguous).relPath, 'a/同.md');
assert.strictEqual(text.linkMatchesDoc('任务', documents[0]), true);
assert.strictEqual(text.linkMatchesDoc('任务', documents[1]), false);
assert.deepStrictEqual(text.findBacklinks(documents, 'dir/任务.md'), [{ relPath: '笔记.md', title: '笔记' }]);
assert.deepStrictEqual(text.findBacklinks(documents, '笔记.md'), []);
const fencedBacklink = { relPath: 'f.md', name: 'f.md', title: 'F', links: text.extractWikiLinks('```\n[[任务]]\n```') };
assert.deepStrictEqual(text.findBacklinks([documents[0], fencedBacklink], 'dir/任务.md'), []);

console.log('text unit checks passed: find, list, outline, table, words, frontmatter, wikilinks');
