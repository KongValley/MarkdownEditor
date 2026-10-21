'use strict';

const fs = require('fs/promises');
const path = require('path');
const { shell } = require('electron');

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist']);
const MAX_TREE_ENTRIES = 5000;
const MAX_SEARCH_FILES = 3000;
const MAX_SEARCH_RESULTS = 200;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_SEARCH_FILE_SIZE = 1024 * 1024;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function isMarkdownPath(filePath) {
  return MARKDOWN_EXTS.has(path.extname(String(filePath)).toLowerCase());
}

function compileIgnore(patterns) {
  if (!Array.isArray(patterns)) return [];
  const matchers = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern) continue;
    let source = '^';
    for (const char of pattern) {
      if (char === '*') source += '.*';
      else if (char === '?') source += '.';
      else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    source += '$';
    matchers.push({ hasSlash: pattern.includes('/'), regex: new RegExp(source, 'i') });
  }
  return matchers;
}

function isIgnored(name, relPath, matchers) {
  for (const matcher of matchers) {
    if (matcher.regex.test(matcher.hasSlash ? relPath : name)) return true;
  }
  return false;
}

function isInside(root, target) {
  if (!root) return false;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveInside(root, relPath) {
  if (!root) throw new Error('尚未打开文件夹');
  if (typeof relPath !== 'string' || relPath.includes('\0')) throw new Error('无效的路径');
  const abs = path.resolve(root, relPath);
  if (!isInside(root, abs)) throw new Error('路径超出当前文件夹范围');
  return abs;
}

function toRelPath(root, abs) {
  if (!root) return null;
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function decodeBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: 'utf16le', content: buffer.subarray(2).toString('utf16le') };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf8bom', content: buffer.subarray(3).toString('utf8') };
  }
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('文件不是 UTF-8 或 UTF-16LE 编码，暂不支持打开。请先转换编码。');
  }
  if (content.includes('\0')) throw new Error('文件疑似二进制内容，无法作为 Markdown 打开。');
  return { encoding: 'utf8', content };
}

function encodeDocument(content, encoding) {
  if (encoding === 'utf16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
  }
  if (encoding === 'utf8bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]);
  }
  return Buffer.from(content, 'utf8');
}

async function readDoc(absPath) {
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (stat.size > MAX_FILE_SIZE) throw new Error('文件超过 10 MB，已停止打开以保护编辑器');
  const buffer = await fs.readFile(absPath);
  const decoded = decodeBuffer(buffer);
  const eol = /\r\n/.test(decoded.content) ? 'crlf' : 'lf';
  return {
    path: path.resolve(absPath),
    name: path.basename(absPath),
    content: normalizeEol(decoded.content),
    encoding: decoded.encoding,
    eol,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

async function atomicWrite(absPath, buffer) {
  const dir = path.dirname(absPath);
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, buffer);
  try {
    await fs.rename(tmp, absPath);
  } catch (error) {
    // Windows 上文件被占用时 rename 可能失败，退化为覆盖写入。
    try {
      await fs.copyFile(tmp, absPath);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
    if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
}

async function writeDoc(absPath, options) {
  const { content, eol = 'lf', encoding = 'utf8', expectedMtime = null, force = false } = options;
  let stat = null;
  try {
    stat = await fs.stat(absPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat) {
    if (!stat.isFile()) throw new Error('保存目标不是文件');
    if (expectedMtime != null && !force && stat.mtimeMs !== expectedMtime) {
      return { conflict: true, mtimeMs: stat.mtimeMs };
    }
  } else if (expectedMtime != null) {
    return { missing: true };
  }

  if (typeof options.onBeforeWrite === 'function') await options.onBeforeWrite();
  const normalized = normalizeEol(String(content));
  const finalContent = eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
  await atomicWrite(absPath, encodeDocument(finalContent, encoding));
  const after = await fs.stat(absPath);
  return { conflict: false, mtimeMs: after.mtimeMs, size: after.size };
}

async function listWorkspace(root, options = {}) {
  const rootAbs = path.resolve(root);
  const matchers = compileIgnore(options.ignore);
  const rootNode = {
    type: 'dir',
    name: path.basename(rootAbs) || rootAbs,
    relPath: '',
    children: []
  };
  const stats = { count: 0, files: 0, truncated: false };

  async function walk(absDir, node) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
    for (const entry of entries) {
      if (stats.count >= MAX_TREE_ENTRIES) {
        stats.truncated = true;
        return;
      }
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const abs = path.join(absDir, entry.name);
      const relPath = toRelPath(rootAbs, abs);
      if (isIgnored(entry.name, relPath, matchers)) continue;
      if (entry.isDirectory()) {
        const child = { type: 'dir', name: entry.name, relPath, children: [] };
        node.children.push(child);
        stats.count += 1;
        await walk(abs, child);
      } else if (entry.isFile() && isMarkdownPath(entry.name)) {
        node.children.push({ type: 'file', name: entry.name, relPath });
        stats.count += 1;
        stats.files += 1;
      }
    }
  }

  await walk(rootAbs, rootNode);
  return {
    root: rootAbs,
    name: rootNode.name,
    tree: rootNode,
    truncated: stats.truncated,
    fileCount: stats.files
  };
}

function validateEntryName(rawName, type, originalPath = null) {
  let name = String(rawName || '').trim();
  if (!name) throw new Error('名称不能为空');
  if (name === '.' || name === '..') throw new Error('名称无效');
  if (name.length > 120) throw new Error('名称不能超过 120 个字符');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) throw new Error('名称不能包含 < > : " / \\ | ? * 等字符');
  if (/[. ]$/.test(name)) throw new Error('名称不能以句点或空格结尾');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) throw new Error('该名称是 Windows 保留名称');

  if (type === 'file') {
    const ext = path.extname(name);
    if (!ext) {
      const originalExt = originalPath ? path.extname(originalPath) : '';
      name += MARKDOWN_EXTS.has(originalExt.toLowerCase()) ? originalExt : '.md';
    } else if (!isMarkdownPath(name)) {
      throw new Error('仅支持 .md / .markdown / .mdown / .txt 文件');
    }
  }
  return name;
}

async function createEntry(root, parentRel, name, type) {
  const parentAbs = resolveInside(root, parentRel || '');
  const parentStat = await fs.stat(parentAbs);
  if (!parentStat.isDirectory()) throw new Error('目标位置不是文件夹');
  const safeName = validateEntryName(name, type);
  const target = path.join(parentAbs, safeName);
  if (!isInside(root, target)) throw new Error('路径超出当前文件夹范围');
  try {
    if (type === 'dir') {
      await fs.mkdir(target);
    } else {
      await fs.writeFile(target, '', { flag: 'wx' });
    }
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('已存在同名文件或文件夹');
    throw error;
  }
  return { relPath: toRelPath(root, target), type, name: safeName };
}

async function renameEntry(root, relPath, rawName) {
  const oldAbs = resolveInside(root, relPath);
  const stat = await fs.stat(oldAbs);
  const type = stat.isDirectory() ? 'dir' : 'file';
  const safeName = validateEntryName(rawName, type, oldAbs);
  const newAbs = path.join(path.dirname(oldAbs), safeName);
  if (!isInside(root, newAbs)) throw new Error('路径超出当前文件夹范围');
  if (path.resolve(newAbs) === path.resolve(oldAbs)) return { oldRelPath: relPath, newRelPath: relPath, type };
  try {
    await fs.access(newAbs);
    throw new Error('已存在同名文件或文件夹');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(oldAbs, newAbs);
  return {
    oldRelPath: relPath,
    newRelPath: toRelPath(root, newAbs),
    type,
    name: safeName
  };
}

async function deleteEntry(root, relPath) {
  const abs = resolveInside(root, relPath);
  if (abs === path.resolve(root)) throw new Error('不能删除当前打开的文件夹');
  await shell.trashItem(abs);
  return { relPath };
}

async function searchWorkspace(root, rawQuery, options = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return { results: [], truncated: false, filesScanned: 0 };
  const matchers = compileIgnore(options.ignore);
  if (query.length > 100) throw new Error('搜索内容过长');
  const maxResults = Math.max(1, Math.min(500, Number(options.limit) || MAX_SEARCH_RESULTS));
  const needle = query.toLowerCase();
  const results = [];
  let filesScanned = 0;
  let truncated = false;

  async function walk(absDir) {
    if (truncated || filesScanned >= MAX_SEARCH_FILES) {
      if (filesScanned >= MAX_SEARCH_FILES) truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const abs = path.join(absDir, entry.name);
      const relPath = toRelPath(root, abs);
      if (isIgnored(entry.name, relPath, matchers)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile() || !isMarkdownPath(entry.name)) continue;
      filesScanned += 1;
      if (filesScanned > MAX_SEARCH_FILES) {
        truncated = true;
        return;
      }
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_SEARCH_FILE_SIZE) continue;
      let text;
      try {
        text = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r\n|\n|\r/);
      let perFile = 0;
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(needle)) continue;
        if (results.length >= maxResults) {
          truncated = true;
          return;
        }
        let snippet = lines[index].trim().replace(/\s+/g, ' ');
        if (snippet.length > 180) snippet = `${snippet.slice(0, 180)}…`;
        results.push({
          relPath: toRelPath(root, abs),
          name: entry.name,
          line: index + 1,
          text: snippet
        });
        perFile += 1;
        if (perFile >= 20) break;
      }
    }
  }

  await walk(path.resolve(root));
  return { results, truncated, filesScanned };
}

async function openLinkedPath(baseDir, href) {
  const raw = String(href || '').trim();
  if (!raw) throw new Error('链接为空');
  if (/^(https?:|mailto:)/i.test(raw)) return { external: raw };
  const clean = raw.split('#')[0].split('?')[0];
  if (!clean) return { anchor: true };
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  let target;
  if (/^file:/i.test(decoded)) {
    const { fileURLToPath } = require('url');
    target = fileURLToPath(decoded);
  } else if (/^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith('\\\\')) {
    target = decoded;
  } else {
    target = path.resolve(baseDir, decoded);
  }
  const stat = await fs.stat(target);
  if (stat.isDirectory()) return { directory: path.resolve(target) };
  if (!stat.isFile()) throw new Error('链接目标不是文件');
  if (!isMarkdownPath(target)) throw new Error('为安全起见，仅支持打开 Markdown/文本链接');
  return { path: path.resolve(target) };
}

module.exports = {
  isMarkdownPath,
  isInside,
  resolveInside,
  toRelPath,
  readDoc,
  writeDoc,
  listWorkspace,
  createEntry,
  renameEntry,
  deleteEntry,
  searchWorkspace,
  openLinkedPath,
  validateEntryName,
  normalizeEol
};
