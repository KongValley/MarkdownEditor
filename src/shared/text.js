'use strict';

(function attach(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MDText = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
  function findMatches(text, query, options) {
    const opts = options || {};
    const max = opts.max || 2000;
    const ranges = [];
    const source = String(text == null ? '' : text);
    const needle = String(query == null ? '' : query);
    if (!needle) return { ranges, error: null };
    if (opts.regex) {
      let expression;
      try {
        expression = new RegExp(needle, opts.caseSensitive ? 'g' : 'gi');
      } catch (error) {
        return { ranges, error: error.message };
      }
      let match;
      let guard = 0;
      while ((match = expression.exec(source)) !== null) {
        if (match[0].length === 0) {
          expression.lastIndex += 1;
          if (expression.lastIndex > source.length) break;
          continue;
        }
        ranges.push({ start: match.index, end: match.index + match[0].length });
        if (ranges.length >= max) break;
        guard += 1;
        if (guard > max * 4) break;
      }
      return { ranges, error: null };
    }
    const haystack = opts.caseSensitive ? source : source.toLowerCase();
    const search = opts.caseSensitive ? needle : needle.toLowerCase();
    let from = 0;
    while (ranges.length < max) {
      const index = haystack.indexOf(search, from);
      if (index < 0) break;
      ranges.push({ start: index, end: index + search.length });
      from = index + search.length;
    }
    return { ranges, error: null };
  }

  function replaceAll(text, query, replacement, options) {
    const opts = options || {};
    const source = String(text == null ? '' : text);
    const needle = String(query == null ? '' : query);
    const replace = String(replacement == null ? '' : replacement);
    if (!needle) return { text: source, count: 0, error: null };
    if (opts.regex) {
      const matches = findMatches(source, needle, { regex: true, caseSensitive: opts.caseSensitive, max: 2000 });
      if (matches.error) return { text: source, count: 0, error: matches.error };
      if (matches.ranges.length === 0) return { text: source, count: 0, error: null };
      const expression = new RegExp(needle, opts.caseSensitive ? 'g' : 'gi');
      return { text: source.replace(expression, replace), count: matches.ranges.length, error: null };
    }
    const matches = findMatches(source, needle, { caseSensitive: opts.caseSensitive });
    if (matches.ranges.length === 0) return { text: source, count: 0, error: null };
    let output = '';
    let last = 0;
    for (const range of matches.ranges) {
      output += source.slice(last, range.start) + replace;
      last = range.end;
    }
    output += source.slice(last);
    return { text: output, count: matches.ranges.length, error: null };
  }

  function inFencedCode(text, pos) {
    const before = String(text == null ? '' : text).slice(0, Math.max(0, pos));
    let inside = false;
    for (const line of before.split('\n')) {
      if (/^\s*(```+|~~~+)/.test(line)) inside = !inside;
    }
    return inside;
  }

  function listContinuation(text, pos) {
    const source = String(text == null ? '' : text);
    const lineStart = source.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let lineEnd = source.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = source.length;
    if (pos !== lineEnd) return null;
    if (inFencedCode(source, pos)) return null;
    const line = source.slice(lineStart, lineEnd);

    const task = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      if (!task[4].trim()) return { type: 'exit', from: lineStart, to: lineStart + task[0].length };
      return { type: 'continue', insert: `\n${task[1]}${task[2]} [ ] ` };
    }
    const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bullet) {
      if (!bullet[3].trim()) return { type: 'exit', from: lineStart, to: lineStart + bullet[0].length };
      return { type: 'continue', insert: `\n${bullet[1]}${bullet[2]} ` };
    }
    const ordered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
    if (ordered) {
      if (!ordered[4].trim()) return { type: 'exit', from: lineStart, to: lineStart + ordered[0].length };
      const next = String(Number(ordered[2]) + 1);
      return { type: 'continue', insert: `\n${ordered[1]}${next}${ordered[3]} ` };
    }
    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      if (!quote[2].trim()) return { type: 'exit', from: lineStart, to: lineStart + quote[0].length };
      return { type: 'continue', insert: `\n${quote[1]}> ` };
    }
    return null;
  }

  function stripInline(value) {
    let text = String(value == null ? '' : value);
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/`([^`]*)`/g, '$1');
    text = text.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1');
    text = text.replace(/\\([\\`*_{}\[\]()#+.!>-])/g, '$1');
    return text;
  }

  function extractHeadings(text) {
    const headings = [];
    const lines = String(text == null ? '' : text).split('\n');
    let fence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(```+|~~~+)/.test(line)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      const match = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
      if (!match) continue;
      const title = stripInline(match[2]).trim() || match[2].trim();
      headings.push({ level: match[1].length, text: title, line: index });
    }
    return headings;
  }

  function displayWidth(value) {
    let width = 0;
    for (const char of String(value == null ? '' : value)) {
      const code = char.codePointAt(0);
      width += (code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
        || (code >= 0x2e80 && code <= 0xa4cf)
        || (code >= 0xac00 && code <= 0xd7a3)
        || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xfe30 && code <= 0xfe6f)
        || (code >= 0xff00 && code <= 0xff60)
        || (code >= 0xffe0 && code <= 0xffe6)
        || (code >= 0x1f300 && code <= 0x1f64f)
        || (code >= 0x20000 && code <= 0x3fffd))) ? 2 : 1;
    }
    return width;
  }

  function padCell(value, width) {
    const text = String(value == null ? '' : value);
    return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
  }

  function buildTable(headers, rows) {
    const head = Array.isArray(headers) && headers.length > 0 ? headers.map(String) : ['列 1', '列 2', '列 3'];
    const body = (Array.isArray(rows) ? rows : []).map((row) => {
      const cells = Array.isArray(row) ? row.map(String) : [];
      while (cells.length < head.length) cells.push('');
      return cells.slice(0, head.length);
    });
    const widths = head.map((cell, index) => {
      let width = displayWidth(cell);
      for (const row of body) width = Math.max(width, displayWidth(row[index]));
      return Math.max(3, width);
    });
    const renderRow = (cells) => `| ${cells.map((cell, index) => padCell(cell, widths[index])).join(' | ')} |`;
    const lines = [renderRow(head), `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`];
    for (const row of body) lines.push(renderRow(row));
    return lines.join('\n');
  }

  function splitRowCells(line, lineStart) {
    const firstPipe = line.indexOf('|');
    if (firstPipe < 0) return null;
    const lastPipe = line.lastIndexOf('|');
    if (lastPipe <= firstPipe) return null;
    const cells = [];
    let segmentStart = firstPipe + 1;
    let index = segmentStart;
    const pushCell = (from, to) => {
      let start = from;
      let end = to;
      while (start < end && /\s/.test(line[start])) start += 1;
      while (end > start && /\s/.test(line[end - 1])) end -= 1;
      cells.push({ start: lineStart + start, end: lineStart + end, raw: line.slice(start, end) });
    };
    while (index < lastPipe) {
      if (line[index] === '\\') {
        index += 2;
        continue;
      }
      if (line[index] === '|') {
        pushCell(segmentStart, index);
        segmentStart = index + 1;
      }
      index += 1;
    }
    pushCell(segmentStart, lastPipe);
    return cells;
  }

  function isSeparatorRow(cells) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.raw));
  }

  function nextTableCell(text, pos, direction) {
    const source = String(text == null ? '' : text);
    const lineStart = source.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let lineEnd = source.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = source.length;
    const currentLine = source.slice(lineStart, lineEnd);
    if (!/^\s*\|/.test(currentLine)) return null;

    let blockStart = lineStart;
    let blockEnd = lineEnd;
    while (blockStart > 0) {
      const previousEnd = blockStart - 1;
      const previousStart = source.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
      const previousLine = source.slice(previousStart, previousEnd);
      if (!/^\s*\|/.test(previousLine)) break;
      blockStart = previousStart;
    }
    while (blockEnd < source.length) {
      const nextStart = blockEnd + 1;
      let nextEnd = source.indexOf('\n', nextStart);
      if (nextEnd < 0) nextEnd = source.length;
      const nextLine = source.slice(nextStart, nextEnd);
      if (!/^\s*\|/.test(nextLine)) break;
      blockEnd = nextEnd;
    }

    const rows = [];
    let cursor = blockStart;
    while (cursor <= blockEnd) {
      let end = source.indexOf('\n', cursor);
      if (end < 0 || end > blockEnd) end = blockEnd;
      const line = source.slice(cursor, end);
      const cells = splitRowCells(line, cursor);
      if (!cells) break;
      rows.push({ start: cursor, end, cells, separator: isSeparatorRow(cells) });
      cursor = end + 1;
    }
    const navigable = rows.filter((row) => !row.separator);
    if (navigable.length === 0) return null;

    let rowIndex = navigable.findIndex((row) => pos >= row.start && pos <= row.end);
    if (rowIndex < 0) {
      rowIndex = rows.findIndex((row) => pos >= row.start && pos <= row.end);
      if (rowIndex < 0) return null;
      if (rows[rowIndex].separator) return null;
      rowIndex = navigable.indexOf(rows[rowIndex]);
    }
    const row = navigable[rowIndex];
    let cellIndex = row.cells.findIndex((cell) => pos >= cell.start && pos <= cell.end);
    if (cellIndex < 0) {
      cellIndex = row.cells.findIndex((cell) => pos <= cell.start);
      if (cellIndex < 0) cellIndex = row.cells.length - 1;
    }

    const step = direction < 0 ? -1 : 1;
    let nextRow = rowIndex;
    let nextCell = cellIndex + step;
    if (nextCell >= row.cells.length) {
      nextRow = (rowIndex + 1) % navigable.length;
      nextCell = 0;
    } else if (nextCell < 0) {
      nextRow = (rowIndex - 1 + navigable.length) % navigable.length;
      nextCell = navigable[nextRow].cells.length - 1;
    }
    const target = navigable[nextRow].cells[nextCell];
    return { start: target.start, end: target.end };
  }

  function countWords(text) {
    const source = String(text == null ? '' : text);
    if (!source) return 0;
    if (source.length > 300000) return null;
    const cjk = source.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
    const rest = source.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ');
    const latin = rest.match(/[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g);
    return (cjk ? cjk.length : 0) + (latin ? latin.length : 0);
  }

  function readingMinutes(text, wordsPerMinute) {
    const words = countWords(text);
    if (words == null) return null;
    const speed = Number(wordsPerMinute) > 0 ? Number(wordsPerMinute) : 300;
    return Math.max(1, Math.ceil(words / speed));
  }

  return {
    findMatches,
    replaceAll,
    inFencedCode,
    listContinuation,
    extractHeadings,
    buildTable,
    nextTableCell,
    countWords,
    readingMinutes,
    displayWidth,
    stripInline
  };
}));
