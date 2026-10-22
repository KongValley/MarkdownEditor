'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const files = require('./main/files');
const catalog = require('./main/catalog');
const RecoveryStore = require('./main/recovery');
const backups = require('./main/backups');

const APP_TITLE = 'Markdown 笔记';
const TEST = process.argv.includes('--smoke-test');
const SMOKE_BOOT = process.argv.includes('--smoke-boot');
const PORTABLE_FLAG = process.argv.includes('--portable');
const TEST_CONTROLS = {
  confirmResponse: 1,
  addLibraryPath: null,
  saveAsPath: null,
  printPath: null
};
const IS_WIN7 = process.platform === 'win32' && os.release().startsWith('6.1');
let portableMode = false;

if (TEST) {
  app.setPath('userData', path.join(os.tmpdir(), `markdown-notes-smoke-userdata-${process.pid}`));
} else if (PORTABLE_FLAG || app.isPackaged) {
  const portableCandidate = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'data')
    : path.join(__dirname, '..', 'data');
  if (PORTABLE_FLAG || fs.existsSync(portableCandidate)) {
    try {
      fs.mkdirSync(portableCandidate, { recursive: true });
      app.setPath('userData', portableCandidate);
      portableMode = true;
    } catch (error) {
      console.error(`便携模式初始化失败，回退默认数据目录：${error.message}`);
    }
  }
}
if ((IS_WIN7 || TEST) && !process.argv.includes('--enable-gpu')) {
  app.disableHardwareAcceleration();
}

const state = {
  workspaceRoot: null,
  allowedExternal: new Set()
};

let win = null;
let settings = defaultSettings();
let settingsFile = '';
let logFile = '';
let backupsDir = '';
let recoveryFile = '';
let recoveryStore = null;
let testRoot = null;
let secondRoot = null;
let thirdRoot = null;
let allowClose = false;
let closeInFlight = false;
let boundsTimer = null;

function defaultSettings() {
  return {
    bounds: null,
    maximized: false,
    lastFile: null,
    libraries: [],
    activeLibrary: null,
    starred: [],
    recent: [],
    theme: 'light',
    fontSize: 15,
    lineWidth: 0,
    autosave: true,
    autosaveDelay: 900,
    sidebar: true,
    outline: true,
    split: 0.5,
    remoteImages: false,
    syntaxHighlight: true,
    showReadingTime: true,
    wordGoal: 0,
    ignoreDirs: [],
    viewMode: 'split',
    librarySort: 'updated'
  };
}

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeIgnoreDirs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const pattern = item.trim();
    if (!pattern || pattern.length > 40) continue;
    if (pattern.includes('..') || /[<>:"|]/.test(pattern)) continue;
    const key = pattern.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pattern);
    if (result.length >= 30) break;
  }
  return result;
}

function normalizeLibraries(value) {
  const result = [];
  const seen = new Set();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path)) continue;
    const abs = path.resolve(item.path);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim().slice(0, 80)
      : (path.basename(abs) || abs);
    result.push({
      path: abs,
      name,
      addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : Date.now(),
      lastOpenedAt: Number.isFinite(Number(item.lastOpenedAt)) ? Number(item.lastOpenedAt) : 0,
      docCount: clampInt(item.docCount, 0, 1000000, 0)
    });
    if (result.length >= 50) break;
  }
  return result;
}

function normalizeStarred(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item.library !== 'string' || !path.isAbsolute(item.library)) continue;
    if (typeof item.relPath !== 'string' || !item.relPath || item.relPath.includes('\0')) continue;
    const library = path.resolve(item.library);
    const relPath = item.relPath.replace(/\\/g, '/');
    const key = `${library.toLowerCase()}\0${relPath.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ library, relPath, at: Number.isFinite(Number(item.at)) ? Number(item.at) : 0 });
    if (result.length >= 200) break;
  }
  return result;
}

function normalizeSettings(raw) {
  const result = defaultSettings();
  if (!raw || typeof raw !== 'object') return result;
  if (raw.bounds && Number.isFinite(raw.bounds.x) && Number.isFinite(raw.bounds.y)
    && Number.isFinite(raw.bounds.width) && Number.isFinite(raw.bounds.height)
    && raw.bounds.width >= 600 && raw.bounds.height >= 400) {
    result.bounds = {
      x: Math.round(raw.bounds.x),
      y: Math.round(raw.bounds.y),
      width: Math.round(raw.bounds.width),
      height: Math.round(raw.bounds.height)
    };
  }
  result.maximized = Boolean(raw.maximized);
  result.libraries = normalizeLibraries(raw.libraries);
  if (result.libraries.length === 0 && typeof raw.lastWorkspace === 'string' && path.isAbsolute(raw.lastWorkspace)) {
    const abs = path.resolve(raw.lastWorkspace);
    result.libraries.push({
      path: abs,
      name: path.basename(abs) || abs,
      addedAt: Date.now(),
      lastOpenedAt: 0,
      docCount: 0
    });
  }
  const rawActive = typeof raw.activeLibrary === 'string' && raw.activeLibrary
    ? raw.activeLibrary
    : (typeof raw.lastWorkspace === 'string' ? raw.lastWorkspace : '');
  const active = rawActive
    ? result.libraries.find((lib) => samePath(lib.path, rawActive))
    : null;
  result.activeLibrary = active ? active.path : (result.libraries[0] ? result.libraries[0].path : null);
  result.starred = normalizeStarred(raw.starred);
  result.lastFile = typeof raw.lastFile === 'string' ? raw.lastFile : null;
  if (Array.isArray(raw.recent)) {
    const seen = new Set();
    result.recent = raw.recent.filter((item) => {
      if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path)) return false;
      if (item.type === 'folder') return false;
      const key = item.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10).map((item) => ({
      path: path.resolve(item.path),
      name: typeof item.name === 'string' && item.name ? item.name : path.basename(item.path) || item.path,
      at: Number(item.at) || 0
    }));
  }
  result.theme = raw.theme === 'dark' ? 'dark' : 'light';
  result.fontSize = clampInt(raw.fontSize, 12, 22, 15);
  result.lineWidth = [0, 720, 900].includes(Number(raw.lineWidth)) ? Number(raw.lineWidth) : 0;
  result.autosave = raw.autosave !== false;
  result.autosaveDelay = clampInt(raw.autosaveDelay, 300, 5000, 900);
  result.sidebar = raw.sidebar !== false;
  result.outline = raw.outline !== false;
  result.split = clampNumber(raw.split, 0.2, 0.8, 0.5);
  result.remoteImages = Boolean(raw.remoteImages);
  result.syntaxHighlight = raw.syntaxHighlight !== false;
  result.showReadingTime = raw.showReadingTime !== false;
  result.wordGoal = clampInt(raw.wordGoal, 0, 1000000, 0);
  result.ignoreDirs = normalizeIgnoreDirs(raw.ignoreDirs);
  result.viewMode = ['split', 'editor', 'reading'].includes(raw.viewMode)
    ? raw.viewMode
    : (raw.preview === false ? 'editor' : 'split');
  result.librarySort = raw.librarySort === 'name' ? 'name' : 'updated';
  return result;
}

function publicSettings() {
  return {
    theme: settings.theme,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    autosave: settings.autosave,
    autosaveDelay: settings.autosaveDelay,
    sidebar: settings.sidebar,
    outline: settings.outline,
    split: settings.split,
    remoteImages: settings.remoteImages,
    syntaxHighlight: settings.syntaxHighlight,
    showReadingTime: settings.showReadingTime,
    wordGoal: settings.wordGoal,
    ignoreDirs: settings.ignoreDirs,
    viewMode: settings.viewMode,
    librarySort: settings.librarySort
  };
}

function applySettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return publicSettings();
  if (patch.theme === 'light' || patch.theme === 'dark') settings.theme = patch.theme;
  if (patch.fontSize !== undefined) settings.fontSize = clampInt(patch.fontSize, 12, 22, settings.fontSize);
  if (patch.lineWidth !== undefined) {
    const width = Number(patch.lineWidth);
    if ([0, 720, 900].includes(width)) settings.lineWidth = width;
  }
  if (patch.autosave !== undefined) settings.autosave = Boolean(patch.autosave);
  if (patch.autosaveDelay !== undefined) settings.autosaveDelay = clampInt(patch.autosaveDelay, 300, 5000, settings.autosaveDelay);
  if (patch.sidebar !== undefined) settings.sidebar = Boolean(patch.sidebar);
  if (patch.outline !== undefined) settings.outline = Boolean(patch.outline);
  if (patch.split !== undefined) settings.split = clampNumber(patch.split, 0.2, 0.8, settings.split);
  if (patch.remoteImages !== undefined) settings.remoteImages = Boolean(patch.remoteImages);
  if (patch.syntaxHighlight !== undefined) settings.syntaxHighlight = Boolean(patch.syntaxHighlight);
  if (patch.showReadingTime !== undefined) settings.showReadingTime = Boolean(patch.showReadingTime);
  if (patch.wordGoal !== undefined) settings.wordGoal = clampInt(patch.wordGoal, 0, 1000000, settings.wordGoal);
  if (patch.ignoreDirs !== undefined) settings.ignoreDirs = normalizeIgnoreDirs(patch.ignoreDirs);
  if (['split', 'editor', 'reading'].includes(patch.viewMode)) settings.viewMode = patch.viewMode;
  if (patch.librarySort === 'updated' || patch.librarySort === 'name') settings.librarySort = patch.librarySort;
  persistSettings();
  return publicSettings();
}

function initPaths() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  logFile = path.join(app.getPath('userData'), 'logs', 'main.log');
  backupsDir = path.join(app.getPath('userData'), 'backups');
  recoveryFile = path.join(app.getPath('userData'), 'recovery.json');
  recoveryStore = new RecoveryStore(recoveryFile);
}

function loadSettings() {
  try {
    const text = fs.readFileSync(settingsFile, 'utf8');
    return normalizeSettings(JSON.parse(text));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('error', 'settings', `读取设置失败：${error.stack || error}`);
      try {
        fs.renameSync(settingsFile, `${settingsFile}.bad`);
      } catch {
        // 忽略备份失败。
      }
    }
    return defaultSettings();
  }
}

function persistSettings() {
  if (!settingsFile) return;
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const tmp = `${settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, settingsFile);
    } catch {
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
      fs.rmSync(tmp, { force: true });
    }
  } catch (error) {
    log('error', 'settings', `保存设置失败：${error.stack || error}`);
  }
}

function initLogging() {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      fs.renameSync(logFile, logFile.replace(/\.log$/, '.old.log'));
    }
  } catch {
    // 日志不可写时仍继续运行。
  }
  log('info', 'app', `${APP_TITLE} ${app.getVersion()} | Electron ${process.versions.electron} | Chrome ${process.versions.chrome} | Node ${process.versions.node} | ${process.arch} | ${os.release()}`);
}

function log(level, scope, message) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}\n`;
  try {
    if (logFile) fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    // 忽略日志写入失败。
  }
  if (level === 'error') console.error(line.trim());
  else if (level === 'warn') console.warn(line.trim());
  else console.log(line.trim());
}

function openLogDir() {
  shell.openPath(path.dirname(logFile)).catch((error) => log('warn', 'logs', error.message));
}

function copyLogPath() {
  clipboard.writeText(logFile);
}

function clearLogs() {
  const choice = TEST ? 1 : dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: APP_TITLE,
    message: '清空主进程日志？',
    detail: logFile,
    buttons: ['取消', '清空'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (choice !== 1) return false;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, '', 'utf8');
    log('info', 'logs', '日志已清空');
  } catch (error) {
    log('error', 'logs', `清空日志失败：${error.message}`);
    return false;
  }
  return true;
}

function formatError(error) {
  if (!error) return '未知错误';
  if (error.code === 'ENOENT') return '文件或文件夹不存在';
  if (error.code === 'EACCES' || error.code === 'EPERM') return '没有权限访问该文件或文件夹';
  if (error.code === 'ENOSPC') return '磁盘空间不足';
  return error.message || String(error);
}

function samePath(a, b) {
  return path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
}

function findLibrary(absPath) {
  return settings.libraries.find((lib) => samePath(lib.path, absPath)) || null;
}

function findLibraryForPath(absPath) {
  return settings.libraries.find((lib) => files.isInside(lib.path, absPath)) || null;
}

async function describeLibraries() {
  const result = [];
  for (const lib of settings.libraries) {
    let exists = false;
    try {
      exists = (await fsp.stat(lib.path)).isDirectory();
    } catch {
      exists = false;
    }
    result.push({
      ...lib,
      exists,
      active: Boolean(settings.activeLibrary && samePath(lib.path, settings.activeLibrary))
    });
  }
  return result;
}

async function publicStarred() {
  const result = [];
  const kept = [];
  let changed = false;
  for (const star of settings.starred) {
    const lib = findLibrary(star.library);
    if (!lib) {
      changed = true;
      continue;
    }
    try {
      const abs = files.resolveInside(lib.path, star.relPath);
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) {
        changed = true;
        continue;
      }
      kept.push(star);
      result.push({
        library: lib.path,
        libraryName: lib.name,
        relPath: star.relPath,
        name: path.basename(abs),
        at: star.at
      });
    } catch {
      changed = true;
    }
  }
  if (changed) {
    settings.starred = kept;
    persistSettings();
  }
  result.sort((a, b) => b.at - a.at);
  return result;
}

function addRecent(absPath) {
  const resolved = path.resolve(absPath);
  const key = resolved.toLowerCase();
  settings.recent = [
    {
      path: resolved,
      name: path.basename(resolved) || resolved,
      at: Date.now()
    },
    ...settings.recent.filter((item) => item.path.toLowerCase() !== key)
  ].slice(0, 10);
}

function allowExternal(absPath) {
  state.allowedExternal.add(path.resolve(absPath).toLowerCase());
}

function isAllowedPath(absPath) {
  if (findLibraryForPath(absPath)) return true;
  return state.allowedExternal.has(path.resolve(absPath).toLowerCase());
}

function resolveDocTarget(payload) {
  if (payload && typeof payload.relPath === 'string') {
    const root = payload.library ? path.resolve(payload.library) : state.workspaceRoot;
    const lib = root ? findLibrary(root) : null;
    if (!lib) throw new Error('知识库未注册');
    return { abs: files.resolveInside(lib.path, payload.relPath), root: lib.path };
  }
  if (payload && typeof payload.path === 'string' && payload.path) {
    const abs = path.resolve(payload.path);
    if (!isAllowedPath(abs)) throw new Error('无权访问该文件');
    const lib = findLibraryForPath(abs);
    return { abs, root: lib ? lib.path : null };
  }
  throw new Error('缺少文件路径');
}

function listOptions() {
  return { ignore: settings.ignoreDirs };
}

async function setActiveLibrary(absPath) {
  const lib = findLibrary(absPath);
  if (!lib) throw new Error('知识库不存在');
  const stat = await fsp.stat(lib.path);
  if (!stat.isDirectory()) throw new Error('知识库文件夹不存在或被移动');
  state.workspaceRoot = lib.path;
  settings.activeLibrary = lib.path;
  lib.lastOpenedAt = Date.now();
  const workspace = await files.listWorkspace(lib.path, listOptions());
  lib.docCount = workspace.fileCount;
  persistSettings();
  return workspace;
}

async function addOrOpenLibrary(absPath) {
  const abs = path.resolve(absPath);
  const stat = await fsp.stat(abs);
  if (!stat.isDirectory()) throw new Error('目标不是文件夹');
  let lib = findLibrary(abs);
  if (!lib) {
    for (const other of settings.libraries) {
      if (files.isInside(other.path, abs)) {
        throw new Error(`该文件夹已包含在知识库「${other.name}」中`);
      }
      if (files.isInside(abs, other.path)) {
        throw new Error(`该文件夹包含已有知识库「${other.name}」，请选择更具体的文件夹`);
      }
    }
    if (settings.libraries.length >= 50) throw new Error('知识库数量已达上限（50 个）');
    lib = {
      path: abs,
      name: path.basename(abs) || abs,
      addedAt: Date.now(),
      lastOpenedAt: 0,
      docCount: 0
    };
    settings.libraries.push(lib);
  }
  const workspace = await setActiveLibrary(lib.path);
  return { workspace, libraries: await describeLibraries() };
}

async function openExternalFile(absPath) {
  const abs = path.resolve(absPath);
  if (!files.isMarkdownPath(abs)) throw new Error('只能打开 Markdown 或文本文件');
  const lib = findLibraryForPath(abs);
  if (lib && !samePath(state.workspaceRoot, lib.path)) {
    state.workspaceRoot = lib.path;
    settings.activeLibrary = lib.path;
    lib.lastOpenedAt = Date.now();
  }
  allowExternal(abs);
  settings.lastFile = abs;
  addRecent(abs);
  persistSettings();
  const doc = await files.readDoc(abs);
  doc.library = lib ? lib.path : null;
  doc.relPath = lib ? files.toRelPath(lib.path, abs) : null;
  return doc;
}

async function applyPath(target) {
  const abs = path.resolve(target);
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) {
    const opened = await addOrOpenLibrary(abs);
    return { libraries: opened.libraries, workspace: opened.workspace, file: null };
  }
  if (!stat.isFile()) throw new Error('只能打开文件或文件夹');
  if (!files.isMarkdownPath(abs)) throw new Error('只能打开 .md / .markdown / .mdown / .txt 文件');
  if (!findLibraryForPath(abs)) allowExternal(abs);
  const file = await openExternalFile(abs);
  const workspace = state.workspaceRoot ? await files.listWorkspace(state.workspaceRoot, listOptions()) : null;
  return { libraries: await describeLibraries(), workspace, file };
}

function cliTargets(argv) {
  const args = argv.slice(1);
  if (!app.isPackaged) args.shift();
  return args.filter((arg) => arg && !arg.startsWith('-') && arg !== '.');
}

async function initializeState() {
  if (TEST) {
    const harness = require('../scripts/smoke-harness');
    const prepared = await harness.prepare();
    testRoot = prepared.root;
    secondRoot = prepared.secondRoot;
    thirdRoot = prepared.thirdRoot;
    state.workspaceRoot = testRoot;
    settings = defaultSettings();
    settings.libraries = [
      { path: prepared.root, name: '测试库', addedAt: 1, lastOpenedAt: 2, docCount: 0 },
      { path: prepared.secondRoot, name: '第二库', addedAt: 1, lastOpenedAt: 1, docCount: 0 }
    ];
    settings.activeLibrary = prepared.root;
    return;
  }

  const targets = cliTargets(process.argv);
  if (targets.length > 0) {
    try {
      await applyPath(targets[0]);
      return;
    } catch (error) {
      log('warn', 'argv', `打开命令行目标失败：${error.stack || error}`);
    }
  }

  let lastFileLibrary = null;
  if (settings.lastFile) {
    try {
      const abs = path.resolve(settings.lastFile);
      const stat = await fsp.stat(abs);
      if (!stat.isFile() || !files.isMarkdownPath(abs)) {
        settings.lastFile = null;
      } else {
        settings.lastFile = abs;
        allowExternal(abs);
        lastFileLibrary = findLibraryForPath(abs);
      }
    } catch {
      settings.lastFile = null;
    }
  }

  const existing = [];
  for (const lib of settings.libraries) {
    try {
      if ((await fsp.stat(lib.path)).isDirectory()) existing.push(lib);
    } catch {
      // 保留注册项，首页显示路径不可用。
    }
  }
  let active = lastFileLibrary;
  if (!active && settings.activeLibrary) {
    active = existing.find((lib) => samePath(lib.path, settings.activeLibrary)) || null;
  }
  if (!active) active = existing[0] || null;
  settings.activeLibrary = active ? active.path : null;
  state.workspaceRoot = active ? active.path : null;
  persistSettings();
}

async function bootstrapSnapshot() {
  let workspace = null;
  let file = null;
  if (state.workspaceRoot) {
    try {
      workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
      const lib = findLibrary(state.workspaceRoot);
      if (lib) lib.docCount = workspace.fileCount;
    } catch (error) {
      log('error', 'workspace', `读取文件夹失败：${error.stack || error}`);
      state.workspaceRoot = null;
      settings.activeLibrary = null;
    }
  }
  if (settings.lastFile) {
    try {
      const abs = path.resolve(settings.lastFile);
      allowExternal(abs);
      file = await files.readDoc(abs);
      const lib = findLibraryForPath(abs);
      file.library = lib ? lib.path : null;
      file.relPath = lib ? files.toRelPath(lib.path, abs) : null;
    } catch (error) {
      log('warn', 'last-file', `恢复上次文件失败：${error.stack || error}`);
      settings.lastFile = null;
      persistSettings();
    }
  }
  const recovery = recoveryStore ? await recoveryStore.load() : [];
  const usableRecovery = await filterRecovery(recovery);
  for (const entry of usableRecovery) {
    if (entry.path) allowExternal(entry.path);
  }
  return {
    libraries: await describeLibraries(),
    workspace,
    file,
    recent: settings.recent,
    starred: await publicStarred(),
    settings: publicSettings(),
    recovery: usableRecovery,
    portable: portableMode,
    testMode: TEST,
    version: app.getVersion(),
    platform: process.platform
  };
}

async function filterRecovery(entries) {
  const usable = [];
  for (const entry of entries) {
    const library = entry.path ? (findLibraryForPath(entry.path) || {}).path || null : null;
    if (!entry.path) {
      usable.push({ ...entry, library });
      continue;
    }
    try {
      const stat = await fsp.stat(entry.path);
      if (!stat.isFile()) {
        usable.push({ ...entry, library });
        continue;
      }
      if (entry.timestamp && stat.mtimeMs > entry.timestamp + 1000) continue;
      const doc = await files.readDoc(entry.path);
      if (doc.content === entry.content) continue;
      usable.push({ ...entry, library });
    } catch {
      usable.push({ ...entry, library });
    }
  }
  return usable;
}

function safeBounds() {
  const fallback = { width: 1180, height: 780 };
  if (!settings.bounds) return fallback;
  const bounds = settings.bounds;
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX * overlapY >= 40 * 40;
  });
  return visible ? bounds : fallback;
}

function rememberBoundsSoon() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    settings.maximized = win.isMaximized();
    settings.bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    persistSettings();
  }, 400);
}

function sendMenuAction(action) {
  const target = BrowserWindow.getFocusedWindow() || win;
  if (target && !target.isDestroyed()) target.webContents.send('menu:action', action);
}

function openExternalSafe(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      shell.openExternal(url);
    }
  } catch {
    // 忽略无效链接。
  }
}

let shortcutEntries = [];

function collectShortcuts(items, out) {
  for (const item of items || []) {
    if (!item) continue;
    if (item.submenu) collectShortcuts(item.submenu, out);
    else if (!item.role && item.accelerator && item.label) {
      out.push({ accelerator: item.accelerator, label: item.label });
    }
  }
}

function showShortcuts() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: '快捷键',
    message: 'Markdown 笔记快捷键',
    detail: shortcutEntries
      .map(({ accelerator, label }) => `${accelerator.padEnd(14)}${label.replace(/…$/, '')}`)
      .join('\n')
  });
}

function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: '关于',
    message: APP_TITLE,
    detail: [
      `版本 ${app.getVersion()}`,
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node ${process.versions.node}`,
      `架构 ${process.arch}`,
      '',
      `数据目录：${app.getPath('userData')}`
    ].join('\n')
  });
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建笔记', accelerator: 'Ctrl+N', click: () => sendMenuAction('new-note') },
        { label: '添加知识库…', accelerator: 'Ctrl+Shift+O', click: () => sendMenuAction('add-library') },
        { label: '打开文件…', accelerator: 'Ctrl+O', click: () => sendMenuAction('open-file') },
        { type: 'separator' },
        { label: '保存', accelerator: 'Ctrl+S', click: () => sendMenuAction('save') },
        { label: '另存为…', accelerator: 'Ctrl+Shift+S', click: () => sendMenuAction('save-as') },
        { type: 'separator' },
        { label: '打印…', accelerator: 'Ctrl+P', click: () => sendMenuAction('print') },
        { type: 'separator' },
        { label: '关闭当前标签页', accelerator: 'Ctrl+W', click: () => sendMenuAction('close-tab') },
        { label: '设置…', accelerator: 'Ctrl+,', click: () => sendMenuAction('settings') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找与替换', accelerator: 'Ctrl+F', click: () => sendMenuAction('find') },
        { label: '搜索全部知识库', accelerator: 'Ctrl+Shift+F', click: () => sendMenuAction('focus-search') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '工作台', click: () => sendMenuAction('home') },
        { type: 'separator' },
        { label: '切换侧边栏', accelerator: 'Ctrl+Shift+B', click: () => sendMenuAction('toggle-sidebar') },
        { label: '切换阅读视图', accelerator: 'Ctrl+E', click: () => sendMenuAction('toggle-reading') },
        { label: '切换文档信息栏', click: () => sendMenuAction('toggle-outline') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', click: showShortcuts },
        { type: 'separator' },
        { label: '打开日志目录', click: () => openLogDir() },
        { label: '复制日志路径', click: () => copyLogPath() },
        { label: '清空日志', click: () => clearLogs() },
        { type: 'separator' },
        { label: '关于', click: showAbout }
      ]
    }
  ];
  if (!app.isPackaged) {
    template[2].submenu.push({ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' });
  }
  shortcutEntries = [];
  collectShortcuts(template, shortcutEntries);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function flushRenderer() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return { ok: true };
  try {
    const result = await Promise.race([
      win.webContents.executeJavaScript('window.__flushSave ? window.__flushSave() : { ok: true }', true),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, blocked: true, timeout: true }), 3000))
    ]);
    return result && typeof result === 'object' ? result : { ok: true };
  } catch (error) {
    log('error', 'close', `刷新渲染进程失败：${error.stack || error}`);
    return { ok: true };
  }
}

function handleClose(event) {
  if (allowClose) return;
  event.preventDefault();
  if (closeInFlight) return;
  closeInFlight = true;
  const run = async () => {
    const result = await flushRenderer();
    if (result && result.blocked) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: APP_TITLE,
        message: '仍有未保存的更改',
        detail: '自动保存未成功，或文件已被其他程序修改。现在退出会丢失当前编辑内容。',
        buttons: ['取消', '仍然退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (choice === 0) {
        closeInFlight = false;
        return;
      }
    }
    if (win && !win.isDestroyed()) {
      settings.maximized = win.isMaximized();
      settings.bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
      persistSettings();
    }
    allowClose = true;
    if (win && !win.isDestroyed()) win.close();
  };
  run().catch((error) => {
    log('error', 'close', error.stack || error);
    allowClose = true;
    if (win && !win.isDestroyed()) win.close();
  });
}

function createWindow() {
  const bounds = safeBounds();
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  win = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 520,
    show: false,
    backgroundColor: '#f5f6f8',
    title: APP_TITLE,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.on('resize', rememberBoundsSoon);
  win.on('move', rememberBoundsSoon);
  win.on('maximize', rememberBoundsSoon);
  win.on('unmaximize', rememberBoundsSoon);
  win.on('close', handleClose);
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternalSafe(url);
  });
  win.webContents.on('preload-error', (event, preloadPath, error) => {
    log('error', 'preload', `${preloadPath}: ${error.stack || error}`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    log('error', 'renderer', `渲染进程退出：${JSON.stringify(details)}`);
    if (!win || win.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: APP_TITLE,
      message: '编辑器界面异常退出',
      detail: '可以尝试重新加载界面；未保存内容可能丢失。',
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice === 0) win.reload();
    else app.quit();
  });
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) log(level === 3 ? 'error' : 'warn', 'renderer-console', `${message} (${sourceId}:${line})`);
  });

  if (settings.maximized && settings.bounds) win.maximize();
  if (!TEST) win.once('ready-to-show', () => win.show());
  return win.loadFile(path.join(__dirname, 'index.html')).then(() => win);
}

async function runSmokeBoot(winInstance) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const ready = await winInstance.webContents.executeJavaScript(
      'document.body.dataset.ready === "1" && !!window.api && !!window.marked && !!window.CodeMirror && !!document.getElementById("editor")',
      true
    ).catch(() => false);
    if (ready) {
      log('info', 'smoke-boot', 'renderer ready');
      app.exit(0);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  log('error', 'smoke-boot', 'renderer did not become ready');
  app.exit(1);
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const IMAGE_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp'
};

function imageExtensionFor(name, mime) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return IMAGE_MIME_EXT[String(mime || '').toLowerCase()] || null;
}

async function uniqueAssetTarget(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length) || 'image';
  let index = 1;
  let candidate = fileName;
  for (;;) {
    const target = path.join(dir, candidate);
    try {
      await fsp.access(target);
      candidate = `${stem}-${index}${ext}`;
      index += 1;
    } catch {
      return target;
    }
  }
}

async function saveImageToAssets(root, docAbs, buffer, name, mime) {
  if (!files.isInside(root, docAbs)) throw new Error('请先将文档保存在当前工作区');
  const ext = imageExtensionFor(name, mime);
  if (!ext) throw new Error('不支持的图片格式');
  if (!buffer || buffer.length === 0) throw new Error('图片内容为空');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
  const assetsDir = path.join(root, 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });
  const base = path.basename(String(name || `image${ext}`));
  const stem = base.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 60) || 'image';
  const target = await uniqueAssetTarget(assetsDir, `${stem}${ext}`);
  await fsp.writeFile(target, buffer, { flag: 'wx' });
  return {
    relPath: path.relative(path.dirname(docAbs), target).split(path.sep).join('/'),
    name: path.basename(target),
    absPath: target
  };
}

function requireLibrary(value) {
  const raw = typeof value === 'string' ? value : (value && value.library);
  if (!raw) throw new Error('缺少知识库路径');
  const lib = findLibrary(raw);
  if (!lib) throw new Error('知识库不存在');
  return lib;
}

async function ensureCatalog(lib) {
  const cached = catalog.snapshot(lib.path);
  if (cached) return cached;
  const workspace = await files.listWorkspace(lib.path, listOptions());
  return catalog.build(lib.path, workspace.tree);
}

async function homeSnapshot() {
  return {
    libraries: await describeLibraries(),
    recent: settings.recent,
    starred: await publicStarred()
  };
}

async function removeLibrary(libPath) {
  const lib = findLibrary(libPath);
  if (!lib) throw new Error('知识库不存在');
  const abs = lib.path;
  if (settings.lastFile && files.isInside(abs, settings.lastFile)) settings.lastFile = null;
  settings.recent = settings.recent.filter((item) => !files.isInside(abs, item.path));
  settings.libraries = settings.libraries.filter((item) => !samePath(item.path, abs));
  settings.starred = settings.starred.filter((star) => !samePath(star.library, abs));
  catalog.clear(abs);
  if (settings.activeLibrary && samePath(settings.activeLibrary, abs)) {
    const candidates = settings.libraries
      .slice()
      .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
    let next = null;
    for (const candidate of candidates) {
      try {
        if ((await fsp.stat(candidate.path)).isDirectory()) {
          next = candidate;
          break;
        }
      } catch {
        // 跳过不可用目录。
      }
    }
    settings.activeLibrary = next ? next.path : null;
    state.workspaceRoot = next ? next.path : null;
    if (next) {
      next.lastOpenedAt = Date.now();
      const workspace = await files.listWorkspace(next.path, listOptions());
      next.docCount = workspace.fileCount;
      persistSettings();
      return { libraries: await describeLibraries(), workspace };
    }
  }
  persistSettings();
  return {
    libraries: await describeLibraries(),
    workspace: state.workspaceRoot ? await files.listWorkspace(state.workspaceRoot, listOptions()) : null
  };
}

async function renameLibrary(payload) {
  const lib = findLibrary(payload && payload.library);
  if (!lib) throw new Error('知识库不存在');
  const name = String((payload && payload.name) || '').trim();
  if (!name || name.length > 80 || /[\r\n\0]/.test(name)) throw new Error('知识库名称需为 1–80 个字符');
  lib.name = name;
  persistSettings();
  return { libraries: await describeLibraries() };
}

async function toggleStar(payload) {
  const lib = requireLibrary(payload);
  const abs = files.resolveInside(lib.path, payload && payload.relPath);
  const stat = await fsp.stat(abs);
  if (!stat.isFile()) throw new Error('文件不存在，无法收藏');
  const relPath = files.toRelPath(lib.path, abs);
  const index = settings.starred.findIndex((star) => samePath(star.library, lib.path) && star.relPath === relPath);
  if (index >= 0) settings.starred.splice(index, 1);
  else settings.starred.unshift({ library: lib.path, relPath, at: Date.now() });
  if (settings.starred.length > 200) settings.starred.length = 200;
  persistSettings();
  return { starred: await publicStarred() };
}

async function searchAll(payload) {
  const query = String((payload && payload.query) || '').trim();
  if (!query) return { results: [], truncated: false, filesScanned: 0 };
  if (query.length > 100) throw new Error('搜索内容过长');
  if (settings.libraries.length === 0) throw new Error('请先添加知识库');
  const scope = payload && payload.library ? [requireLibrary(payload.library)] : settings.libraries;
  const results = [];
  let truncated = false;
  let filesScanned = 0;
  const settled = await Promise.all(scope.map(async (lib) => {
    try {
      const data = await files.searchWorkspace(lib.path, query, { ...listOptions(), limit: 40 });
      return { lib, data };
    } catch (error) {
      log('warn', 'search', `搜索 ${lib.path} 失败：${error.stack || error}`);
      return null;
    }
  }));
  for (const item of settled) {
    if (!item) continue;
    filesScanned += item.data.filesScanned || 0;
    if (item.data.truncated) truncated = true;
    for (const hit of item.data.results) {
      if (results.length >= 300) {
        truncated = true;
        break;
      }
      results.push({ ...hit, library: item.lib.path, libraryName: item.lib.name });
    }
  }
  return { results, truncated, filesScanned };
}

function registerIpc() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await fn(payload, event);
      } catch (error) {
        log('error', `ipc:${channel}`, error.stack || String(error));
        throw new Error(formatError(error));
      }
    });
  };

  handle('app:bootstrap', bootstrapSnapshot);
  handle('app:home', homeSnapshot);
  handle('app:recent', () => settings.recent);
  handle('recent:remove', (target) => {
    if (typeof target !== 'string' || !target) throw new Error('无效的最近记录');
    const key = path.resolve(target).toLowerCase();
    settings.recent = settings.recent.filter((item) => item.path.toLowerCase() !== key);
    persistSettings();
    return settings.recent;
  });
  handle('recent:clear', () => {
    settings.recent = [];
    persistSettings();
    return settings.recent;
  });

  handle('library:add', async () => {
    let picked = null;
    if (TEST && TEST_CONTROLS.addLibraryPath) {
      picked = TEST_CONTROLS.addLibraryPath;
      TEST_CONTROLS.addLibraryPath = null;
    } else {
      const result = await dialog.showOpenDialog(win, {
        title: '添加知识库',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      picked = result.filePaths[0];
    }
    const opened = await addOrOpenLibrary(picked);
    return { libraries: opened.libraries, workspace: opened.workspace };
  });

  handle('library:open', async (payload) => {
    const lib = requireLibrary(payload);
    const workspace = await setActiveLibrary(lib.path);
    return { libraries: await describeLibraries(), workspace };
  });

  handle('library:remove', async (payload) => removeLibrary(payload && payload.library));

  handle('library:rename', async (payload) => renameLibrary(payload));

  handle('catalog:get', async (payload) => {
    const lib = requireLibrary(payload);
    let snapshot = payload && payload.refresh ? null : catalog.snapshot(lib.path);
    if (!snapshot) {
      const workspace = await files.listWorkspace(lib.path, listOptions());
      snapshot = await catalog.build(lib.path, workspace.tree);
    }
    return { library: lib.path, ...snapshot };
  });

  handle('catalog:backlinks', async (payload) => {
    const lib = requireLibrary(payload);
    await ensureCatalog(lib);
    return { backlinks: catalog.backlinks(lib.path, payload && payload.relPath) };
  });

  handle('wiki:resolve', async (payload) => {
    const lib = requireLibrary(payload);
    await ensureCatalog(lib);
    const doc = catalog.resolve(lib.path, payload && payload.target);
    return doc ? { relPath: doc.relPath, title: doc.title } : null;
  });

  handle('star:toggle', async (payload) => toggleStar(payload));

  handle('search:all', async (payload) => searchAll(payload));

  handle('workspace:refresh', async () => {
    if (!state.workspaceRoot) return null;
    const workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
    const lib = findLibrary(state.workspaceRoot);
    if (lib) {
      lib.docCount = workspace.fileCount;
      persistSettings();
    }
    return { workspace };
  });

  handle('file:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'txt'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const opened = await applyPath(result.filePaths[0]);
    return { ...opened, recent: settings.recent };
  });

  handle('file:recent', async (target) => {
    if (typeof target !== 'string') throw new Error('无效的最近记录');
    const opened = await applyPath(target);
    return { ...opened, recent: settings.recent };
  });

  handle('file:read', async (payload) => {
    const target = resolveDocTarget(payload);
    const abs = target.abs;
    allowExternal(abs);
    const doc = await files.readDoc(abs);
    doc.library = target.root;
    doc.relPath = target.root ? files.toRelPath(target.root, abs) : null;
    addRecent(abs);
    settings.lastFile = abs;
    persistSettings();
    return doc;
  });

  handle('file:save', async (payload) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('缺少要保存的内容');
    const target = resolveDocTarget(payload);
    const abs = target.abs;
    const result = await files.writeDoc(abs, {
      content: payload.content,
      eol: payload.eol,
      encoding: payload.encoding,
      expectedMtime: payload.expectedMtime,
      force: Boolean(payload.force),
      onBeforeWrite: async () => {
        try {
          await backups.createBackup(backupsDir, abs);
        } catch (error) {
          log('warn', 'backup', `创建快照失败：${error.stack || error}`);
        }
      }
    });
    const relPath = target.root ? files.toRelPath(target.root, abs) : null;
    if (!result.conflict && !result.missing) {
      allowExternal(abs);
      if (settings.lastFile !== abs) {
        settings.lastFile = abs;
        persistSettings();
      }
      if (target.root) {
        catalog.upsert(target.root, relPath, payload.content, {
          mtimeMs: result.mtimeMs,
          size: result.size
        });
      }
    }
    return {
      ...result,
      path: abs,
      library: target.root,
      relPath
    };
  });

  handle('file:saveAs', async (payload) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('缺少要保存的内容');
    const current = payload.path ? path.resolve(payload.path) : null;
    const suggested = payload.suggestedName || '未命名.md';
    const defaultDir = current ? path.dirname(current) : (state.workspaceRoot || app.getPath('documents'));
    let target = path.join(defaultDir, suggested);
    if (TEST && TEST_CONTROLS.saveAsPath) {
      target = path.resolve(TEST_CONTROLS.saveAsPath);
      TEST_CONTROLS.saveAsPath = null;
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: '另存为',
        defaultPath: target,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '文本', extensions: ['txt'] }
        ]
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath;
    }
    if (!path.extname(target)) target += '.md';
    if (!files.isMarkdownPath(target)) target += '.md';
    try {
      await backups.createBackup(backupsDir, target, { force: true });
    } catch (error) {
      log('warn', 'backup', `创建快照失败：${error.stack || error}`);
    }
    const writeResult = await files.writeDoc(target, {
      content: payload.content,
      eol: payload.eol,
      encoding: payload.encoding,
      expectedMtime: null,
      force: true
    });
    const abs = path.resolve(target);
    const lib = findLibraryForPath(abs);
    const relPath = lib ? files.toRelPath(lib.path, abs) : null;
    allowExternal(abs);
    settings.lastFile = abs;
    addRecent(abs);
    persistSettings();
    if (lib) {
      catalog.upsert(lib.path, relPath, payload.content, {
        mtimeMs: writeResult.mtimeMs,
        size: writeResult.size
      });
    }
    const doc = await files.readDoc(abs);
    return {
      ...doc,
      library: lib ? lib.path : null,
      relPath,
      mtimeMs: writeResult.mtimeMs
    };
  });

  handle('entry:create', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先添加知识库');
    const root = state.workspaceRoot;
    const created = await files.createEntry(
      root,
      payload && payload.parentRel,
      payload && payload.name,
      payload && payload.type === 'dir' ? 'dir' : 'file'
    );
    if (created.type === 'file') {
      try {
        const abs = files.resolveInside(root, created.relPath);
        const stat = await fsp.stat(abs);
        catalog.upsert(root, created.relPath, '', { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (error) {
        log('warn', 'catalog', `索引新文件失败：${error.stack || error}`);
      }
    }
    const workspace = await files.listWorkspace(root, listOptions());
    const lib = findLibrary(root);
    if (lib) {
      lib.docCount = workspace.fileCount;
      persistSettings();
    }
    return { entry: created, workspace };
  });

  handle('entry:rename', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先添加知识库');
    const root = state.workspaceRoot;
    const result = await files.renameEntry(root, payload && payload.relPath, payload && payload.name);
    catalog.rename(root, result.oldRelPath, result.newRelPath);
    const oldAbs = files.resolveInside(root, result.oldRelPath);
    const newAbs = files.resolveInside(root, result.newRelPath);
    settings.starred = settings.starred.map((star) => {
      if (!samePath(star.library, root)) return star;
      if (star.relPath === result.oldRelPath) return { ...star, relPath: result.newRelPath };
      if (star.relPath.startsWith(`${result.oldRelPath}/`)) {
        return { ...star, relPath: `${result.newRelPath}${star.relPath.slice(result.oldRelPath.length)}` };
      }
      return star;
    });
    settings.recent = settings.recent.map((item) => {
      if (!files.isInside(oldAbs, item.path)) return item;
      const suffix = path.relative(oldAbs, item.path);
      const nextPath = path.resolve(newAbs, suffix);
      return { ...item, path: nextPath, name: path.basename(nextPath) || nextPath };
    });
    if (settings.lastFile) {
      const rel = files.toRelPath(root, settings.lastFile);
      if (rel === result.oldRelPath || (rel && rel.startsWith(`${result.oldRelPath}/`))) {
        const suffix = path.relative(oldAbs, settings.lastFile);
        settings.lastFile = path.resolve(newAbs, suffix);
      }
    }
    persistSettings();
    const workspace = await files.listWorkspace(root, listOptions());
    return { ...result, workspace };
  });

  handle('entry:delete', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先添加知识库');
    const root = state.workspaceRoot;
    const relPath = payload && payload.relPath;
    const targetAbs = files.resolveInside(root, relPath);
    await files.deleteEntry(root, relPath);
    catalog.remove(root, relPath);
    settings.starred = settings.starred.filter((star) => {
      if (!samePath(star.library, root)) return true;
      return star.relPath !== relPath && !star.relPath.startsWith(`${relPath}/`);
    });
    settings.recent = settings.recent.filter((item) => !files.isInside(targetAbs, item.path));
    if (settings.lastFile && files.isInside(targetAbs, settings.lastFile)) settings.lastFile = null;
    persistSettings();
    const workspace = await files.listWorkspace(root, listOptions());
    const lib = findLibrary(root);
    if (lib) {
      lib.docCount = workspace.fileCount;
      persistSettings();
    }
    return { relPath, workspace };
  });

  handle('entry:reveal', async (payload) => {
    let abs;
    if (payload && typeof payload.relPath === 'string') {
      const root = payload.library ? requireLibrary(payload.library).path : state.workspaceRoot;
      if (!root) throw new Error('请先添加知识库');
      abs = files.resolveInside(root, payload.relPath);
    } else if (payload && typeof payload.path === 'string') {
      abs = path.resolve(payload.path);
      if (!isAllowedPath(abs)) throw new Error('无权访问该文件');
    } else {
      throw new Error('缺少路径');
    }
    shell.showItemInFolder(abs);
    return true;
  });

  handle('link:open', async (payload) => {
    if (!payload || typeof payload.href !== 'string') throw new Error('无效的链接');
    const baseDir = typeof payload.baseDir === 'string' && payload.baseDir
      ? path.resolve(payload.baseDir)
      : (state.workspaceRoot || app.getPath('documents'));
    const result = await files.openLinkedPath(baseDir, payload.href);
    if (result.external) {
      openExternalSafe(result.external);
      return { external: result.external };
    }
    if (result.anchor) return { anchor: true };
    if (result.directory) {
      const lib = findLibraryForPath(result.directory);
      if (!lib) throw new Error('该文件夹不是已添加的知识库');
      const workspace = await setActiveLibrary(lib.path);
      return { libraries: await describeLibraries(), workspace };
    }
    if (result.path) {
      const file = await openExternalFile(result.path);
      const workspace = state.workspaceRoot ? await files.listWorkspace(state.workspaceRoot, listOptions()) : null;
      return { libraries: await describeLibraries(), workspace, file };
    }
    throw new Error('无法打开该链接');
  });

  handle('external:open', async (url) => {
    if (typeof url !== 'string') throw new Error('无效的链接');
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('不支持打开该协议');
    await shell.openExternal(url);
    return true;
  });

  handle('settings:get', () => publicSettings());
  handle('settings:update', (patch) => applySettingsPatch(patch));

  handle('logs:open', async () => {
    await shell.openPath(path.dirname(logFile));
    return true;
  });
  handle('logs:copy', () => {
    clipboard.writeText(logFile);
    return logFile;
  });
  handle('logs:clear', () => clearLogs());

  handle('backups:list', async (payload) => {
    const abs = resolveDocTarget(payload).abs;
    return backups.listBackups(backupsDir, abs);
  });
  handle('backups:create', async (payload) => {
    const abs = resolveDocTarget(payload).abs;
    const item = await backups.createBackup(backupsDir, abs, { force: true });
    return { item, list: await backups.listBackups(backupsDir, abs) };
  });
  handle('backups:read', async (payload) => {
    const abs = resolveDocTarget(payload).abs;
    return backups.readBackup(backupsDir, abs, payload && payload.id);
  });

  handle('recovery:save', async (entry) => {
    if (!recoveryStore) return false;
    const prepared = entry && typeof entry === 'object' ? { ...entry } : entry;
    if (prepared && typeof prepared.path === 'string' && prepared.path) {
      allowExternal(prepared.path);
      if (!prepared.library) {
        const lib = findLibraryForPath(prepared.path);
        prepared.library = lib ? lib.path : null;
      }
    }
    await recoveryStore.save(prepared);
    return true;
  });
  handle('recovery:clear', async (key) => {
    if (!recoveryStore) return false;
    await recoveryStore.clear(key);
    return true;
  });
  handle('recovery:clearAll', async () => {
    if (!recoveryStore) return false;
    await recoveryStore.clearAll();
    return true;
  });

  handle('image:pick', async (payload) => {
    const target = resolveDocTarget(payload);
    if (!target.root) throw new Error('请先将文档保存到知识库');
    const result = await dialog.showOpenDialog(win, {
      title: '插入图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    const stat = await fsp.stat(chosen);
    if (stat.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
    const buffer = await fsp.readFile(chosen);
    return saveImageToAssets(target.root, target.abs, buffer, path.basename(chosen), '');
  });

  handle('image:saveBuffer', async (payload) => {
    if (!payload || !payload.data) throw new Error('缺少图片内容');
    const target = resolveDocTarget(payload);
    if (!target.root) throw new Error('请先将文档保存到知识库');
    const buffer = Buffer.from(payload.data);
    return saveImageToAssets(target.root, target.abs, buffer, payload.name, payload.mime);
  });

  handle('edit:action', async (action) => {
    const allowed = new Set(['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']);
    if (!allowed.has(action)) throw new Error('不支持的编辑操作');
    if (!win || win.isDestroyed()) return false;
    win.webContents[action]();
    return true;
  });

  handle('ui:confirm', async (payload) => {
    if (TEST) return { response: Number.isInteger(TEST_CONTROLS.confirmResponse) ? TEST_CONTROLS.confirmResponse : 1 };
    const options = payload && typeof payload === 'object' ? payload : {};
    const result = await dialog.showMessageBox(win, {
      type: options.type || 'question',
      title: options.title || APP_TITLE,
      message: String(options.message || '确认操作？'),
      detail: options.detail ? String(options.detail) : undefined,
      buttons: Array.isArray(options.buttons) && options.buttons.length > 0 ? options.buttons.map(String) : ['取消', '确定'],
      defaultId: Number.isInteger(options.defaultId) ? options.defaultId : 0,
      cancelId: Number.isInteger(options.cancelId) ? options.cancelId : 0,
      noLink: true
    });
    return { response: result.response };
  });

  handle('ui:print', async () => {
    if (!win || win.isDestroyed()) return false;
    if (TEST && TEST_CONTROLS.printPath) {
      const target = TEST_CONTROLS.printPath;
      TEST_CONTROLS.printPath = null;
      const pdf = await win.webContents.printToPDF({ printBackground: true });
      await fsp.writeFile(target, pdf);
      return { printed: true, path: target, bytes: pdf.length };
    }
    win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (!success && reason) log('warn', 'print', reason);
    });
    return true;
  });

  handle('app:log', (payload) => {
    if (payload && typeof payload.message === 'string') {
      log(payload.level === 'error' ? 'error' : 'warn', 'renderer', payload.message.slice(0, 4000));
    }
    return true;
  });
}

async function handleSecondInstance(argv) {
  const targets = cliTargets(argv);
  if (targets.length === 0) {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return;
  }
  try {
    const opened = await applyPath(targets[0]);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send('app:open', { ...opened, recent: settings.recent });
    }
  } catch (error) {
    log('warn', 'second-instance', error.stack || error);
    dialog.showMessageBox(win, {
      type: 'error',
      title: APP_TITLE,
      message: '无法打开文件',
      detail: formatError(error)
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    handleSecondInstance(argv);
  });

  app.whenReady().then(async () => {
    initPaths();
    settings = loadSettings();
    initLogging();
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
    if (session.defaultSession.setPermissionCheckHandler) {
      session.defaultSession.setPermissionCheckHandler(() => false);
    }
    registerIpc();
    createMenu();
    await initializeState();
    const window = await createWindow();

    if (TEST) {
      const harness = require('../scripts/smoke-harness');
      harness.run({
        win: window,
        app,
        state,
        settings,
        log,
        testRoot,
        secondRoot,
        thirdRoot,
        testControls: TEST_CONTROLS
      });
    } else if (SMOKE_BOOT) {
      runSmokeBoot(window);
    }
  }).catch((error) => {
    try {
      log('error', 'startup', error.stack || String(error));
    } catch {
      // 忽略日志失败。
    }
    dialog.showErrorBox(APP_TITLE, `启动失败：${formatError(error)}`);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => persistSettings());

  process.on('uncaughtException', (error) => {
    try {
      log('error', 'uncaught', error.stack || String(error));
    } catch {
      // 忽略日志失败。
    }
    dialog.showErrorBox(APP_TITLE, `程序发生未处理的异常：\n${error.message}\n\n日志：${logFile}`);
    app.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'unhandled-rejection', reason && reason.stack ? reason.stack : String(reason));
  });
}
