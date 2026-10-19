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

console.log('text unit checks passed: find, list, outline, table, words');
