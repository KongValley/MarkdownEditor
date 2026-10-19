'use strict';

const bridge = window.api;
const T = window.MDText;
const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = {
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

const el = {
  app: $('app'),
  workspaceTitle: $('workspaceTitle'),
  wsName: $('wsName'),
  wsPath: $('wsPath'),
  tree: $('tree'),
  sidebarEmpty: $('sidebarEmpty'),
  sidebarFoot: $('sidebarFoot'),
  outlinePanel: $('outlinePanel'),
  outlineList: $('outlineList'),
  outlineCount: $('outlineCount'),
  searchInput: $('searchInput'),
  btnClearSearch: $('btnClearSearch'),
  searchResults: $('searchResults'),
  welcome: $('welcome'),
  welcomeTitle: $('welcomeTitle'),
  welcomeDesc: $('welcomeDesc'),
  welcomeOpenFolder: $('welcomeOpenFolder'),
  welcomeOpenFile: $('welcomeOpenFile'),
  welcomeNewNote: $('welcomeNewNote'),
  recentWrap: $('recentWrap'),
  recentList: $('recentList'),
  btnClearRecent: $('btnClearRecent'),
  editorWrap: $('editorWrap'),
  editor: $('editor'),
  tabbar: $('tabbar'),
  preview: $('preview'),
  previewPane: $('previewPane'),
  split: $('split'),
  splitter: $('splitter'),
  docTitle: $('docTitle'),
  docPath: $('docPath'),
  conflict: $('conflict'),
  missing: $('missing'),
  recoveredBanner: $('recoveredBanner'),
  findbar: $('findbar'),
  findInput: $('findInput'),
  findCount: $('findCount'),
  findCase: $('findCase'),
  findRegex: $('findRegex'),
  replaceInput: $('replaceInput'),
  modal: $('modal'),
  modalForm: $('modalForm'),
  modalTitle: $('modalTitle'),
  modalDesc: $('modalDesc'),
  modalInput: $('modalInput'),
  modalError: $('modalError'),
  modalCancel: $('modalCancel'),
  modalOk: $('modalOk'),
  settingsModal: $('settingsModal'),
  settingsForm: $('settingsForm'),
  historyModal: $('historyModal'),
  historyList: $('historyList'),
  historyDesc: $('historyDesc'),
  recoveryModal: $('recoveryModal'),
  recoveryList: $('recoveryList'),
  contextMenu: $('contextMenu'),
  toasts: $('toasts'),
  statusSave: $('statusSave'),
  statusFile: $('statusFile'),
  statusWords: $('statusWords'),
  statusCursor: $('statusCursor'),
  statusEol: $('statusEol'),
  btnNewNote: $('btnNewNote'),
  btnOpenFolder: $('btnOpenFolder'),
  btnSave: $('btnSave'),
  btnSaveAs: $('btnSaveAs'),
  btnReveal: $('btnReveal'),
  btnHistory: $('btnHistory'),
  btnNewFolder: $('btnNewFolder'),
  btnRefresh: $('btnRefresh'),
  btnOpenFolderSidebar: $('btnOpenFolderSidebar'),
  btnToggleSidebar: $('btnToggleSidebar'),
  btnTogglePreview: $('btnTogglePreview'),
  btnTheme: $('btnTheme'),
  btnSettings: $('btnSettings'),
  btnOverwrite: $('btnOverwrite'),
  btnReload: $('btnReload'),
  btnMissingSaveAs: $('btnMissingSaveAs'),
  btnMissingDiscard: $('btnMissingDiscard'),
  btnRecoveredSave: $('btnRecoveredSave'),
  btnRecoveredSaveAs: $('btnRecoveredSaveAs'),
  btnRecoveredDiscard: $('btnRecoveredDiscard'),
  btnFind: $('btnFind'),
  toolbar: $('toolbar')
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  workspace: null,
  tabs: [],
  activeId: null,
  nextTabId: 1,
  recent: [],
  selectedDir: '',
  expanded: new Set(),
  searchToken: 0,
  find: { open: false, query: '', replacement: '', caseSensitive: false, regex: false, ranges: [], index: -1, marks: [] },
  outline: [],
  lastRefresh: 0,
  platform: 'win32',
  testMode: false,
  recoveryEntries: []
};

let cm = null;
let renderer = null;
let markedReady = false;
let previewTimer = null;
let autosaveTimer = null;
let recoveryTimer = null;
let saveQueue = Promise.resolve();
let modalResolve = null;
let gridDrag = null;
let suppressChange = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function baseName(value) {
  const text = normalizeSlashes(value).replace(/\/+$/, '');
  const index = text.lastIndexOf('/');
  return index >= 0 ? text.slice(index + 1) : text;
}

function dirname(value) {
  const text = normalizeSlashes(value).replace(/\/+$/, '');
  const index = text.lastIndexOf('/');
  if (index < 0) return '';
  if (index === 2 && /^[a-zA-Z]:/.test(text)) return text.slice(0, 3);
  return text.slice(0, index);
}

function absFromRel(root, relPath) {
  if (!root || relPath == null) return null;
  return `${normalizeSlashes(root).replace(/\/+$/, '')}/${relPath}`;
}

function isPathInside(root, target) {
  if (!root || !target) return false;
  const r = normalizeSlashes(root).replace(/\/+$/, '').toLowerCase();
  const t = normalizeSlashes(target).toLowerCase();
  return t === r || t.startsWith(`${r}/`);
}

function relativeToRoot(root, target) {
  if (!isPathInside(root, target)) return null;
  const r = normalizeSlashes(root).replace(/\/+$/, '');
  const t = normalizeSlashes(target);
  if (t.toLowerCase() === r.toLowerCase()) return '';
  return t.slice(r.length + 1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeLoose(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveLocalPath(baseDir, relative) {
  let target = String(relative || '').replace(/\\/g, '/');
  target = decodeLoose(target);
  if (!target) return '';
  if (/^[a-zA-Z]:\//.test(target) || target.startsWith('//')) return target;
  const base = normalizeSlashes(baseDir).replace(/\/+$/, '');
  if (!base) return target;
  const combined = `${base}/${target}`;
  const drive = /^[a-zA-Z]:/.test(combined) ? combined.slice(0, 2) : '';
  const rest = drive ? combined.slice(2) : combined;
  const parts = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

function toFileUrl(filePath) {
  let value = normalizeSlashes(filePath);
  if (/^[a-zA-Z]:\//.test(value)) {
    const drive = value.slice(0, 2);
    const rest = value.slice(2).split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `file:///${drive}/${rest}`;
  }
  value = value.replace(/^\/+/, '');
  return `file:///${value.split('/').map(encodeURIComponent).join('/')}`;
}

function baseDirForRender(tab) {
  if (tab && tab.path) return dirname(tab.path);
  if (state.workspace) return state.workspace.root;
  return '';
}

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) || null;
}

function findTabByPath(filePath) {
  if (!filePath) return null;
  const lower = normalizeSlashes(filePath).toLowerCase();
  return state.tabs.find((tab) => tab.path && normalizeSlashes(tab.path).toLowerCase() === lower) || null;
}

/* ---------- Markdown 渲染 ---------- */

function setupMarked() {
  if (!window.marked) {
    markedReady = false;
    return;
  }
  markedReady = true;
  renderer = new window.marked.Renderer();
  renderer.html = (html) => escapeHtml(html);
  renderer.code = (code, infostring) => {
    const info = String(infostring || '').trim().split(/\s+/)[0];
    let highlighted = escapeHtml(code);
    if (state.settings.syntaxHighlight && window.hljs && info && /^[a-z0-9+#._-]+$/i.test(info)) {
      const tab = activeTab();
      if (!tab || tab.text.length <= 300000) {
        const language = window.hljs.getLanguage(info) ? info : null;
        if (language) {
          try {
            highlighted = window.hljs.highlight(code, { language, ignoreIllegals: true }).value;
          } catch {
            highlighted = escapeHtml(code);
          }
        }
      }
    }
    const className = info ? ` class="hljs language-${escapeHtml(info)}"` : ' class="hljs"';
    return `<pre><code${className}>${highlighted}</code></pre>`;
  };
  renderer.link = (href, title, text) => {
    const raw = String(href || '');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    if (!raw) return text;
    if (raw.startsWith('#')) return `<a href="${escapeHtml(raw)}"${titleAttr}>${text}</a>`;
    if (/^(https?:|mailto:)/i.test(raw)) {
      return `<a href="${escapeHtml(raw)}" rel="noreferrer"${titleAttr}>${text}</a>`;
    }
    if (/^(javascript|data|vbscript):/i.test(raw)) return text;
    if (raw.startsWith('//')) return text;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw);
    if (hasScheme && !/^file:/i.test(raw)) return text;
    return `<a href="#" class="local-link" data-local-href="${escapeHtml(raw)}"${titleAttr}>${text}</a>`;
  };
  renderer.image = (href, title, text) => {
    const raw = String(href || '');
    if (!raw) return escapeHtml(text || '');
    let src = '';
    if (/^https?:/i.test(raw)) {
      if (!state.settings.remoteImages) return escapeHtml(text || '');
      src = raw;
    } else if (/^file:/i.test(raw)) {
      src = raw;
    } else if (/^data:image\/(png|jpeg|gif|webp|bmp);/i.test(raw)) {
      src = raw;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
      return escapeHtml(text || '');
    } else {
      const local = resolveLocalPath(baseDirForRender(activeTab()), raw);
      if (!local) return escapeHtml(text || '');
      src = toFileUrl(local);
    }
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text || '')}"${titleAttr}>`;
  };
  if (window.marked.setOptions) {
    window.marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });
  }
}

function renderPreview() {
  const tab = activeTab();
  if (!tab) {
    el.preview.replaceChildren();
    return;
  }
  if (tab.text.length > 300000) {
    const notice = document.createElement('div');
    notice.className = 'preview-limit';
    notice.textContent = `文档较大（${tab.text.length.toLocaleString('zh-CN')} 字符），已暂停实时预览以保持编辑流畅。`;
    el.preview.replaceChildren(notice);
    return;
  }
  if (!markedReady) {
    const pre = document.createElement('pre');
    pre.textContent = tab.text;
    el.preview.replaceChildren(pre);
    return;
  }
  try {
    el.preview.innerHTML = window.marked.parse(tab.text, {
      gfm: true,
      breaks: false,
      headerIds: true,
      mangle: false,
      renderer
    });
  } catch (error) {
    const notice = document.createElement('div');
    notice.className = 'preview-limit';
    notice.textContent = `预览渲染失败：${error.message}`;
    el.preview.replaceChildren(notice);
    logError(`预览渲染失败：${error.stack || error}`);
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    renderPreview();
    renderOutline();
    if (state.find.open) runFind(true);
  }, 80);
}

/* ---------- 状态与标签 ---------- */

function updateCursor() {
  if (!cm) return;
  const cursor = cm.getCursor();
  el.statusCursor.textContent = `行 ${cursor.line + 1}，列 ${cursor.ch + 1}`;
  updateOutlineActive(cursor.line);
}

function updateStatus() {
  const tab = activeTab();
  const text = tab ? tab.text : '';
  const words = T.countWords(text);
  const goal = state.settings.wordGoal || 0;
  const parts = [];
  if (words == null) parts.push(`${text.length.toLocaleString('zh-CN')} 字符`);
  else if (goal > 0) parts.push(`${words.toLocaleString('zh-CN')}/${goal.toLocaleString('zh-CN')} 字`);
  else parts.push(`${words.toLocaleString('zh-CN')} 字`);
  if (words != null && state.settings.showReadingTime) {
    const minutes = T.readingMinutes(text, 300);
    if (minutes != null) parts.push(`约 ${minutes} 分钟`);
  }
  el.statusWords.textContent = parts.join(' · ');
  el.statusWords.classList.toggle('goal-met', goal > 0 && words != null && words >= goal);
  el.statusFile.textContent = tab ? (tab.relPath || tab.path || '') : '';
  el.statusFile.title = tab && tab.path ? tab.path : '';
  el.statusEol.textContent = tab ? (tab.eol === 'crlf' ? 'CRLF' : 'LF') : '';

  let label = '就绪';
  let tone = '';
  if (tab) {
    if (tab.conflict) {
      label = '外部冲突';
      tone = 'conflict';
    } else if (tab.missing) {
      label = '文件缺失';
      tone = 'error';
    } else if (tab.recovered) {
      label = '恢复草稿';
      tone = 'dirty';
    } else if (tab.saving) {
      label = '保存中…';
      tone = 'saving';
    } else if (tab.dirty) {
      label = '未保存';
      tone = 'dirty';
    } else {
      label = '已保存';
      tone = 'saved';
    }
  }
  el.statusSave.textContent = label;
  el.statusSave.className = `save-state ${tone}`.trim();
  updateCursor();
}

function updateTitle() {
  const tab = activeTab();
  const name = tab ? tab.name : (state.workspace ? state.workspace.name : 'Markdown 笔记');
  const marker = tab && (tab.dirty || tab.recovered) ? '● ' : '';
  el.docTitle.textContent = tab ? `${marker}${tab.name}` : '';
  el.docPath.textContent = tab ? (tab.relPath || tab.path || '') : '';
  document.title = tab ? `${marker}${name} — Markdown 笔记` : 'Markdown 笔记';
}

function updateBanners() {
  const tab = activeTab();
  el.conflict.hidden = !(tab && tab.conflict);
  el.missing.hidden = !(tab && tab.missing && !tab.conflict);
  el.recoveredBanner.hidden = !(tab && tab.recovered && !tab.conflict && !tab.missing);
}

function syncButtons() {
  const tab = activeTab();
  el.btnNewNote.disabled = !state.workspace;
  el.btnNewFolder.disabled = !state.workspace;
  el.btnRefresh.disabled = !state.workspace;
  el.btnSave.disabled = !tab;
  el.btnSaveAs.disabled = !tab;
  el.btnReveal.disabled = !tab;
  el.btnHistory.disabled = !tab || !tab.path;
  el.btnTogglePreview.disabled = !tab;
  el.searchInput.disabled = !state.workspace;
  el.btnToggleSidebar.classList.toggle('active', state.settings.sidebar);
  el.btnTogglePreview.classList.toggle('active', state.settings.preview);
}

function updateWorkspaceChrome() {
  if (state.workspace) {
    el.workspaceTitle.textContent = state.workspace.root;
    el.wsName.textContent = state.workspace.name;
    el.wsPath.textContent = state.workspace.root;
    el.tree.hidden = false;
    el.sidebarEmpty.hidden = true;
    el.sidebarFoot.hidden = false;
    el.searchInput.placeholder = '筛选文件，回车全文搜索';
  } else {
    el.workspaceTitle.textContent = '本地 Markdown 笔记';
    el.wsName.textContent = '未打开文件夹';
    el.wsPath.textContent = '选择一个本地文件夹管理 Markdown 文档';
    el.tree.hidden = true;
    el.sidebarEmpty.hidden = false;
    el.sidebarFoot.hidden = true;
    el.searchInput.placeholder = '打开文件夹后可搜索';
    hideSearchResults();
  }
  applyLayout();
  syncButtons();
}

function applyLayout() {
  el.app.classList.toggle('sidebar-hidden', !state.settings.sidebar);
  el.editorWrap.classList.toggle('preview-hidden', !state.settings.preview);
  el.split.style.setProperty('--split-pct', `${Math.round(state.settings.split * 100)}%`);
  document.documentElement.style.setProperty('--editor-font-size', `${state.settings.fontSize}px`);
  document.documentElement.style.setProperty('--editor-max-width', state.settings.lineWidth > 0 ? `${state.settings.lineWidth}px` : 'none');
  if (cm) requestAnimationFrame(() => cm.refresh());
}

function updateWelcome() {
  const hasWorkspace = Boolean(state.workspace);
  el.welcomeTitle.textContent = hasWorkspace ? '选择一篇笔记' : 'Markdown 笔记';
  el.welcomeDesc.textContent = hasWorkspace
    ? `已打开「${state.workspace.name}」。从左侧选择文件，或新建一篇笔记。`
    : '轻量、离线、为 Windows 7 32 位优化的 Markdown 编辑器与文档管理工具。';
  el.welcomeOpenFolder.textContent = hasWorkspace ? '切换文件夹' : '打开文件夹';
}

function showWelcome() {
  el.welcome.hidden = false;
  el.editorWrap.hidden = true;
  updateWelcome();
}

function showEditor() {
  el.welcome.hidden = true;
  el.editorWrap.hidden = false;
  if (cm) requestAnimationFrame(() => cm.refresh());
}

function renderRecent() {
  el.recentList.replaceChildren();
  el.recentWrap.hidden = state.recent.length === 0;
  for (const item of state.recent.slice(0, 8)) {
    const button = document.createElement('div');
    button.className = 'recent-item';
    button.title = item.path;
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    const type = document.createElement('span');
    type.className = 'recent-type';
    type.textContent = item.type === 'folder' ? '夹' : '文';
    const main = document.createElement('span');
    main.className = 'recent-main';
    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = item.name || baseName(item.path);
    const path = document.createElement('div');
    path.className = 'recent-path';
    path.textContent = item.path;
    main.append(name, path);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-remove';
    remove.textContent = '×';
    remove.title = '删除这条记录';
    remove.setAttribute('aria-label', `删除最近记录 ${item.name || item.path}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeRecentItem(item);
    });
    button.append(type, main, remove);
    button.addEventListener('click', () => openRecentItem(item));
    button.addEventListener('keydown', (event) => {
      if (event.target !== button) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRecentItem(item);
      }
    });
    el.recentList.append(button);
  }
}

async function removeRecentItem(item) {
  if (!item || !item.path) return;
  try {
    state.recent = await bridge.removeRecent(item.path);
    renderRecent();
  } catch (error) {
    showToast(`删除最近记录失败：${error.message}`, 'error');
  }
}

async function clearRecentList() {
  if (state.recent.length === 0) return;
  const answer = await bridge.confirm({
    type: 'warning',
    title: '清空最近打开',
    message: '清空最近打开记录？',
    detail: '只会清空列表，不会删除磁盘上的文件或文件夹。',
    buttons: ['取消', '清空'],
    defaultId: 0,
    cancelId: 0
  });
  if (answer.response !== 1) return;
  try {
    state.recent = await bridge.clearRecent();
    renderRecent();
    showToast('已清空最近打开', 'success');
  } catch (error) {
    showToast(`清空失败：${error.message}`, 'error');
  }
}

async function refreshRecent() {
  try {
    state.recent = await bridge.getRecent();
    renderRecent();
  } catch {
    // 最近记录失败不影响编辑。
  }
}

function renderTabBar() {
  el.tabbar.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement('div');
    button.className = `tab${tab.id === state.activeId ? ' active' : ''}${tab.recovered ? ' recovered' : ''}`;
    button.dataset.id = String(tab.id);
    button.setAttribute('role', 'tab');
    button.title = tab.path || tab.name;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.name;
    button.append(name);
    if (tab.dirty || tab.recovered) {
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      button.append(dot);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = '关闭标签页';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });
    button.append(close);
    button.addEventListener('click', () => activateTab(tab.id));
    button.addEventListener('auxclick', (event) => {
      if (event.button === 1) closeTab(tab.id);
    });
    el.tabbar.append(button);
  }
}

function storeEditorState() {
  const tab = activeTab();
  if (!tab || !cm) return;
  const info = cm.getScrollInfo();
  tab.scroll = { left: info.left, top: info.top };
  const from = cm.getCursor('from');
  const to = cm.getCursor('to');
  tab.cursor = { anchor: { line: from.line, ch: from.ch }, head: { line: to.line, ch: to.ch } };
}

function loadTabIntoEditor(tab) {
  if (!cm) return;
  suppressChange = true;
  cm.setValue(tab.text);
  cm.clearHistory();
  suppressChange = false;
  const cursor = tab.cursor && tab.cursor.anchor ? { line: tab.cursor.anchor.line, ch: tab.cursor.anchor.ch } : { line: 0, ch: 0 };
  cm.setCursor(cursor);
  const scroll = tab.scroll || { left: 0, top: 0 };
  cm.scrollTo(scroll.left, scroll.top);
  requestAnimationFrame(() => cm.refresh());
}

function activateTab(id, options = {}) {
  if (state.activeId === id) {
    if (options.line) gotoLine(options.line);
    return;
  }
  const previous = activeTab();
  if (previous) {
    storeEditorState();
    if (previous.dirty && !previous.conflict && !previous.missing && !previous.recovered) requestSave(previous);
  }
  state.activeId = id;
  const tab = activeTab();
  if (tab) loadTabIntoEditor(tab);
  closeFind();
  renderTabBar();
  updateTitle();
  updateStatus();
  updateBanners();
  renderPreview();
  renderOutline();
  renderTree();
  showEditor();
  if (options.line) gotoLine(options.line);
  else if (options.focus !== false && cm) cm.focus();
}

function createTab(doc, options = {}) {
  const tab = {
    id: state.nextTabId,
    path: doc.path || null,
    relPath: doc.relPath == null ? null : doc.relPath,
    name: doc.name || baseName(doc.path),
    eol: doc.eol || 'lf',
    encoding: doc.encoding || 'utf8',
    mtimeMs: Number.isFinite(doc.mtimeMs) ? doc.mtimeMs : null,
    text: String(doc.content == null ? '' : doc.content),
    savedText: options.baseContent != null ? String(options.baseContent) : String(doc.content == null ? '' : doc.content),
    dirty: false,
    conflict: false,
    missing: false,
    recovered: Boolean(options.recovered),
    saving: false,
    scroll: { left: 0, top: 0 },
    cursor: null
  };
  state.nextTabId += 1;
  tab.dirty = tab.recovered || tab.text !== tab.savedText;
  state.tabs.push(tab);
  return tab;
}

function openDoc(doc, options = {}) {
  const existing = findTabByPath(doc.path);
  if (existing) {
    if (options.recovered) {
      existing.text = String(doc.content == null ? '' : doc.content);
      existing.recovered = true;
      existing.dirty = true;
      existing.mtimeMs = Number.isFinite(doc.mtimeMs) ? doc.mtimeMs : existing.mtimeMs;
      if (state.activeId === existing.id) loadTabIntoEditor(existing);
    }
    activateTab(existing.id, { line: options.line, focus: options.focus });
    return existing;
  }
  const tab = createTab(doc, options);
  state.activeId = tab.id;
  loadTabIntoEditor(tab);
  renderTabBar();
  updateTitle();
  updateStatus();
  updateBanners();
  renderPreview();
  renderOutline();
  renderTree();
  showEditor();
  if (options.line) gotoLine(options.line);
  else if (options.focus !== false && cm) cm.focus();
  return tab;
}

function gotoLine(line) {
  if (!cm) return;
  const target = Math.max(0, Number(line) - 1);
  cm.setCursor({ line: target, ch: 0 });
  cm.scrollIntoView({ line: target, ch: 0 }, 80);
  updateCursor();
}

function closeTab(id, options = {}) {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab) return Promise.resolve(true);
  const finish = () => {
    const index = state.tabs.findIndex((item) => item.id === id);
    state.tabs = state.tabs.filter((item) => item.id !== id);
    clearRecovery(tab);
    if (state.activeId === id) {
      const next = state.tabs[Math.min(index, state.tabs.length - 1)] || null;
      state.activeId = next ? next.id : null;
      if (next) {
        loadTabIntoEditor(next);
        renderTabBar();
        updateTitle();
        updateStatus();
        updateBanners();
        renderPreview();
        renderOutline();
        renderTree();
        showEditor();
      } else {
        renderTabBar();
        showWelcome();
        updateStatus();
      }
    } else {
      renderTabBar();
    }
    renderTree();
    return true;
  };
  if (!(tab.dirty || tab.recovered || tab.conflict || tab.missing)) return Promise.resolve(finish());
  if (options.force) return Promise.resolve(finish());
  return bridge.confirm({
    type: 'warning',
    title: '关闭标签页',
    message: `「${tab.name}」有未保存的更改`,
    detail: tab.recovered ? '这是恢复的草稿，关闭会丢弃。' : '关闭前可以保存。',
    buttons: ['取消', '不保存', '保存'],
    defaultId: 2,
    cancelId: 0
  }).then(async (answer) => {
    if (answer.response === 0) return false;
    if (answer.response === 2) {
      const ok = await requestSave(tab);
      if (!ok) return false;
    }
    return finish();
  });
}

/* ---------- 保存 ---------- */

async function saveTab(tab, options = {}) {
  if (!tab || !tab.path) return false;
  const force = Boolean(options.force);
  if (!tab.dirty && !force && !tab.recovered) return true;
  if (tab.conflict && !force) return false;
  if (tab.missing && !force) return false;
  clearTimeout(autosaveTimer);
  const snapshot = tab.text;
  tab.saving = true;
  if (tab.id === state.activeId) updateStatus();
  let result;
  try {
    result = await bridge.save({
      path: tab.path,
      relPath: tab.relPath,
      content: snapshot,
      eol: tab.eol,
      encoding: tab.encoding,
      expectedMtime: tab.mtimeMs,
      force
    });
  } catch (error) {
    tab.saving = false;
    if (tab.id === state.activeId) updateStatus();
    showToast(`保存失败：${error.message}`, 'error');
    logError(`保存失败：${error.stack || error}`);
    return false;
  }
  tab.saving = false;
  if (result.conflict) {
    tab.conflict = true;
    if (tab.id === state.activeId) {
      updateStatus();
      updateBanners();
    }
    renderTabBar();
    return false;
  }
  if (result.missing) {
    tab.missing = true;
    if (tab.id === state.activeId) {
      updateStatus();
      updateBanners();
    }
    renderTabBar();
    return false;
  }
  tab.conflict = false;
  tab.missing = false;
  tab.recovered = false;
  tab.mtimeMs = result.mtimeMs;
  if (result.relPath !== undefined) tab.relPath = result.relPath;
  tab.savedText = snapshot;
  tab.dirty = tab.text !== snapshot;
  clearRecovery(tab);
  if (tab.id === state.activeId) {
    updateTitle();
    updateStatus();
    updateBanners();
  }
  renderTabBar();
  if (tab.dirty && tab.id === state.activeId) scheduleAutosave(tab);
  return true;
}

function requestSave(tab = activeTab(), options = {}) {
  if (!tab) return Promise.resolve(false);
  saveQueue = saveQueue.then(() => saveTab(tab, options)).catch((error) => {
    logError(`保存队列异常：${error.stack || error}`);
    return false;
  });
  return saveQueue;
}

function scheduleAutosave(tab) {
  clearTimeout(autosaveTimer);
  if (!state.settings.autosave || !tab || tab.conflict || tab.missing || tab.recovered) return;
  autosaveTimer = setTimeout(() => {
    if (tab.dirty && !tab.conflict && !tab.missing && !tab.recovered) requestSave(tab);
  }, state.settings.autosaveDelay);
}

async function flushSave() {
  let blocked = false;
  for (const tab of state.tabs.slice()) {
    if (tab.recovered || tab.conflict || tab.missing) {
      if (tab.dirty || tab.recovered) blocked = true;
      continue;
    }
    if (!tab.dirty) continue;
    const ok = await requestSave(tab);
    if (!ok) blocked = true;
  }
  return { ok: !blocked, blocked };
}

/* ---------- 草稿恢复 ---------- */

function recoveryKey(tab) {
  return tab.path ? normalizeSlashes(tab.path).toLowerCase() : `tab-${tab.id}`;
}

function scheduleRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(persistRecovery, 1200);
}

async function persistRecovery() {
  for (const tab of state.tabs) {
    if (!(tab.dirty || tab.recovered)) continue;
    if (tab.text.length > 5 * 1024 * 1024) continue;
    try {
      await bridge.saveRecovery({
        key: recoveryKey(tab),
        path: tab.path,
        name: tab.name,
        relPath: tab.relPath,
        content: tab.text,
        eol: tab.eol,
        encoding: tab.encoding,
        mtimeMs: tab.mtimeMs,
        timestamp: Date.now()
      });
    } catch {
      // 恢复快照失败不阻塞编辑。
    }
  }
}

function clearRecovery(tab) {
  if (!tab) return;
  bridge.clearRecovery(recoveryKey(tab)).catch(() => {});
}

function showRecoveryModal(entries) {
  state.recoveryEntries = entries;
  el.recoveryList.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = entry.name || (entry.path ? baseName(entry.path) : '未命名');
    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.textContent = `${new Date(entry.timestamp).toLocaleString('zh-CN')} · ${entry.path || '无路径'}`;
    meta.append(name, sub);
    item.append(meta);
    el.recoveryList.append(item);
  }
  el.recoveryModal.hidden = entries.length === 0;
}

async function restoreRecovery() {
  const entries = state.recoveryEntries.slice();
  el.recoveryModal.hidden = true;
  state.recoveryEntries = [];
  for (const entry of entries) {
    const existing = findTabByPath(entry.path);
    if (existing) {
      existing.text = entry.content;
      existing.recovered = true;
      existing.dirty = true;
      existing.mtimeMs = entry.mtimeMs;
      if (state.activeId === existing.id) loadTabIntoEditor(existing);
    } else {
      const tab = createTab({
        path: entry.path,
        relPath: entry.relPath,
        name: entry.name,
        content: entry.content,
        eol: entry.eol,
        encoding: entry.encoding,
        mtimeMs: entry.mtimeMs
      }, { recovered: true, baseContent: '' });
      if (!state.activeId) state.activeId = tab.id;
    }
  }
  if (state.tabs.length > 0) {
    const target = state.tabs.find((tab) => tab.recovered) || state.tabs[0];
    state.activeId = null;
    activateTab(target.id, { focus: false });
  }
  renderTabBar();
  showToast(`已恢复 ${entries.length} 个草稿，请检查后保存`, 'warn', 6000);
}

async function discardRecovery() {
  el.recoveryModal.hidden = true;
  state.recoveryEntries = [];
  try {
    await bridge.clearAllRecovery();
  } catch {
    // 忽略。
  }
}

/* ---------- 编辑器事件 ---------- */

function onEditorChange() {
  if (suppressChange) return;
  const tab = activeTab();
  if (!tab) return;
  tab.text = cm.getValue();
  tab.dirty = tab.recovered || tab.text !== tab.savedText;
  renderTabBar();
  updateTitle();
  updateStatus();
  updateBanners();
  schedulePreview();
  scheduleAutosave(tab);
  scheduleRecovery();
}

function onCursorActivity() {
  updateCursor();
  updateOutlineActive(cm.getCursor().line);
}

function outlineIndexForLine(line) {
  let active = -1;
  for (let index = 0; index < state.outline.length; index += 1) {
    if (state.outline[index].line <= line) active = index;
    else break;
  }
  return active;
}

function previewHeadingElements() {
  return el.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
}

function setPaneScrollTop(value) {
  const max = Math.max(0, el.previewPane.scrollHeight - el.previewPane.clientHeight);
  const target = Math.min(max, Math.max(0, value));
  if (Math.abs(el.previewPane.scrollTop - target) > 1) el.previewPane.scrollTop = target;
}

function syncEditorToPreview(info) {
  const headings = previewHeadingElements();
  const visibleLine = cm.lineAtHeight(info.top + 4, 'local');
  const index = outlineIndexForLine(visibleLine);
  if (index >= 0 && headings[index]) {
    const target = headings[index];
    const top = target.getBoundingClientRect().top - el.previewPane.getBoundingClientRect().top + el.previewPane.scrollTop - 8;
    setPaneScrollTop(top);
    return;
  }
  const sourceMax = info.height - info.clientHeight;
  const targetMax = el.previewPane.scrollHeight - el.previewPane.clientHeight;
  if (sourceMax > 0 && targetMax > 0) setPaneScrollTop((info.top / sourceMax) * targetMax);
}

function syncPreviewToEditor() {
  const headings = previewHeadingElements();
  const info = cm.getScrollInfo();
  if (headings.length > 0 && state.outline.length > 0) {
    const paneTop = el.previewPane.getBoundingClientRect().top;
    let index = 0;
    for (let i = 0; i < headings.length && i < state.outline.length; i += 1) {
      if (headings[i].getBoundingClientRect().top - paneTop <= 20) index = i;
      else break;
    }
    const heading = state.outline[index];
    if (heading) {
      const line = Math.max(0, heading.line - 1);
      const max = Math.max(0, info.height - info.clientHeight);
      const target = Math.min(max, Math.max(0, cm.heightAtLine(line, 'local') - 8));
      if (Math.abs(info.top - target) > 2) cm.scrollTo(null, target);
      return;
    }
  }
  const sourceMax = el.previewPane.scrollHeight - el.previewPane.clientHeight;
  const targetMax = info.height - info.clientHeight;
  if (sourceMax > 0 && targetMax > 0) {
    const target = Math.min(targetMax, Math.max(0, (el.previewPane.scrollTop / sourceMax) * targetMax));
    if (Math.abs(info.top - target) > 2) cm.scrollTo(info.left, target);
  }
}

function onEditorScroll() {
  const tab = activeTab();
  if (!tab || !cm) return;
  const info = cm.getScrollInfo();
  tab.scroll = { left: info.left, top: info.top };
  if (!state.settings.preview) return;
  syncEditorToPreview(info);
}

function insertText(value) {
  if (!cm) return;
  cm.replaceSelection(value, 'end');
  cm.focus();
}

function wrapSelection(before, after, placeholder) {
  if (!cm) return;
  const from = cm.getCursor('from');
  const to = cm.getCursor('to');
  const selected = cm.getSelection();
  const content = selected || placeholder || '';
  cm.replaceRange(before + content + after, from, to, '+input');
  const start = cm.posFromIndex(cm.indexFromPos(from) + before.length);
  const end = cm.posFromIndex(cm.indexFromPos(from) + before.length + content.length);
  cm.setSelection(start, end);
  cm.focus();
}

function toggleLinePrefix(prefix, pattern) {
  if (!cm) return;
  const from = cm.getCursor('from');
  const to = cm.getCursor('to');
  const firstLine = from.line;
  const lastLine = to.line;
  const lines = [];
  for (let line = firstLine; line <= lastLine; line += 1) lines.push(cm.getLine(line) || '');
  const test = pattern || new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const allPrefixed = lines.filter((line) => line.trim()).every((line) => test.test(line));
  const updated = lines.map((line) => {
    if (!line.trim()) return line;
    if (allPrefixed) return line.replace(test, '');
    return prefix + line;
  });
  cm.replaceRange(updated.join('\n'), { line: firstLine, ch: 0 }, { line: lastLine, ch: (cm.getLine(lastLine) || '').length }, '+input');
  cm.setSelection({ line: firstLine, ch: 0 }, { line: lastLine, ch: (updated[updated.length - 1] || '').length });
  cm.focus();
}

function toggleHeading() {
  if (!cm) return;
  const cursor = cm.getCursor();
  const line = cm.getLine(cursor.line) || '';
  const match = line.match(/^#{1,6}\s+/);
  const updated = match ? line.slice(match[0].length) : `## ${line}`;
  cm.replaceRange(updated, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length }, '+input');
  cm.setCursor({ line: cursor.line, ch: updated.length });
  cm.focus();
}

function formatCode() {
  if (!cm) return;
  const selected = cm.getSelection();
  if (!selected) {
    wrapSelection('`', '`', '代码');
    return;
  }
  if (selected.includes('\n')) {
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    cm.replaceRange(`\`\`\`\n${selected}\n\`\`\``, from, to, '+input');
    cm.setSelection(cm.posFromIndex(cm.indexFromPos(from) + 4), cm.posFromIndex(cm.indexFromPos(from) + 4 + selected.length));
  } else {
    wrapSelection('`', '`', '代码');
  }
  cm.focus();
}

async function insertLink() {
  if (!cm) return;
  const from = cm.getCursor('from');
  const to = cm.getCursor('to');
  const selected = cm.getSelection();
  const url = await promptName({
    title: '插入链接',
    description: '支持网页地址、相对路径或本机 Markdown 文件路径。',
    value: 'https://',
    placeholder: '链接地址'
  });
  if (!url) return;
  const label = (selected || '链接文字').replace(/]/g, '\\]');
  cm.replaceRange(`[${label}](${url})`, from, to, '+input');
  if (selected) cm.setCursor(cm.posFromIndex(cm.indexFromPos(from) + `[${label}](${url})`.length));
  else cm.setSelection(cm.posFromIndex(cm.indexFromPos(from) + 1), cm.posFromIndex(cm.indexFromPos(from) + 1 + label.length));
  cm.focus();
}

function insertTable() {
  if (!cm) return;
  const table = T.buildTable(['列 1', '列 2', '列 3'], [['', '', ''], ['', '', '']]);
  const cursor = cm.getCursor();
  const before = cm.getLine(cursor.line) || '';
  const prefix = cursor.ch === 0 && before === '' ? '' : '\n\n';
  cm.replaceSelection(`${prefix}${table}\n`, 'end');
  cm.focus();
}

function altTextFor(name) {
  return baseName(name).replace(/\.[^.]+$/, '') || '图片';
}

async function insertImageFromPicker() {
  const tab = activeTab();
  if (!tab || !tab.path) {
    showToast('请先保存文档，再插入图片', 'warn');
    return;
  }
  try {
    const result = await bridge.pickImage({ path: tab.path, relPath: tab.relPath });
    if (!result) return;
    insertText(`![${altTextFor(result.name)}](${result.relPath})`);
  } catch (error) {
    showToast(`插入图片失败：${error.message}`, 'error');
  }
}

async function insertImageBuffer(file) {
  const tab = activeTab();
  if (!tab || !tab.path) return;
  if (!file || !file.type || !file.type.startsWith('image/')) return;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const result = await bridge.saveImageBuffer({
      path: tab.path,
      relPath: tab.relPath,
      name: file.name || `image.${file.type.split('/')[1] || 'png'}`,
      mime: file.type,
      data
    });
    insertText(`![${altTextFor(result.name)}](${result.relPath})\n`);
  } catch (error) {
    showToast(`保存图片失败：${error.message}`, 'error');
  }
}

function clipboardImages(dataTransfer) {
  if (!dataTransfer) return [];
  const files = [];
  if (dataTransfer.files && dataTransfer.files.length) {
    for (const file of dataTransfer.files) {
      if (file.type && file.type.startsWith('image/')) files.push(file);
    }
  }
  if (files.length === 0 && dataTransfer.items) {
    for (const item of dataTransfer.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

async function handlePaste(event) {
  const files = clipboardImages(event.clipboardData);
  if (files.length === 0) return;
  event.preventDefault();
  for (const file of files) await insertImageBuffer(file);
}

async function handleDrop(event) {
  const files = clipboardImages(event.dataTransfer);
  if (files.length === 0) return;
  event.preventDefault();
  for (const file of files) await insertImageBuffer(file);
}

function handleTabKey() {
  if (!cm) return;
  const text = cm.getValue();
  const pos = cm.indexFromPos(cm.getCursor());
  const cell = T.nextTableCell(text, pos, 1);
  if (cell) {
    cm.setSelection(cm.posFromIndex(cell.start), cm.posFromIndex(cell.end));
    return;
  }
  if (cm.somethingSelected()) cm.indentSelection('add');
  else insertText('  ');
}

function handleShiftTabKey() {
  if (!cm) return;
  const text = cm.getValue();
  const pos = cm.indexFromPos(cm.getCursor());
  const cell = T.nextTableCell(text, pos, -1);
  if (cell) {
    cm.setSelection(cm.posFromIndex(cell.start), cm.posFromIndex(cell.end));
    return;
  }
  cm.indentSelection('subtract');
}

function handleEnterKey() {
  if (!cm) return;
  const text = cm.getValue();
  const pos = cm.indexFromPos(cm.getCursor());
  const next = T.listContinuation(text, pos);
  if (next) {
    if (next.type === 'continue') cm.replaceSelection(next.insert, 'end');
    else cm.replaceRange('', cm.posFromIndex(next.from), cm.posFromIndex(next.to), '+input');
    return;
  }
  cm.execCommand('newlineAndIndent');
}

/* ---------- 查找替换 ---------- */

function clearFindMarks() {
  for (const mark of state.find.marks) {
    try {
      mark.clear();
    } catch {
      // 忽略已失效的标记。
    }
  }
  state.find.marks = [];
}

function openFind() {
  if (!activeTab()) return;
  state.find.open = true;
  el.findbar.hidden = false;
  el.findInput.focus();
  el.findInput.select();
  runFind(false);
}

function closeFind() {
  if (!state.find.open) return;
  state.find.open = false;
  el.findbar.hidden = true;
  clearFindMarks();
  state.find.ranges = [];
  state.find.index = -1;
  el.findCount.textContent = '0/0';
  if (cm) cm.focus();
}

function selectMatch(index) {
  const ranges = state.find.ranges;
  if (!ranges.length || !cm) return;
  const target = ((index % ranges.length) + ranges.length) % ranges.length;
  state.find.index = target;
  const range = ranges[target];
  cm.setSelection(cm.posFromIndex(range.start), cm.posFromIndex(range.end));
  cm.scrollIntoView({ from: cm.posFromIndex(range.start), to: cm.posFromIndex(range.end) }, 60);
  el.findCount.textContent = `${target + 1}/${ranges.length}`;
}

function runFind(keepIndex) {
  const tab = activeTab();
  if (!tab || !cm) return;
  const previousIndex = keepIndex ? state.find.index : -1;
  state.find.query = el.findInput.value;
  state.find.replacement = el.replaceInput.value;
  const result = T.findMatches(tab.text, state.find.query, {
    caseSensitive: state.find.caseSensitive,
    regex: state.find.regex
  });
  clearFindMarks();
  state.find.ranges = result.ranges;
  if (result.error) {
    el.findCount.textContent = '正则错误';
    state.find.index = -1;
    return;
  }
  if (result.ranges.length === 0) {
    el.findCount.textContent = '0/0';
    state.find.index = -1;
    return;
  }
  const limit = Math.min(result.ranges.length, 1000);
  cm.operation(() => {
    for (let index = 0; index < limit; index += 1) {
      const range = result.ranges[index];
      state.find.marks.push(cm.markText(cm.posFromIndex(range.start), cm.posFromIndex(range.end), { className: 'cm-find-match' }));
    }
  });
  selectMatch(previousIndex >= 0 ? previousIndex : 0);
}

function findNext(direction) {
  if (!state.find.ranges.length) {
    runFind(false);
    return;
  }
  selectMatch(state.find.index + (direction < 0 ? -1 : 1));
}

function replaceCurrent() {
  const tab = activeTab();
  if (!tab || !cm || !state.find.ranges.length) return;
  const range = state.find.ranges[state.find.index];
  if (!range) return;
  cm.replaceRange(el.replaceInput.value, cm.posFromIndex(range.start), cm.posFromIndex(range.end), '+input');
  runFind(true);
}

function replaceAllMatches() {
  const tab = activeTab();
  if (!tab || !cm || !state.find.query) return;
  const result = T.replaceAll(tab.text, state.find.query, el.replaceInput.value, {
    caseSensitive: state.find.caseSensitive,
    regex: state.find.regex
  });
  if (result.error) {
    el.findCount.textContent = '正则错误';
    return;
  }
  if (result.count === 0) {
    el.findCount.textContent = '0/0';
    return;
  }
  cm.setValue(result.text);
  runFind(false);
  showToast(`已替换 ${result.count} 处`, 'success');
}

/* ---------- 大纲 ---------- */

function renderOutline() {
  const tab = activeTab();
  state.outline = tab ? T.extractHeadings(tab.text) : [];
  const visible = Boolean(tab) && state.settings.outline && state.outline.length > 0;
  el.outlinePanel.hidden = !visible;
  el.outlineList.replaceChildren();
  if (!visible) return;
  el.outlineCount.textContent = `${state.outline.length}`;
  state.outline.forEach((heading, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `outline-item level-${heading.level}`;
    button.textContent = heading.text;
    button.title = heading.text;
    button.dataset.index = String(index);
    button.addEventListener('click', () => gotoLine(heading.line + 1));
    el.outlineList.append(button);
  });
  updateOutlineActive(cm ? cm.getCursor().line : 0);
}

function updateOutlineActive(line) {
  if (el.outlinePanel.hidden || state.outline.length === 0) return;
  const active = outlineIndexForLine(line);
  const items = el.outlineList.querySelectorAll('.outline-item');
  items.forEach((item, index) => item.classList.toggle('active', index === active));
}

/* ---------- 编辑器右键菜单 ---------- */

function showMenuAt(event, items) {
  el.contextMenu.replaceChildren();
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      el.contextMenu.append(sep);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    if (item.danger) button.className = 'danger';
    button.textContent = item.label;
    button.addEventListener('mousedown', (mouseEvent) => mouseEvent.preventDefault());
    button.addEventListener('click', async () => {
      hideContextMenu();
      await item.action();
    });
    el.contextMenu.append(button);
  }
  el.contextMenu.hidden = false;
  const rect = el.contextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8));
  el.contextMenu.style.left = `${left}px`;
  el.contextMenu.style.top = `${top}px`;
}

function onEditorContextMenu(event) {
  event.preventDefault();
  const tab = activeTab();
  if (!tab) return;
  showMenuAt(event, [
    { label: '撤销', action: async () => { await bridge.editAction('undo'); if (cm) cm.focus(); } },
    { label: '重做', action: async () => { await bridge.editAction('redo'); if (cm) cm.focus(); } },
    { separator: true },
    { label: '剪切', action: async () => { await bridge.editAction('cut'); if (cm) cm.focus(); } },
    { label: '复制', action: async () => { await bridge.editAction('copy'); if (cm) cm.focus(); } },
    { label: '粘贴', action: async () => { await bridge.editAction('paste'); if (cm) cm.focus(); } },
    { label: '全选', action: async () => { await bridge.editAction('selectAll'); if (cm) cm.focus(); } },
    { separator: true },
    { label: '插入日期时间', action: async () => insertText(new Date().toLocaleString('zh-CN')) }
  ]);
}

function showTreeContextMenu(event, node) {
  event.preventDefault();
  event.stopPropagation();
  state.selectedDir = node.type === 'dir' ? node.relPath : dirname(node.relPath);
  renderTree();
  const items = [];
  if (node.type === 'dir') {
    items.push({ label: '新建笔记', action: () => newNote(node.relPath) });
    items.push({ label: '新建文件夹', action: () => newFolder(node.relPath) });
    items.push({ separator: true });
  }
  items.push({ label: '重命名', action: () => renameNode(node) });
  items.push({ label: node.type === 'dir' ? '删除文件夹' : '删除文件', danger: true, action: () => deleteNode(node) });
  items.push({ separator: true });
  items.push({ label: '在资源管理器中显示', action: () => revealNode(node) });
  showMenuAt(event, items);
}

function hideContextMenu() {
  el.contextMenu.hidden = true;
  el.contextMenu.replaceChildren();
}

/* ---------- 目录树 ---------- */

function ensureExpanded(relPath) {
  const parts = String(relPath || '').split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    state.expanded.add(current);
  }
}

function filterNodes(nodes, query) {
  const result = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(query) || node.relPath.toLowerCase().includes(query)) {
        result.push(node);
      }
      continue;
    }
    const children = filterNodes(node.children || [], query);
    if (children.length > 0 || node.name.toLowerCase().includes(query) || node.relPath.toLowerCase().includes(query)) {
      result.push({ ...node, children });
    }
  }
  return result;
}

function renderTree() {
  el.tree.replaceChildren();
  if (!state.workspace || !state.workspace.tree) return;
  const tab = activeTab();
  const query = el.searchInput.value.trim().toLowerCase();
  const nodes = query
    ? filterNodes(state.workspace.tree.children || [], query)
    : (state.workspace.tree.children || []);
  if (nodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = query ? '没有匹配的文件或文件夹' : '这个文件夹里还没有 Markdown 文件';
    el.tree.append(empty);
    return;
  }
  const renderNodes = (list, depth) => {
    for (const node of list) {
      const isDir = node.type === 'dir';
      const expanded = Boolean(query) || state.expanded.has(node.relPath);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `tree-row ${node.type}`;
      row.dataset.rel = node.relPath;
      row.dataset.type = node.type;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.setAttribute('role', 'treeitem');
      if (isDir) row.setAttribute('aria-expanded', String(expanded));
      if (isDir && state.selectedDir === node.relPath) row.classList.add('selected');
      if (!isDir && tab && tab.relPath === node.relPath) row.classList.add('active');
      if (isDir && expanded) row.classList.add('open');
      const chevron = document.createElement('span');
      chevron.className = 'chev';
      chevron.textContent = isDir ? '▸' : '';
      const icon = document.createElement('span');
      icon.className = `tree-icon ${isDir ? 'folder' : 'file'}`;
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = node.name;
      row.append(chevron, icon, name);
      row.addEventListener('click', () => {
        state.selectedDir = isDir ? node.relPath : dirname(node.relPath);
        if (isDir) {
          if (state.expanded.has(node.relPath)) state.expanded.delete(node.relPath);
          else state.expanded.add(node.relPath);
          renderTree();
        } else {
          openRel(node.relPath);
        }
      });
      row.addEventListener('contextmenu', (event) => showTreeContextMenu(event, node));
      el.tree.append(row);
      if (isDir && (expanded || query)) renderNodes(node.children || [], depth + 1);
    }
  };
  renderNodes(nodes, 0);
}

/* ---------- 全文搜索 ---------- */

function hideSearchResults() {
  el.searchResults.hidden = true;
  el.searchResults.replaceChildren();
}

function appendHighlighted(container, text, query) {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let index = 0;
  while (index < text.length) {
    const found = lower.indexOf(needle, index);
    if (found < 0) {
      container.append(document.createTextNode(text.slice(index)));
      return;
    }
    if (found > index) container.append(document.createTextNode(text.slice(index, found)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(found, found + query.length);
    container.append(mark);
    index = found + query.length;
  }
}

function renderSearchResults(data, query) {
  el.searchResults.replaceChildren();
  el.searchResults.hidden = false;
  const head = document.createElement('div');
  head.className = 'search-results-head';
  const count = document.createElement('span');
  count.textContent = `${data.results.length} 条结果${data.truncated ? '（已截断）' : ''}`;
  const hint = document.createElement('span');
  hint.textContent = `扫描 ${data.filesScanned} 个文件`;
  head.append(count, hint);
  el.searchResults.append(head);
  if (data.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = '没有找到匹配内容';
    el.searchResults.append(empty);
    return;
  }
  for (const result of data.results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    button.dataset.rel = result.relPath;
    button.dataset.line = String(result.line);
    const pathRow = document.createElement('div');
    pathRow.className = 'sr-path';
    const name = document.createElement('span');
    name.textContent = result.name;
    const line = document.createElement('span');
    line.className = 'sr-line';
    line.textContent = `第 ${result.line} 行`;
    pathRow.append(name, line);
    const text = document.createElement('div');
    text.className = 'sr-text';
    appendHighlighted(text, result.text || '', query);
    button.append(pathRow, text);
    button.addEventListener('click', () => openRel(result.relPath, result.line));
    el.searchResults.append(button);
  }
}

async function runSearch() {
  const query = el.searchInput.value.trim();
  if (!query) {
    hideSearchResults();
    renderTree();
    return;
  }
  const token = ++state.searchToken;
  el.searchResults.hidden = false;
  el.searchResults.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'search-loading';
  loading.textContent = '正在搜索文件内容…';
  el.searchResults.append(loading);
  try {
    const data = await bridge.search(query);
    if (token !== state.searchToken) return;
    renderSearchResults(data, query);
  } catch (error) {
    if (token !== state.searchToken) return;
    el.searchResults.replaceChildren();
    const message = document.createElement('div');
    message.className = 'search-empty';
    message.textContent = `搜索失败：${error.message}`;
    el.searchResults.append(message);
  }
}

function resetSearchFilter() {
  state.searchToken += 1;
  el.searchInput.value = '';
  el.btnClearSearch.hidden = true;
  hideSearchResults();
}

function clearSearch() {
  resetSearchFilter();
  renderTree();
  el.searchInput.focus();
}

/* ---------- 弹框 ---------- */

function promptName(options) {
  if (modalResolve) {
    const previous = modalResolve;
    modalResolve = null;
    previous(null);
  }
  return new Promise((resolve) => {
    modalResolve = resolve;
    el.modalTitle.textContent = options.title || '输入';
    el.modalDesc.textContent = options.description || '';
    el.modalInput.value = options.value || '';
    el.modalInput.placeholder = options.placeholder || '';
    el.modalError.textContent = '';
    el.modalOk.textContent = options.okText || '确定';
    el.modal.hidden = false;
    setTimeout(() => {
      el.modalInput.focus();
      el.modalInput.select();
    }, 0);
  });
}

function closeModal(value) {
  el.modal.hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(value);
}

function showToast(message, type = 'info', duration = 4200) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  el.toasts.append(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

function logError(message) {
  try {
    if (bridge && bridge.logError) bridge.logError({ level: 'error', message: String(message) });
  } catch {
    // 日志失败不影响界面。
  }
}

/* ---------- 文件与工作区 ---------- */

async function openRel(relPath, line = null) {
  if (!relPath) return;
  const existing = state.tabs.find((tab) => tab.relPath === relPath);
  if (existing) {
    activateTab(existing.id, { line });
    return;
  }
  try {
    const doc = await bridge.readFile({ relPath });
    openDoc(doc, { line, focus: true });
    state.selectedDir = dirname(relPath);
    ensureExpanded(relPath);
    renderTree();
    await refreshRecent();
  } catch (error) {
    showToast(`打开文件失败：${error.message}`, 'error');
  }
}

async function openWorkspaceDialog() {
  try {
    const result = await bridge.chooseFolder();
    if (!result) return;
    state.recent = result.recent || state.recent;
    renderRecent();
    applyWorkspace(result.workspace);
    showToast(`已打开 ${result.workspace.name}`, 'success');
  } catch (error) {
    showToast(`打开文件夹失败：${error.message}`, 'error');
  }
}

async function openFileDialog() {
  try {
    const result = await bridge.chooseFile();
    if (!result) return;
    state.recent = result.recent || state.recent;
    renderRecent();
    if (result.workspace) applyWorkspace(result.workspace);
    if (result.file) openDoc(result.file, { focus: true });
  } catch (error) {
    showToast(`打开文件失败：${error.message}`, 'error');
  }
}

async function openRecentItem(item) {
  if (!item || !item.path) return;
  try {
    const result = await bridge.openRecent(item.path);
    state.recent = result.recent || state.recent;
    renderRecent();
    if (result.workspace) applyWorkspace(result.workspace);
    if (result.file) openDoc(result.file, { focus: true });
  } catch (error) {
    showToast(`打开最近项目失败：${error.message}`, 'error');
  }
}

async function newNote(parentRelOverride) {
  if (!state.workspace) {
    await openWorkspaceDialog();
    if (!state.workspace) return;
  }
  const parentRel = parentRelOverride != null ? parentRelOverride : (state.selectedDir || '');
  const name = await promptName({
    title: '新建笔记',
    description: parentRel ? `将创建在「${parentRel}」中` : '将创建在文件夹根目录',
    value: '未命名.md',
    placeholder: '文件名，例如 会议记录.md'
  });
  if (!name) return;
  try {
    const result = await bridge.createEntry({ parentRel, name, type: 'file' });
    applyWorkspace(result.workspace);
    resetSearchFilter();
    state.selectedDir = parentRel;
    ensureExpanded(result.entry.relPath);
    const doc = await bridge.readFile({ relPath: result.entry.relPath });
    if (state.platform === 'win32' && !doc.content) doc.eol = 'crlf';
    openDoc(doc, { focus: true });
    await refreshRecent();
    showToast(`已创建 ${result.entry.name}`, 'success');
  } catch (error) {
    showToast(`新建笔记失败：${error.message}`, 'error');
  }
}

async function newFolder(parentRelOverride) {
  if (!state.workspace) {
    showToast('请先打开一个文件夹', 'warn');
    return;
  }
  const parentRel = parentRelOverride != null ? parentRelOverride : (state.selectedDir || '');
  const name = await promptName({
    title: '新建文件夹',
    description: parentRel ? `将创建在「${parentRel}」中` : '将创建在文件夹根目录',
    value: '',
    placeholder: '文件夹名称'
  });
  if (!name) return;
  try {
    const result = await bridge.createEntry({ parentRel, name, type: 'dir' });
    applyWorkspace(result.workspace);
    resetSearchFilter();
    state.selectedDir = result.entry.relPath;
    state.expanded.add(parentRel);
    state.expanded.add(result.entry.relPath);
    renderTree();
    showToast(`已创建文件夹 ${result.entry.name}`, 'success');
  } catch (error) {
    showToast(`新建文件夹失败：${error.message}`, 'error');
  }
}

function remapTabPaths(oldRel, newRel) {
  for (const tab of state.tabs) {
    if (!tab.relPath) continue;
    if (tab.relPath === oldRel || tab.relPath.startsWith(`${oldRel}/`)) {
      const suffix = tab.relPath.slice(oldRel.length);
      tab.relPath = `${newRel}${suffix}`;
      tab.path = absFromRel(state.workspace ? state.workspace.root : '', tab.relPath);
      tab.name = baseName(tab.relPath);
    }
  }
}

async function renameNode(node) {
  const name = await promptName({
    title: '重命名',
    description: node.relPath,
    value: node.name,
    placeholder: '新名称'
  });
  if (!name || name === node.name) return;
  try {
    const result = await bridge.renameEntry({ relPath: node.relPath, name });
    remapTabPaths(result.oldRelPath, result.newRelPath);
    applyWorkspace(result.workspace);
    resetSearchFilter();
    state.selectedDir = node.type === 'dir' ? result.newRelPath : dirname(result.newRelPath);
    renderTabBar();
    updateTitle();
    updateStatus();
    renderTree();
    showToast('已重命名', 'success');
  } catch (error) {
    showToast(`重命名失败：${error.message}`, 'error');
  }
}

async function deleteNode(node) {
  const isDir = node.type === 'dir';
  const affected = state.tabs.filter((tab) => tab.relPath
    && (tab.relPath === node.relPath || tab.relPath.startsWith(`${node.relPath}/`)));
  const dirtyAffected = affected.filter((tab) => tab.dirty || tab.recovered);
  const answer = await bridge.confirm({
    type: 'warning',
    title: isDir ? '删除文件夹' : '删除文件',
    message: `将「${node.name}」移到回收站？`,
    detail: dirtyAffected.length > 0
      ? `有 ${dirtyAffected.length} 个未保存的标签页将被关闭，未保存内容会丢失。`
      : (isDir ? '文件夹中的所有内容都会移到回收站，可以从回收站恢复。' : '文件会移到回收站，可以从回收站恢复。'),
    buttons: ['取消', '移到回收站'],
    defaultId: 0,
    cancelId: 0
  });
  if (answer.response !== 1) return;
  try {
    const result = await bridge.deleteEntry({ relPath: node.relPath });
    for (const tab of affected) clearRecovery(tab);
    state.tabs = state.tabs.filter((tab) => !affected.includes(tab));
    if (!state.tabs.some((tab) => tab.id === state.activeId)) {
      const next = state.tabs[0] || null;
      state.activeId = next ? next.id : null;
      if (next) loadTabIntoEditor(next);
    }
    applyWorkspace(result.workspace);
    if (!activeTab()) showWelcome();
    renderTabBar();
    updateTitle();
    updateStatus();
    updateBanners();
    renderPreview();
    renderOutline();
    await refreshRecent();
    showToast('已移到回收站', 'success');
  } catch (error) {
    showToast(`删除失败：${error.message}`, 'error');
  }
}

async function revealNode(node) {
  try {
    await bridge.reveal({ relPath: node.relPath });
  } catch (error) {
    showToast(`定位失败：${error.message}`, 'error');
  }
}

async function revealCurrent() {
  const tab = activeTab();
  if (!tab) return;
  try {
    if (tab.relPath) await bridge.reveal({ relPath: tab.relPath });
    else if (tab.path) await bridge.reveal({ path: tab.path });
  } catch (error) {
    showToast(`定位失败：${error.message}`, 'error');
  }
}

async function openLocalLink(href) {
  const baseDir = baseDirForRender(activeTab());
  try {
    const result = await bridge.openLink({ baseDir, href });
    if (result.workspace) applyWorkspace(result.workspace);
    if (result.file) openDoc(result.file, { focus: true });
  } catch (error) {
    showToast(`打开链接失败：${error.message}`, 'error');
  }
}

function applyWorkspace(workspace) {
  if (!workspace) return;
  const previousRoot = state.workspace ? state.workspace.root.toLowerCase() : '';
  const nextRoot = workspace.root.toLowerCase();
  const rootChanged = previousRoot !== nextRoot;
  state.workspace = workspace;
  state.lastRefresh = Date.now();
  if (rootChanged) resetSearchFilter();
  for (const tab of state.tabs) {
    if (!tab.path) continue;
    const rel = relativeToRoot(workspace.root, tab.path);
    tab.relPath = rel == null ? null : (rel || null);
  }
  if (workspace.truncated) {
    showToast('文件夹内容过多，目录只显示了前 5000 项。', 'warn', 6500);
  }
  updateWorkspaceChrome();
  updateWelcome();
  renderTree();
  if (activeTab()) {
    updateTitle();
    updateStatus();
  } else {
    showWelcome();
  }
}

async function refreshWorkspace(silent = false) {
  if (!state.workspace) return;
  try {
    const workspace = await bridge.refreshWorkspace();
    if (!workspace) return;
    applyWorkspace(workspace);
  } catch (error) {
    if (!silent) showToast(`刷新失败：${error.message}`, 'error');
  }
}

/* ---------- 保存为 / 历史 / 冲突 ---------- */

async function saveAs() {
  const tab = activeTab();
  if (!tab || !tab.path) return;
  await saveQueue.catch(() => false);
  try {
    const result = await bridge.saveAs({
      path: tab.path,
      relPath: tab.relPath,
      suggestedName: tab.name,
      content: tab.text,
      eol: tab.eol,
      encoding: tab.encoding
    });
    if (!result) return;
    const oldKey = recoveryKey(tab);
    const duplicate = state.tabs.find((item) => item.id !== tab.id && item.path
      && normalizeSlashes(item.path).toLowerCase() === normalizeSlashes(result.path).toLowerCase());
    if (duplicate) {
      state.tabs = state.tabs.filter((item) => item.id !== duplicate.id);
      clearRecovery(duplicate);
    }
    tab.path = result.path;
    tab.relPath = result.relPath;
    tab.name = result.name;
    tab.eol = result.eol;
    tab.encoding = result.encoding;
    tab.mtimeMs = result.mtimeMs;
    tab.savedText = tab.text;
    tab.dirty = false;
    tab.saving = false;
    tab.conflict = false;
    tab.missing = false;
    tab.recovered = false;
    await bridge.clearRecovery(oldKey).catch(() => {});
    clearRecovery(tab);
    updateTitle();
    updateStatus();
    updateBanners();
    renderTabBar();
    if (result.relPath) {
      state.selectedDir = dirname(result.relPath);
      ensureExpanded(result.relPath);
      await refreshWorkspace(true);
    } else {
      renderTree();
    }
    await refreshRecent();
    showToast(`已另存为 ${result.name}`, 'success');
  } catch (error) {
    showToast(`另存为失败：${error.message}`, 'error');
  }
}

async function openHistory() {
  const tab = activeTab();
  if (!tab || !tab.path) return;
  await loadHistory(tab);
  el.historyModal.hidden = false;
}

async function loadHistory(tab) {
  el.historyDesc.textContent = tab.name;
  el.historyList.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'history-empty';
  loading.textContent = '正在读取快照…';
  el.historyList.append(loading);
  try {
    const items = await bridge.listBackups({ path: tab.path, relPath: tab.relPath });
    el.historyList.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '还没有快照。点击“立即备份”创建一份。';
      el.historyList.append(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'history-item';
      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const name = document.createElement('div');
      name.className = 'history-name';
      name.textContent = new Date(item.time).toLocaleString('zh-CN');
      const sub = document.createElement('div');
      sub.className = 'history-sub';
      sub.textContent = `${(item.size / 1024).toFixed(1)} KB`;
      meta.append(name, sub);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small';
      button.textContent = '载入';
      button.addEventListener('click', () => loadBackupIntoEditor(tab, item.id));
      row.append(meta, button);
      el.historyList.append(row);
    }
  } catch (error) {
    el.historyList.replaceChildren();
    const message = document.createElement('div');
    message.className = 'history-empty';
    message.textContent = `读取快照失败：${error.message}`;
    el.historyList.append(message);
  }
}

async function createBackupNow() {
  const tab = activeTab();
  if (!tab || !tab.path) return;
  try {
    await bridge.createBackup({ path: tab.path, relPath: tab.relPath });
    await loadHistory(tab);
    showToast('已创建快照', 'success');
  } catch (error) {
    showToast(`创建快照失败：${error.message}`, 'error');
  }
}

async function loadBackupIntoEditor(tab, id) {
  try {
    const backup = await bridge.readBackup({ path: tab.path, relPath: tab.relPath, id });
    const answer = await bridge.confirm({
      type: 'warning',
      title: '载入快照',
      message: '用快照内容替换当前编辑内容？',
      detail: '当前内容会变为未保存状态，保存后才会覆盖磁盘文件。',
      buttons: ['取消', '载入'],
      defaultId: 0,
      cancelId: 0
    });
    if (answer.response !== 1) return;
    tab.text = backup.content;
    tab.eol = backup.eol;
    tab.encoding = backup.encoding;
    tab.dirty = true;
    if (tab.id === state.activeId) loadTabIntoEditor(tab);
    el.historyModal.hidden = true;
    renderTabBar();
    updateTitle();
    updateStatus();
    updateBanners();
    schedulePreview();
    scheduleRecovery();
    showToast('已载入快照内容', 'success');
  } catch (error) {
    showToast(`载入快照失败：${error.message}`, 'error');
  }
}

async function overwriteConflict() {
  const tab = activeTab();
  if (!tab) return;
  const ok = await requestSave(tab, { force: true });
  if (!ok) showToast('覆盖保存失败，请检查文件权限。', 'error');
}

async function reloadConflict() {
  const tab = activeTab();
  if (!tab) return;
  const answer = await bridge.confirm({
    type: 'warning',
    title: '重新加载',
    message: '重新加载会丢弃当前未保存的编辑内容。',
    detail: '磁盘上的文件已被其他程序修改。',
    buttons: ['取消', '重新加载'],
    defaultId: 0,
    cancelId: 0
  });
  if (answer.response !== 1) return;
  try {
    const doc = await bridge.readFile(tab.relPath ? { relPath: tab.relPath } : { path: tab.path });
    tab.text = doc.content;
    tab.savedText = doc.content;
    tab.eol = doc.eol;
    tab.encoding = doc.encoding;
    tab.mtimeMs = doc.mtimeMs;
    tab.dirty = false;
    tab.conflict = false;
    tab.missing = false;
    tab.recovered = false;
    clearRecovery(tab);
    if (tab.id === state.activeId) loadTabIntoEditor(tab);
    renderTabBar();
    updateTitle();
    updateStatus();
    updateBanners();
    schedulePreview();
    showToast('已重新加载磁盘上的文件', 'success');
  } catch (error) {
    showToast(`重新加载失败：${error.message}`, 'error');
  }
}

async function discardMissing() {
  const tab = activeTab();
  if (!tab) return;
  const answer = await bridge.confirm({
    type: 'warning',
    title: '放弃更改',
    message: `「${tab.name}」的未保存内容将被丢弃`,
    detail: '原文件已不存在，无法写回。',
    buttons: ['取消', '放弃并关闭'],
    defaultId: 0,
    cancelId: 0
  });
  if (answer.response !== 1) return;
  await closeTab(tab.id, { force: true });
}

/* ---------- 设置 ---------- */

function applySettings(next) {
  state.settings = { ...DEFAULT_SETTINGS, ...(next || {}) };
  if (!Array.isArray(state.settings.ignoreDirs)) state.settings.ignoreDirs = [];
  applyTheme();
  applyLayout();
  syncButtons();
  renderPreview();
  renderOutline();
  updateStatus();
}

function applyTheme() {
  const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  el.btnTheme.title = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  el.btnTheme.textContent = theme === 'dark' ? '☀' : '◐';
}

async function updateSettings(patch) {
  try {
    const next = await bridge.updateSettings(patch);
    applySettings(next);
    return next;
  } catch (error) {
    showToast(`保存设置失败：${error.message}`, 'error');
    return null;
  }
}

function openSettings() {
  el.settingsModal.hidden = false;
  const settings = state.settings;
  $('setTheme').value = settings.theme;
  $('setFontSize').value = String(settings.fontSize);
  $('setLineWidth').value = String(settings.lineWidth);
  $('setAutosaveDelay').value = String(settings.autosaveDelay);
  $('setWordGoal').value = String(settings.wordGoal);
  $('setAutosave').checked = settings.autosave;
  $('setPreview').checked = settings.preview;
  $('setSidebar').checked = settings.sidebar;
  $('setOutline').checked = settings.outline;
  $('setRemoteImages').checked = settings.remoteImages;
  $('setSyntaxHighlight').checked = settings.syntaxHighlight;
  $('setReadingTime').checked = settings.showReadingTime;
  $('setIgnoreDirs').value = (settings.ignoreDirs || []).join(', ');
}

async function saveSettingsForm() {
  const ignoreDirs = $('setIgnoreDirs').value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  const previousIgnore = (state.settings.ignoreDirs || []).join('\u0000');
  const next = await updateSettings({
    theme: $('setTheme').value,
    fontSize: Number($('setFontSize').value),
    lineWidth: Number($('setLineWidth').value),
    autosaveDelay: Number($('setAutosaveDelay').value),
    wordGoal: Number($('setWordGoal').value),
    autosave: $('setAutosave').checked,
    preview: $('setPreview').checked,
    sidebar: $('setSidebar').checked,
    outline: $('setOutline').checked,
    remoteImages: $('setRemoteImages').checked,
    syntaxHighlight: $('setSyntaxHighlight').checked,
    showReadingTime: $('setReadingTime').checked,
    ignoreDirs
  });
  if (next) {
    el.settingsModal.hidden = true;
    if ((next.ignoreDirs || []).join('\u0000') !== previousIgnore) await refreshWorkspace(true);
    showToast('设置已保存', 'success');
  }
}

function toggleSidebar() {
  updateSettings({ sidebar: !state.settings.sidebar });
}

function togglePreview() {
  if (!activeTab()) return;
  updateSettings({ preview: !state.settings.preview });
}

function toggleOutline() {
  updateSettings({ outline: !state.settings.outline });
}

function toggleTheme() {
  updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' });
}

/* ---------- 菜单动作 ---------- */

function focusSearch() {
  if (!state.workspace) {
    showToast('请先打开一个文件夹', 'warn');
    return;
  }
  if (!state.settings.sidebar) toggleSidebar();
  el.searchInput.focus();
  el.searchInput.select();
}

async function printDocument() {
  if (!activeTab()) {
    showToast('没有可打印的文档', 'warn');
    return;
  }
  renderPreview();
  try {
    await bridge.print();
  } catch (error) {
    showToast(`打印失败：${error.message}`, 'error');
  }
}

async function handleMenuAction(action) {
  switch (action) {
    case 'new-note': await newNote(); break;
    case 'open-file': await openFileDialog(); break;
    case 'open-folder': await openWorkspaceDialog(); break;
    case 'save': await requestSave(); break;
    case 'save-as': await saveAs(); break;
    case 'close-tab': if (activeTab()) await closeTab(state.activeId); break;
    case 'settings': openSettings(); break;
    case 'find': openFind(); break;
    case 'toggle-sidebar': toggleSidebar(); break;
    case 'toggle-preview': togglePreview(); break;
    case 'toggle-outline': toggleOutline(); break;
    case 'focus-search': focusSearch(); break;
    case 'print': await printDocument(); break;
    default: break;
  }
}

async function handleOpenPayload(payload) {
  if (!payload) return;
  if (payload.recent) {
    state.recent = payload.recent;
    renderRecent();
  }
  if (payload.workspace) applyWorkspace(payload.workspace);
  if (payload.file) openDoc(payload.file, { focus: true });
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  el.btnNewNote.addEventListener('click', () => newNote());
  el.btnOpenFolder.addEventListener('click', openWorkspaceDialog);
  el.btnOpenFolderSidebar.addEventListener('click', openWorkspaceDialog);
  el.welcomeOpenFolder.addEventListener('click', openWorkspaceDialog);
  el.welcomeOpenFile.addEventListener('click', openFileDialog);
  el.welcomeNewNote.addEventListener('click', () => newNote());
  el.btnClearRecent.addEventListener('click', clearRecentList);
  el.btnNewFolder.addEventListener('click', () => newFolder());
  el.btnRefresh.addEventListener('click', () => refreshWorkspace(false));
  el.btnSave.addEventListener('click', () => requestSave());
  el.btnSaveAs.addEventListener('click', saveAs);
  el.btnReveal.addEventListener('click', revealCurrent);
  el.btnHistory.addEventListener('click', openHistory);
  el.btnToggleSidebar.addEventListener('click', toggleSidebar);
  el.btnTogglePreview.addEventListener('click', togglePreview);
  el.btnTheme.addEventListener('click', toggleTheme);
  el.btnSettings.addEventListener('click', openSettings);
  el.btnOverwrite.addEventListener('click', overwriteConflict);
  el.btnReload.addEventListener('click', reloadConflict);
  el.btnMissingSaveAs.addEventListener('click', saveAs);
  el.btnMissingDiscard.addEventListener('click', discardMissing);
  el.btnRecoveredSave.addEventListener('click', () => requestSave(activeTab()));
  el.btnRecoveredSaveAs.addEventListener('click', saveAs);
  el.btnRecoveredDiscard.addEventListener('click', () => {
    const tab = activeTab();
    if (tab) closeTab(tab.id, { force: true });
  });
  el.btnFind.addEventListener('click', openFind);

  el.previewPane.addEventListener('scroll', () => {
    if (!state.settings.preview || !cm) return;
    syncPreviewToEditor();
  });

  el.preview.addEventListener('click', async (event) => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const local = anchor.getAttribute('data-local-href');
    if (local) {
      event.preventDefault();
      await openLocalLink(local);
      return;
    }
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    if (/^(https?:|mailto:)/i.test(href)) {
      event.preventDefault();
      try {
        await bridge.openExternal(href);
      } catch (error) {
        showToast(`打开链接失败：${error.message}`, 'error');
      }
      return;
    }
    event.preventDefault();
  });

  el.searchInput.addEventListener('input', () => {
    state.searchToken += 1;
    el.btnClearSearch.hidden = !el.searchInput.value;
    hideSearchResults();
    renderTree();
  });
  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    } else if (event.key === 'Escape') {
      clearSearch();
    }
  });
  el.btnClearSearch.addEventListener('click', clearSearch);

  el.findInput.addEventListener('input', () => runFind(false));
  el.findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      findNext(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    }
  });
  el.replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrent();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    }
  });
  $('findPrev').addEventListener('click', () => findNext(-1));
  $('findNext').addEventListener('click', () => findNext(1));
  $('findClose').addEventListener('click', closeFind);
  el.findCase.addEventListener('click', () => {
    state.find.caseSensitive = !state.find.caseSensitive;
    el.findCase.classList.toggle('active', state.find.caseSensitive);
    runFind(true);
  });
  el.findRegex.addEventListener('click', () => {
    state.find.regex = !state.find.regex;
    el.findRegex.classList.toggle('active', state.find.regex);
    runFind(true);
  });
  $('replaceOne').addEventListener('click', replaceCurrent);
  $('replaceAll').addEventListener('click', replaceAllMatches);

  el.toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  el.toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-format]');
    if (!button) return;
    const format = button.dataset.format;
    if (format === 'image') insertImageFromPicker();
    else applyFormat(format);
  });

  el.splitter.addEventListener('pointerdown', (event) => {
    if (!state.settings.preview) return;
    event.preventDefault();
    gridDrag = el.split.getBoundingClientRect();
    el.splitter.classList.add('dragging');
    document.body.classList.add('dragging-split');
    el.splitter.setPointerCapture(event.pointerId);
  });
  el.splitter.addEventListener('pointermove', (event) => {
    if (!gridDrag) return;
    const ratio = (event.clientX - gridDrag.left) / gridDrag.width;
    state.settings.split = clamp(ratio, 0.25, 0.78);
    el.split.style.setProperty('--split-pct', `${Math.round(state.settings.split * 100)}%`);
  });
  const finishDrag = () => {
    if (!gridDrag) return;
    gridDrag = null;
    el.splitter.classList.remove('dragging');
    document.body.classList.remove('dragging-split');
    updateSettings({ split: state.settings.split });
  };
  el.splitter.addEventListener('pointerup', finishDrag);
  el.splitter.addEventListener('pointercancel', finishDrag);

  el.modalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = el.modalInput.value.trim();
    if (!value) {
      el.modalError.textContent = '内容不能为空';
      return;
    }
    closeModal(value);
  });
  el.modalCancel.addEventListener('click', () => closeModal(null));
  el.modal.addEventListener('mousedown', (event) => {
    if (event.target === el.modal) closeModal(null);
  });

  el.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsForm();
  });
  $('settingsCancel').addEventListener('click', () => { el.settingsModal.hidden = true; });
  $('settingsLogs').addEventListener('click', () => bridge.openLogs().catch(() => {}));
  $('settingsCopyLog').addEventListener('click', () => bridge.copyLogPath().then(() => showToast('日志路径已复制', 'success')).catch(() => {}));
  $('settingsClearLog').addEventListener('click', () => bridge.clearLogs().then((ok) => { if (ok) showToast('日志已清空', 'success'); }).catch(() => {}));
  $('historyClose').addEventListener('click', () => { el.historyModal.hidden = true; });
  $('historyCreate').addEventListener('click', createBackupNow);
  $('recoveryRestore').addEventListener('click', restoreRecovery);
  $('recoveryDiscard').addEventListener('click', discardRecovery);

  document.addEventListener('click', (event) => {
    if (!el.contextMenu.hidden && !el.contextMenu.contains(event.target)) hideContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!el.modal.hidden) {
        closeModal(null);
        return;
      }
      if (!el.contextMenu.hidden) {
        hideContextMenu();
        return;
      }
      if (!el.historyModal.hidden) {
        el.historyModal.hidden = true;
        return;
      }
      if (!el.settingsModal.hidden) {
        el.settingsModal.hidden = true;
        return;
      }
      if (state.find.open) {
        closeFind();
        return;
      }
      if (!el.searchResults.hidden) clearSearch();
    }
  });

  window.addEventListener('resize', () => {
    if (cm) cm.refresh();
  });
  window.addEventListener('focus', () => {
    if (!state.workspace) return;
    if (Date.now() - state.lastRefresh < 1500) return;
    refreshWorkspace(true);
  });
  window.addEventListener('error', (event) => {
    logError(`界面异常：${event.message} @ ${event.filename}:${event.lineno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason && event.reason.stack ? event.reason.stack : event.reason;
    logError(`未处理的 Promise 拒绝：${reason}`);
  });
}

function applyFormat(name) {
  switch (name) {
    case 'bold': wrapSelection('**', '**', '粗体'); break;
    case 'italic': wrapSelection('_', '_', '斜体'); break;
    case 'strike': wrapSelection('~~', '~~', '删除线'); break;
    case 'heading': toggleHeading(); break;
    case 'quote': toggleLinePrefix('> ', /^>\s?/); break;
    case 'ul': toggleLinePrefix('- ', /^[-*+]\s+/); break;
    case 'ol': toggleLinePrefix('1. ', /^\d+\.\s+/); break;
    case 'code': formatCode(); break;
    case 'link': insertLink(); break;
    case 'table': insertTable(); break;
    default: break;
  }
}

/* ---------- 初始化 ---------- */

function createEditor() {
  cm = window.CodeMirror(el.editor, {
    value: '',
    mode: 'gfm',
    lineNumbers: true,
    lineWrapping: true,
    styleActiveLine: true,
    tabSize: 2,
    indentUnit: 2,
    viewportMargin: 30,
    placeholder: '开始写作…',
    extraKeys: {
      Enter: handleEnterKey,
      Tab: handleTabKey,
      'Shift-Tab': handleShiftTabKey,
      'Ctrl-B': () => applyFormat('bold'),
      'Ctrl-I': () => applyFormat('italic'),
      'Ctrl-K': () => insertLink(),
      'Ctrl-S': () => requestSave(),
      Escape: () => {
        if (state.find.open) closeFind();
      }
    }
  });
  cm.on('change', onEditorChange);
  cm.on('cursorActivity', onCursorActivity);
  cm.on('scroll', onEditorScroll);
  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener('paste', handlePaste);
  wrapper.addEventListener('dragover', (event) => {
    if (clipboardImages(event.dataTransfer).length > 0) event.preventDefault();
  });
  wrapper.addEventListener('drop', handleDrop);
  wrapper.addEventListener('contextmenu', onEditorContextMenu);
}

async function init() {
  setupMarked();
  bindEvents();
  applySettings(DEFAULT_SETTINGS);
  if (window.CodeMirror) createEditor();
  showWelcome();
  renderTabBar();
  updateStatus();
  window.__flushSave = flushSave;

  if (!bridge) {
    el.welcomeDesc.textContent = '内部错误：无法连接主进程。请重新启动应用。';
    document.body.dataset.ready = '1';
    return;
  }

  bridge.onOpen((payload) => {
    handleOpenPayload(payload).catch((error) => showToast(`打开失败：${error.message}`, 'error'));
  });
  bridge.onMenu((action) => {
    handleMenuAction(action).catch((error) => showToast(`操作失败：${error.message}`, 'error'));
  });

  try {
    const boot = await bridge.bootstrap();
    state.platform = boot.platform || 'win32';
    state.testMode = Boolean(boot.testMode);
    state.recent = boot.recent || [];
    applySettings(boot.settings || DEFAULT_SETTINGS);
    if (boot.workspace) applyWorkspace(boot.workspace);
    if (boot.file) openDoc(boot.file, { focus: false });
    else showWelcome();
    renderRecent();
    updateWorkspaceChrome();
    updateStatus();
    if (Array.isArray(boot.recovery) && boot.recovery.length > 0) showRecoveryModal(boot.recovery);
    if (state.testMode) {
      window.__mdTest = {
        getState: () => ({
          workspaceRoot: state.workspace ? state.workspace.root : null,
          settings: { ...state.settings },
          recent: state.recent.map((item) => ({ ...item })),
          activeId: state.activeId,
          tabs: state.tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
            path: tab.path,
            relPath: tab.relPath,
            dirty: tab.dirty,
            recovered: tab.recovered,
            missing: tab.missing,
            conflict: tab.conflict
          }))
        }),
        getText: () => (cm ? cm.getValue() : ''),
        setText: (text) => { if (cm) cm.setValue(text); },
        setSelection: (from, to) => {
          if (!cm) return;
          cm.setSelection(cm.posFromIndex(from), cm.posFromIndex(to));
        },
        getCursor: () => (cm ? cm.getCursor() : null),
        openRel,
        refreshWorkspace,
        scrollEditorTo: (top) => {
          if (!cm) return;
          cm.scrollTo(null, top);
          syncEditorToPreview(cm.getScrollInfo());
        },
        scrollPreviewTo: (top) => {
          el.previewPane.scrollTop = top;
          syncPreviewToEditor();
        },
        renderPreview,
        renderOutline,
        runFind,
        openFind,
        closeFind,
        listContinuation: (pos) => T.listContinuation(cm ? cm.getValue() : '', pos),
        nextTableCell: (pos, direction) => T.nextTableCell(cm ? cm.getValue() : '', pos, direction),
        findMatches: (query, options) => T.findMatches(cm ? cm.getValue() : '', query, options)
      };
    }
  } catch (error) {
    showToast(`启动失败：${error.message}`, 'error');
    logError(`启动失败：${error.stack || error}`);
    showWelcome();
  }
  document.body.dataset.ready = '1';
}

init();
