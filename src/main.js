'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const files = require('./main/files');
const RecoveryStore = require('./main/recovery');
const backups = require('./main/backups');

const APP_TITLE = 'Markdown 笔记';
const TEST = process.argv.includes('--smoke-test');
const SMOKE_BOOT = process.argv.includes('--smoke-boot');
const PORTABLE_FLAG = process.argv.includes('--portable');
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
let allowClose = false;
let closeInFlight = false;
let boundsTimer = null;

function defaultSettings() {
  return {
    bounds: null,
    maximized: false,
    lastWorkspace: null,
    lastFile: null,
    recent: [],
    theme: 'light',
    fontSize: 15,
    lineWidth: 0,
    autosave: true,
    autosaveDelay: 900,
    preview: true,
    sidebar: true,
    outline: true,
    split: 0.5,
    remoteImages: false,
    syntaxHighlight: true,
    showReadingTime: true,
    wordGoal: 0,
    ignoreDirs: []
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
  result.lastWorkspace = typeof raw.lastWorkspace === 'string' ? raw.lastWorkspace : null;
  result.lastFile = typeof raw.lastFile === 'string' ? raw.lastFile : null;
  if (Array.isArray(raw.recent)) {
    const seen = new Set();
    result.recent = raw.recent.filter((item) => {
      if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path)) return false;
      const key = item.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return item.type === 'folder' || item.type === 'file';
    }).slice(0, 10).map((item) => ({
      type: item.type,
      path: item.path,
      name: typeof item.name === 'string' && item.name ? item.name : path.basename(item.path) || item.path,
      at: Number(item.at) || 0
    }));
  }
  result.theme = raw.theme === 'dark' ? 'dark' : 'light';
  result.fontSize = clampInt(raw.fontSize, 12, 22, 15);
  result.lineWidth = [0, 720, 900].includes(Number(raw.lineWidth)) ? Number(raw.lineWidth) : 0;
  result.autosave = raw.autosave !== false;
  result.autosaveDelay = clampInt(raw.autosaveDelay, 300, 5000, 900);
  result.preview = raw.preview !== false;
  result.sidebar = raw.sidebar !== false;
  result.outline = raw.outline !== false;
  result.split = clampNumber(raw.split, 0.2, 0.8, 0.5);
  result.remoteImages = Boolean(raw.remoteImages);
  result.syntaxHighlight = raw.syntaxHighlight !== false;
  result.showReadingTime = raw.showReadingTime !== false;
  result.wordGoal = clampInt(raw.wordGoal, 0, 1000000, 0);
  result.ignoreDirs = normalizeIgnoreDirs(raw.ignoreDirs);
  return result;
}

function publicSettings() {
  return {
    theme: settings.theme,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    autosave: settings.autosave,
    autosaveDelay: settings.autosaveDelay,
    preview: settings.preview,
    sidebar: settings.sidebar,
    outline: settings.outline,
    split: settings.split,
    remoteImages: settings.remoteImages,
    syntaxHighlight: settings.syntaxHighlight,
    showReadingTime: settings.showReadingTime,
    wordGoal: settings.wordGoal,
    ignoreDirs: settings.ignoreDirs
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
  if (patch.preview !== undefined) settings.preview = Boolean(patch.preview);
  if (patch.sidebar !== undefined) settings.sidebar = Boolean(patch.sidebar);
  if (patch.outline !== undefined) settings.outline = Boolean(patch.outline);
  if (patch.split !== undefined) settings.split = clampNumber(patch.split, 0.2, 0.8, settings.split);
  if (patch.remoteImages !== undefined) settings.remoteImages = Boolean(patch.remoteImages);
  if (patch.syntaxHighlight !== undefined) settings.syntaxHighlight = Boolean(patch.syntaxHighlight);
  if (patch.showReadingTime !== undefined) settings.showReadingTime = Boolean(patch.showReadingTime);
  if (patch.wordGoal !== undefined) settings.wordGoal = clampInt(patch.wordGoal, 0, 1000000, settings.wordGoal);
  if (patch.ignoreDirs !== undefined) settings.ignoreDirs = normalizeIgnoreDirs(patch.ignoreDirs);
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

function addRecent(type, absPath) {
  const resolved = path.resolve(absPath);
  const key = resolved.toLowerCase();
  settings.recent = [
    {
      type,
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
  if (state.workspaceRoot && files.isInside(state.workspaceRoot, absPath)) return true;
  return state.allowedExternal.has(path.resolve(absPath).toLowerCase());
}

function resolveDocPath(payload) {
  if (payload && typeof payload.relPath === 'string') {
    if (!state.workspaceRoot) throw new Error('尚未打开文件夹');
    return files.resolveInside(state.workspaceRoot, payload.relPath);
  }
  if (payload && typeof payload.path === 'string' && payload.path) {
    const abs = path.resolve(payload.path);
    if (!isAllowedPath(abs)) throw new Error('无权访问该文件');
    return abs;
  }
  throw new Error('缺少文件路径');
}

function listOptions() {
  return { ignore: settings.ignoreDirs };
}

async function setWorkspace(rootPath) {
  const abs = path.resolve(rootPath);
  const stat = await fsp.stat(abs);
  if (!stat.isDirectory()) throw new Error('目标不是文件夹');
  state.workspaceRoot = abs;
  settings.lastWorkspace = abs;
  if (settings.lastFile && !files.isInside(abs, settings.lastFile)) {
    settings.lastFile = null;
  }
  addRecent('folder', abs);
  persistSettings();
  return files.listWorkspace(abs, listOptions());
}

async function openExternalFile(absPath) {
  const abs = path.resolve(absPath);
  if (!files.isMarkdownPath(abs)) throw new Error('只能打开 Markdown 或文本文件');
  allowExternal(abs);
  settings.lastFile = abs;
  addRecent('file', abs);
  persistSettings();
  const doc = await files.readDoc(abs);
  doc.relPath = files.toRelPath(state.workspaceRoot, abs);
  return doc;
}

async function applyPath(target) {
  const abs = path.resolve(target);
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) {
    const workspace = await setWorkspace(abs);
    return { workspace, file: null };
  }
  if (!stat.isFile()) throw new Error('只能打开文件或文件夹');
  if (!files.isMarkdownPath(abs)) throw new Error('只能打开 .md / .markdown / .mdown / .txt 文件');
  if (!state.workspaceRoot) {
    await setWorkspace(path.dirname(abs));
  }
  const file = await openExternalFile(abs);
  return { file, workspace: await files.listWorkspace(state.workspaceRoot, listOptions()) };
}

function cliTargets(argv) {
  const args = argv.slice(1);
  if (!app.isPackaged) args.shift();
  return args.filter((arg) => arg && !arg.startsWith('-') && arg !== '.');
}

async function initializeState() {
  if (TEST) {
    const harness = require('../scripts/smoke-harness');
    testRoot = await harness.prepare();
    state.workspaceRoot = testRoot;
    settings = defaultSettings();
    settings.lastWorkspace = testRoot;
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

  if (settings.lastWorkspace) {
    try {
      const stat = await fsp.stat(settings.lastWorkspace);
      if (stat.isDirectory()) {
        state.workspaceRoot = path.resolve(settings.lastWorkspace);
      } else {
        settings.lastWorkspace = null;
      }
    } catch {
      settings.lastWorkspace = null;
    }
  }

  if (settings.lastFile) {
    try {
      const stat = await fsp.stat(settings.lastFile);
      if (!stat.isFile() || !files.isMarkdownPath(settings.lastFile)) {
        settings.lastFile = null;
      } else {
        allowExternal(settings.lastFile);
        if (!state.workspaceRoot) {
          state.workspaceRoot = path.dirname(path.resolve(settings.lastFile));
          settings.lastWorkspace = state.workspaceRoot;
        }
      }
    } catch {
      settings.lastFile = null;
    }
  }
  persistSettings();
}

async function bootstrapSnapshot() {
  let workspace = null;
  let file = null;
  if (state.workspaceRoot) {
    try {
      workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
    } catch (error) {
      log('error', 'workspace', `读取文件夹失败：${error.stack || error}`);
      state.workspaceRoot = null;
      settings.lastWorkspace = null;
    }
  }
  if (settings.lastFile) {
    try {
      const abs = path.resolve(settings.lastFile);
      allowExternal(abs);
      file = await files.readDoc(abs);
      file.relPath = files.toRelPath(state.workspaceRoot, abs);
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
    workspace,
    file,
    recent: settings.recent,
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
    if (!entry.path) {
      usable.push(entry);
      continue;
    }
    try {
      const stat = await fsp.stat(entry.path);
      if (!stat.isFile()) {
        usable.push(entry);
        continue;
      }
      if (entry.timestamp && stat.mtimeMs > entry.timestamp + 1000) continue;
      const doc = await files.readDoc(entry.path);
      if (doc.content === entry.content) continue;
      usable.push(entry);
    } catch {
      usable.push(entry);
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

function showShortcuts() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: '快捷键',
    message: 'Markdown 笔记快捷键',
    detail: [
      'Ctrl+N        新建笔记',
      'Ctrl+O        打开文件',
      'Ctrl+Shift+O  打开文件夹',
      'Ctrl+S        保存',
      'Ctrl+Shift+S  另存为',
      'Ctrl+B        粗体',
      'Ctrl+I        斜体',
      'Ctrl+K        插入链接',
      'Ctrl+E        切换预览',
      'Ctrl+Shift+B  切换侧边栏',
      'Ctrl+Shift+F  搜索',
      'Ctrl+P        打印'
    ].join('\n')
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
        { label: '打开文件…', accelerator: 'Ctrl+O', click: () => sendMenuAction('open-file') },
        { label: '打开文件夹…', accelerator: 'Ctrl+Shift+O', click: () => sendMenuAction('open-folder') },
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
        { label: '搜索文件内容', accelerator: 'Ctrl+Shift+F', click: () => sendMenuAction('focus-search') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换侧边栏', accelerator: 'Ctrl+Shift+B', click: () => sendMenuAction('toggle-sidebar') },
        { label: '切换预览', accelerator: 'Ctrl+E', click: () => sendMenuAction('toggle-preview') },
        { label: '切换大纲', click: () => sendMenuAction('toggle-outline') },
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

  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '打开文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const workspace = await setWorkspace(result.filePaths[0]);
    return { workspace, recent: settings.recent };
  });

  handle('workspace:refresh', async () => {
    if (!state.workspaceRoot) return null;
    return files.listWorkspace(state.workspaceRoot, listOptions());
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
    const abs = resolveDocPath(payload);
    allowExternal(abs);
    const doc = await files.readDoc(abs);
    doc.relPath = files.toRelPath(state.workspaceRoot, abs);
    addRecent('file', abs);
    settings.lastFile = abs;
    persistSettings();
    return doc;
  });

  handle('file:save', async (payload) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('缺少要保存的内容');
    const abs = resolveDocPath(payload);
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
    if (!result.conflict && !result.missing) {
      allowExternal(abs);
      if (settings.lastFile !== abs) {
        settings.lastFile = abs;
        persistSettings();
      }
    }
    return {
      ...result,
      path: abs,
      relPath: files.toRelPath(state.workspaceRoot, abs)
    };
  });

  handle('file:saveAs', async (payload) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('缺少要保存的内容');
    const current = payload.path ? path.resolve(payload.path) : null;
    const suggested = payload.suggestedName || '未命名.md';
    const defaultDir = current ? path.dirname(current) : (state.workspaceRoot || app.getPath('documents'));
    let target = path.join(defaultDir, suggested);
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
    allowExternal(abs);
    settings.lastFile = abs;
    addRecent('file', abs);
    persistSettings();
    const doc = await files.readDoc(abs);
    return {
      ...doc,
      relPath: files.toRelPath(state.workspaceRoot, abs),
      mtimeMs: writeResult.mtimeMs
    };
  });

  handle('entry:create', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    const created = await files.createEntry(
      state.workspaceRoot,
      payload && payload.parentRel,
      payload && payload.name,
      payload && payload.type === 'dir' ? 'dir' : 'file'
    );
    const workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
    return { entry: created, workspace };
  });

  handle('entry:rename', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    const result = await files.renameEntry(state.workspaceRoot, payload && payload.relPath, payload && payload.name);
    if (settings.lastFile) {
      const rel = files.toRelPath(state.workspaceRoot, settings.lastFile);
      if (rel === result.oldRelPath || (rel && rel.startsWith(`${result.oldRelPath}/`))) {
        const oldAbs = files.resolveInside(state.workspaceRoot, result.oldRelPath);
        const newAbs = files.resolveInside(state.workspaceRoot, result.newRelPath);
        const suffix = path.relative(oldAbs, settings.lastFile);
        settings.lastFile = path.resolve(newAbs, suffix);
        persistSettings();
      }
    }
    const workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
    return { ...result, workspace };
  });

  handle('entry:delete', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    const relPath = payload && payload.relPath;
    const targetAbs = files.resolveInside(state.workspaceRoot, relPath);
    await files.deleteEntry(state.workspaceRoot, relPath);
    if (settings.lastFile && files.isInside(targetAbs, settings.lastFile)) {
      settings.lastFile = null;
      persistSettings();
    }
    const workspace = await files.listWorkspace(state.workspaceRoot, listOptions());
    return { relPath, workspace };
  });

  handle('entry:reveal', async (payload) => {
    let abs;
    if (payload && typeof payload.relPath === 'string') {
      abs = files.resolveInside(state.workspaceRoot, payload.relPath);
    } else if (payload && typeof payload.path === 'string') {
      abs = path.resolve(payload.path);
      if (!isAllowedPath(abs)) throw new Error('无权访问该文件');
    } else {
      throw new Error('缺少路径');
    }
    shell.showItemInFolder(abs);
    return true;
  });

  handle('search:query', async (query) => {
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    return files.searchWorkspace(state.workspaceRoot, query, listOptions());
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
      const workspace = await setWorkspace(result.directory);
      return { workspace };
    }
    if (result.path) {
      const file = await openExternalFile(result.path);
      return { file, workspace: state.workspaceRoot ? await files.listWorkspace(state.workspaceRoot, listOptions()) : null };
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
    const abs = resolveDocPath(payload);
    return backups.listBackups(backupsDir, abs);
  });
  handle('backups:create', async (payload) => {
    const abs = resolveDocPath(payload);
    const item = await backups.createBackup(backupsDir, abs, { force: true });
    return { item, list: await backups.listBackups(backupsDir, abs) };
  });
  handle('backups:read', async (payload) => {
    const abs = resolveDocPath(payload);
    return backups.readBackup(backupsDir, abs, payload && payload.id);
  });

  handle('recovery:save', async (entry) => {
    if (!recoveryStore) return false;
    if (entry && typeof entry.path === 'string' && entry.path) allowExternal(entry.path);
    await recoveryStore.save(entry);
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
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    const docAbs = resolveDocPath(payload);
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
    return saveImageToAssets(state.workspaceRoot, docAbs, buffer, path.basename(chosen), '');
  });

  handle('image:saveBuffer', async (payload) => {
    if (!state.workspaceRoot) throw new Error('请先打开文件夹');
    if (!payload || !payload.data) throw new Error('缺少图片内容');
    const docAbs = resolveDocPath(payload);
    const buffer = Buffer.from(payload.data);
    return saveImageToAssets(state.workspaceRoot, docAbs, buffer, payload.name, payload.mime);
  });

  handle('edit:action', async (action) => {
    const allowed = new Set(['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']);
    if (!allowed.has(action)) throw new Error('不支持的编辑操作');
    if (!win || win.isDestroyed()) return false;
    win.webContents[action]();
    return true;
  });

  handle('ui:confirm', async (payload) => {
    if (TEST) return { response: 1 };
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
        testRoot
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
