'use strict';

const fs = require('fs/promises');
const path = require('path');
const files = require('./files');
const T = require('../shared/text');

const MAX_DOC_SIZE = 2 * 1024 * 1024;
const MAX_DOCS = 3000;
const BATCH = 16;

const stores = new Map();
const pending = new Map();

function cacheKey(root) {
  return path.resolve(root).toLowerCase();
}

function normalizeRel(relPath) {
  return String(relPath == null ? '' : relPath).replace(/\\/g, '/');
}

function fileStem(name) {
  return String(name == null ? '' : name).replace(/\.[^.]+$/, '');
}

function fallbackDoc(relPath, name, stat) {
  return {
    relPath,
    name,
    title: fileStem(name),
    tags: [],
    links: [],
    words: null,
    mtimeMs: stat ? Number(stat.mtimeMs) || 0 : 0,
    size: stat ? Number(stat.size) || 0 : 0
  };
}

function collectFiles(tree) {
  const all = [];
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === 'dir') walk(child);
      else if (child.type === 'file' && child.relPath) all.push(child);
    }
  };
  walk(tree);
  return { list: all.slice(0, MAX_DOCS), truncated: all.length > MAX_DOCS };
}

function sortedDocuments(map) {
  return [...map.values()].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

function aggregateTags(documents) {
  const map = new Map();
  for (const doc of documents) {
    for (const tag of doc.tags) {
      const key = tag.toLowerCase();
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { name: tag, count: 1 });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 50);
}

function snapshot(root) {
  const store = stores.get(cacheKey(root));
  if (!store) return null;
  const documents = sortedDocuments(store.files);
  return { documents, tags: aggregateTags(documents), truncated: store.truncated };
}

async function readEntry(rootAbs, node, previous) {
  const abs = path.join(rootAbs, node.relPath);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const cached = previous ? previous.get(node.relPath) : null;
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
  const name = node.name || path.basename(abs);
  if (stat.size > MAX_DOC_SIZE) return fallbackDoc(node.relPath, name, stat);
  try {
    const doc = await files.readDoc(abs);
    const parsed = T.parseFrontmatter(doc.content);
    return {
      relPath: node.relPath,
      name,
      title: T.documentTitle(doc.content, fileStem(name)),
      tags: parsed.tags,
      links: T.extractWikiLinks(doc.content),
      words: T.countWords(doc.content),
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  } catch {
    return fallbackDoc(node.relPath, name, stat);
  }
}

function build(root, workspaceTree) {
  const rootAbs = path.resolve(root);
  const key = cacheKey(rootAbs);
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    const previous = stores.get(key);
    const collected = collectFiles(workspaceTree);
    const next = new Map();
    for (let index = 0; index < collected.list.length; index += BATCH) {
      const batch = collected.list.slice(index, index + BATCH);
      const entries = await Promise.all(
        batch.map((node) => readEntry(rootAbs, node, previous ? previous.files : null))
      );
      for (const entry of entries) {
        if (entry) next.set(entry.relPath, entry);
      }
    }
    stores.set(key, { files: next, truncated: collected.truncated });
    return snapshot(rootAbs);
  })().finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

function upsert(root, relPath, content, meta) {
  const store = stores.get(cacheKey(root));
  if (!store) return null;
  const key = normalizeRel(relPath);
  if (!key) return null;
  const name = path.basename(key);
  const text = String(content == null ? '' : content);
  const parsed = T.parseFrontmatter(text);
  const doc = {
    relPath: key,
    name,
    title: T.documentTitle(text, fileStem(name)),
    tags: parsed.tags,
    links: T.extractWikiLinks(text),
    words: T.countWords(text),
    mtimeMs: Number(meta && meta.mtimeMs) || 0,
    size: Number(meta && meta.size) || 0
  };
  store.files.set(key, doc);
  return doc;
}

function rename(root, oldRelPath, newRelPath) {
  const store = stores.get(cacheKey(root));
  if (!store) return;
  const oldKey = normalizeRel(oldRelPath);
  const newKey = normalizeRel(newRelPath);
  if (!oldKey || !newKey) return;
  const moves = [];
  for (const [relPath, doc] of store.files) {
    let target = null;
    if (relPath === oldKey) target = newKey;
    else if (relPath.startsWith(`${oldKey}/`)) target = `${newKey}${relPath.slice(oldKey.length)}`;
    if (!target) continue;
    const name = path.basename(target);
    const title = doc.title === fileStem(doc.name) ? fileStem(name) : doc.title;
    moves.push([relPath, { ...doc, relPath: target, name, title }]);
  }
  for (const [relPath, doc] of moves) {
    store.files.delete(relPath);
    store.files.set(doc.relPath, doc);
  }
}

function remove(root, relPath) {
  const store = stores.get(cacheKey(root));
  if (!store) return;
  const target = normalizeRel(relPath);
  if (!target) return;
  for (const relPath of [...store.files.keys()]) {
    if (relPath === target || relPath.startsWith(`${target}/`)) store.files.delete(relPath);
  }
}

function clear(root) {
  stores.delete(cacheKey(root));
}

function backlinks(root, relPath) {
  const store = stores.get(cacheKey(root));
  if (!store) return [];
  return T.findBacklinks([...store.files.values()], normalizeRel(relPath));
}

function resolve(root, target) {
  const store = stores.get(cacheKey(root));
  if (!store) return null;
  return T.resolveWikilink(target, [...store.files.values()]);
}

module.exports = {
  build,
  snapshot,
  upsert,
  rename,
  remove,
  clear,
  backlinks,
  resolve,
  MAX_DOCS
};
