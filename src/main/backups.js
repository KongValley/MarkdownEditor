'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const files = require('./files');

const MAX_BACKUPS = 20;
const THROTTLE_MS = 60 * 1000;
const lastBackupAt = new Map();

function hashKey(absPath) {
  return crypto.createHash('sha1').update(path.resolve(absPath).toLowerCase()).digest('hex').slice(0, 16);
}

function isValidId(id, key) {
  return typeof id === 'string'
    && id.startsWith(`${key}-`)
    && /^[a-f0-9]{16}-\d+-[a-z0-9]+\.bak$/.test(id);
}

async function listBackups(baseDir, absPath) {
  const key = hashKey(absPath);
  let names = [];
  try {
    names = await fs.readdir(baseDir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names) {
    if (!name.startsWith(`${key}-`) || !name.endsWith('.bak')) continue;
    try {
      const stat = await fs.stat(path.join(baseDir, name));
      const time = Number(name.split('-')[1]) || stat.mtimeMs;
      items.push({ id: name, time, size: stat.size });
    } catch {
      // 忽略读取失败的快照。
    }
  }
  items.sort((a, b) => b.time - a.time);
  return items;
}

async function createBackup(baseDir, absPath, options = {}) {
  const resolved = path.resolve(absPath);
  const force = Boolean(options.force);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const key = hashKey(resolved);
  const now = Date.now();
  if (!force && now - (lastBackupAt.get(key) || 0) < THROTTLE_MS) return null;
  await fs.mkdir(baseDir, { recursive: true });
  const id = `${key}-${now}-${crypto.randomBytes(3).toString('hex')}.bak`;
  const target = path.join(baseDir, id);
  const tmp = `${target}.tmp`;
  try {
    await fs.copyFile(resolved, tmp);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  lastBackupAt.set(key, now);
  const items = await listBackups(baseDir, resolved);
  for (const item of items.slice(MAX_BACKUPS)) {
    await fs.rm(path.join(baseDir, item.id), { force: true }).catch(() => {});
  }
  return { id, time: now, size: stat.size };
}

async function readBackup(baseDir, absPath, id) {
  const key = hashKey(absPath);
  if (!isValidId(id, key)) throw new Error('无效的快照编号');
  const target = path.join(baseDir, path.basename(id));
  const doc = await files.readDoc(target);
  return {
    content: doc.content,
    encoding: doc.encoding,
    eol: doc.eol,
    size: doc.size,
    time: Number(path.basename(id).split('-')[1]) || doc.mtimeMs
  };
}

module.exports = {
  createBackup,
  listBackups,
  readBackup,
  hashKey
};
