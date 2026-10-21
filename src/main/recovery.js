'use strict';

const fs = require('fs/promises');
const path = require('path');

const MAX_ENTRIES = 20;
const MAX_CONTENT = 12 * 1024 * 1024;

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = typeof raw.content === 'string' ? raw.content : null;
  if (content == null || content.length > MAX_CONTENT) return null;
  const absPath = typeof raw.path === 'string' && raw.path ? path.resolve(raw.path) : null;
  const key = typeof raw.key === 'string' && raw.key
    ? raw.key.toLowerCase()
    : (absPath ? absPath.toLowerCase() : null);
  if (!key) return null;
  return {
    key,
    path: absPath,
    name: typeof raw.name === 'string' && raw.name ? raw.name : (absPath ? path.basename(absPath) : '未命名'),
    relPath: typeof raw.relPath === 'string' ? raw.relPath : null,
    library: typeof raw.library === 'string' && path.isAbsolute(raw.library) ? path.resolve(raw.library) : null,
    content,
    eol: raw.eol === 'crlf' ? 'crlf' : 'lf',
    encoding: raw.encoding === 'utf16le' || raw.encoding === 'utf8bom' ? raw.encoding : 'utf8',
    mtimeMs: Number.isFinite(raw.mtimeMs) ? Number(raw.mtimeMs) : null,
    timestamp: Number.isFinite(raw.timestamp) ? Number(raw.timestamp) : Date.now()
  };
}

class RecoveryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
    this.cache = null;
  }

  async load() {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      const entries = Array.isArray(data && data.entries) ? data.entries : [];
      this.cache = entries.map(normalizeEntry).filter(Boolean);
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  async write(entries) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
    try {
      await fs.rename(tmp, this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  mutate(mutator) {
    this.queue = this.queue.then(async () => {
      const entries = (await this.load()).slice();
      const next = (await mutator(entries)) || entries;
      this.cache = next.slice(0, MAX_ENTRIES);
      await this.write(this.cache);
      return this.cache;
    }).catch((error) => {
      this.queue = Promise.resolve();
      throw error;
    });
    return this.queue;
  }

  save(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) return Promise.resolve(null);
    return this.mutate((entries) => [normalized, ...entries.filter((item) => item.key !== normalized.key)]);
  }

  clear(key) {
    if (typeof key !== 'string') return Promise.resolve(null);
    const lower = key.toLowerCase();
    return this.mutate((entries) => entries.filter((item) => item.key !== lower));
  }

  clearMany(keys) {
    const set = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key).toLowerCase()));
    return this.mutate((entries) => entries.filter((item) => !set.has(item.key)));
  }

  clearAll() {
    return this.mutate(() => []);
  }
}

module.exports = RecoveryStore;
