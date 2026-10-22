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

const el = {
  app: $('app'),
  btnHome: $('btnHome'),
  topCrumb: $('topCrumb'),
  searchInput: $('searchInput'),
  btnClearSearch: $('btnClearSearch'),
  wsName: $('wsName'),
  wsPath: $('wsPath'),
  libraryList: $('libraryList'),
  libraryCards: $('libraryCards'),
  tree: $('tree'),
  sidebarEmpty: $('sidebarEmpty'),
  sidebarEmptyText: $('sidebarEmptyText'),
  sidebarFoot: $('sidebarFoot'),
  outlinePanel: $('outlinePanel'),
  outlineList: $('outlineList'),
  outlineCount: $('outlineCount'),
  searchResults: $('searchResults'),
  searchSummary: $('searchSummary'),
  btnSearchClose: $('btnSearchClose'),
  homeView: $('homeView'),
  libraryView: $('libraryView'),
  searchView: $('searchView'),
  welcomeTitle: $('welcomeTitle'),
  welcomeDesc: $('welcomeDesc'),
  welcomeOpenFolder: $('welcomeOpenFolder'),
  welcomeOpenFile: $('welcomeOpenFile'),
  welcomeNewNote: $('welcomeNewNote'),
  recentWrap: $('recentWrap'),
  recentList: $('recentList'),
  recentEmpty: $('recentEmpty'),
  btnClearRecent: $('btnClearRecent'),
  starredWrap: $('starredWrap'),
  starredList: $('starredList'),
  starredEmpty: $('starredEmpty'),
  btnAddLibraryCard: $('btnAddLibraryCard'),
  libTitle: $('libTitle'),
  libPath: $('libPath'),
  libSort: $('libSort'),
  libTruncated: $('libTruncated'),
  tagFilter: $('tagFilter'),
  libLoading: $('libLoading'),
  libEmpty: $('libEmpty'),
  docList: $('docList'),
  btnLibNewNote: $('btnLibNewNote'),
  btnLibRefresh: $('btnLibRefresh'),
  editorWrap: $('editorWrap'),
  editor: $('editor'),
  tabbar: $('tabbar'),
  preview: $('preview'),
  previewPane: $('previewPane'),
  split: $('split'),
  splitter: $('splitter'),
  docTitle: $('docTitle'),
  docPath: $('docPath'),
  viewSwitch: $('viewSwitch'),
  btnStar: $('btnStar'),
  docRail: $('docRail'),
  docTagsBlock: $('docTagsBlock'),
  docTags: $('docTags'),
  backlinksBlock: $('backlinksBlock'),
  backlinkCount: $('backlinkCount'),
  backlinkList: $('backlinkList'),
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
  btnNewNoteSidebar: $('btnNewNoteSidebar'),
  btnAddLibrary: $('btnAddLibrary'),
  btnSave: $('btnSave'),
  btnSaveAs: $('btnSaveAs'),
  btnReveal: $('btnReveal'),
  btnHistory: $('btnHistory'),
  btnNewFolder: $('btnNewFolder'),
  btnRefresh: $('btnRefresh'),
  btnOpenFolderSidebar: $('btnOpenFolderSidebar'),
  btnToggleSidebar: $('btnToggleSidebar'),
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
  libraries: [],
  workspace: null,
  view: 'home',
  viewBeforeSearch: 'home',
  tabs: [],
  activeId: null,
  nextTabId: 1,
  recent: [],
  starred: [],
  catalog: { documents: [], tags: [], truncated: false },
  catalogLoading: false,
  tagFilter: null,
  backlinks: [],
  backlinksKey: '',
  selectedDir: '',
  expanded: new Set(),
  searchToken: 0,
  searchData: null,
  find: { open: false, query: '', replacement: '', caseSensitive: false, regex: false, ranges: [], index: -1, marks: [] },
  outline: [],
  lastRefresh: 0,
  platform: 'win32',
  testMode: false,
  recoveryEntries: [],
  contextToken: 0,
  catalogToken: 0,
  backlinkToken: 0,
  homeToken: 0
};

let cm = null;
let renderer = null;
let markedReady = false;
let previewTimer = null;
let autosaveTimer = null;
let recoveryTimer = null;
let catalogTimer = null;
let backlinkTimer = null;
let saveQueue = Promise.resolve();
let modalResolve = null;
let modalReturnFocus = null;
let settingsReturnFocus = null;
let historyReturnFocus = null;
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

function samePath(a, b) {
  if (!a || !b) return false;
  return normalizeSlashes(a).replace(/\/+$/, '').toLowerCase() === normalizeSlashes(b).replace(/\/+$/, '').toLowerCase();
}

function libraryForPath(absPath) {
  if (!absPath) return null;
  return state.libraries.find((lib) => isPathInside(lib.path, absPath)) || null;
}

function libraryName(root) {
  if (!root) return '';
  const lib = state.libraries.find((item) => samePath(item.path, root));
  return lib ? lib.name : '';
}

function stemName(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

function formatTime(ms) {
  const time = Number(ms);
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function docPayload(tab) {
  if (!tab) return {};
  if (tab.libraryRoot && tab.relPath) return { library: tab.libraryRoot, relPath: tab.relPath };
  return { path: tab.path };
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
  if (typeof window.marked.use === 'function') {
    window.marked.use({
      extensions: [{
        name: 'wikilink',
        level: 'inline',
        start(src) {
          return src.indexOf('[[');
        },
        tokenizer(src) {
          const match = /^\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]*?))?\]\]/.exec(src);
          if (!match) return undefined;
          const target = match[1].trim();
          if (!target) return undefined;
          return {
            type: 'wikilink',
            raw: match[0],
            target,
            label: (match[2] || match[1]).trim()
          };
        },
        renderer(token) {
          return `<a href="#" class="wiki-link" data-wiki-target="${escapeHtml(token.target)}">${escapeHtml(token.label)}</a>`;
        }
      }]
    });
  }
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
    el.preview.innerHTML = window.marked.parse(T.stripFrontmatter(tab.text), {
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
    renderDocTags();
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
  const library = tab ? libraryName(tab.libraryRoot) : '';
  el.statusFile.textContent = tab ? (library && tab.relPath ? `${library} / ${tab.relPath}` : (tab.relPath || tab.path || '')) : '';
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
  const marker = tab && (tab.dirty || tab.recovered) ? '● ' : '';
  let title = tab ? tab.name : '';
  if (tab) {
    const fallback = stemName(tab.name);
    title = tab.text.length > 300000 ? fallback : T.documentTitle(tab.text, fallback);
    if (!title) title = fallback;
  }
  el.docTitle.textContent = tab ? `${marker}${title}` : '';
  if (tab) {
    const library = libraryName(tab.libraryRoot);
    el.docPath.textContent = library && tab.relPath ? `${library} / ${tab.relPath}` : (tab.relPath || tab.path || '');
  } else {
    el.docPath.textContent = '';
  }
  const workspaceName = state.workspace ? (libraryName(state.workspace.root) || state.workspace.name) : '';
  el.topCrumb.textContent = tab
    ? (libraryName(tab.libraryRoot) || workspaceName || '工作台')
    : (workspaceName || '工作台');
  document.title = tab ? `${marker}${title} — Markdown 笔记` : (workspaceName ? `${workspaceName} — Markdown 笔记` : 'Markdown 笔记');
}

function updateBanners() {
  const tab = activeTab();
  el.conflict.hidden = !(tab && tab.conflict);
  el.missing.hidden = !(tab && tab.missing && !tab.conflict);
  el.recoveredBanner.hidden = !(tab && tab.recovered && !tab.conflict && !tab.missing);
}

function syncButtons() {
  const tab = activeTab();
  el.btnNewNote.disabled = false;
  el.btnNewNoteSidebar.disabled = !state.workspace;
  el.btnNewFolder.disabled = !state.workspace;
  el.btnRefresh.disabled = !state.workspace;
  el.btnLibNewNote.disabled = !state.workspace;
  el.btnLibRefresh.disabled = !state.workspace;
  el.btnSave.disabled = !tab;
  el.btnSaveAs.disabled = !tab;
  el.btnReveal.disabled = !tab;
  el.btnHistory.disabled = !tab || !tab.path;
  el.btnStar.disabled = !tab || !tab.libraryRoot;
  el.searchInput.disabled = state.libraries.length === 0;
  el.btnToggleSidebar.classList.toggle('active', state.settings.sidebar);
  const mode = state.settings.viewMode;
  el.viewSwitch.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.disabled = !tab;
  });
}

function updateWorkspaceChrome() {
  let displayName = '';
  if (state.workspace) {
    displayName = libraryName(state.workspace.root) || state.workspace.name;
    el.wsName.textContent = displayName;
    el.wsPath.textContent = state.workspace.root;
    el.tree.hidden = false;
    el.sidebarEmpty.hidden = true;
    el.sidebarFoot.hidden = false;
    el.searchInput.placeholder = '筛选目录，回车搜索全部知识库';
  } else {
    el.wsName.textContent = '未选择知识库';
    el.wsPath.textContent = '选择一个本地文件夹作为知识库';
    el.tree.hidden = true;
    el.sidebarEmpty.hidden = false;
    el.sidebarEmptyText.textContent = state.libraries.length > 0 ? '选择一个知识库' : '还没有知识库';
    el.sidebarFoot.hidden = state.libraries.length === 0;
    el.searchInput.placeholder = '添加知识库后可搜索';
    hideSearchResults();
  }
  el.topCrumb.textContent = state.workspace ? (displayName || state.workspace.name) : '工作台';
  applyLayout();
  syncButtons();
}

function applyLayout() {
  const mode = state.settings.viewMode;
  el.app.classList.toggle('sidebar-hidden', !state.settings.sidebar);
  el.editorWrap.classList.toggle('mode-editor', mode === 'editor');
  el.editorWrap.classList.toggle('mode-reading', mode === 'reading');
  el.editorWrap.classList.toggle('rail-hidden', !state.settings.outline);
  el.split.style.setProperty('--split-pct', `${Math.round(state.settings.split * 100)}%`);
  document.documentElement.style.setProperty('--editor-font-size', `${state.settings.fontSize}px`);
  document.documentElement.style.setProperty('--editor-max-width', state.settings.lineWidth > 0 ? `${state.settings.lineWidth}px` : 'none');
  el.viewSwitch.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  if (cm) requestAnimationFrame(() => cm.refresh());
}

function setView(view) {
  state.view = view;
  el.homeView.hidden = view !== 'home';
  el.libraryView.hidden = view !== 'library';
  el.searchView.hidden = view !== 'search';
  el.editorWrap.hidden = view !== 'doc';
  if (view === 'doc' && cm) requestAnimationFrame(() => cm.refresh());
  if (view === 'home') refreshHome();
  if (view === 'library') renderLibraryView();
}

function showEditor() {
  setView('doc');
}

function showWelcome() {
  setView(state.workspace ? 'library' : 'home');
}

function showHome() {
  setView('home');
}

function updateHomeHero() {
  const hasWorkspace = Boolean(state.workspace);
  el.welcomeTitle.textContent = state.libraries.length > 0 ? '本地知识库' : '开始建立你的知识库';
  el.welcomeDesc.textContent = hasWorkspace
    ? `当前知识库「${libraryName(state.workspace.root) || state.workspace.name}」，共 ${state.workspace.fileCount} 篇 Markdown 文档。`
    : '添加本地文件夹作为知识库，文档始终以 Markdown 保存在磁盘上。';
  el.welcomeOpenFolder.textContent = '添加知识库';
  el.welcomeNewNote.disabled = false;
}

function recentSubtitle(item) {
  const lib = libraryForPath(item.path);
  if (!lib) return item.path;
  const rel = relativeToRoot(lib.path, item.path);
  return rel ? `${lib.name} / ${rel}` : lib.name;
}

function renderRecent() {
  el.recentList.replaceChildren();
  const items = state.recent.slice(0, 10);
  el.recentWrap.hidden = items.length === 0;
  el.recentEmpty.hidden = items.length > 0;
  for (const item of items) {
    const button = document.createElement('div');
    button.className = 'recent-item';
    button.title = item.path;
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    const main = document.createElement('span');
    main.className = 'recent-main';
    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = stemName(item.name || baseName(item.path));
    const path = document.createElement('div');
    path.className = 'recent-path';
    path.textContent = recentSubtitle(item);
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
    button.append(main, remove);
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

function renderStarred() {
  el.starredList.replaceChildren();
  const items = state.starred.slice();
  el.starredWrap.hidden = items.length === 0;
  el.starredEmpty.hidden = items.length > 0;
  for (const star of items) {
    const row = document.createElement('div');
    row.className = 'recent-item';
    row.title = star.library && star.relPath ? `${star.library} / ${star.relPath}` : star.name;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const main = document.createElement('span');
    main.className = 'recent-main';
    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = stemName(star.name || baseName(star.relPath));
    const path = document.createElement('div');
    path.className = 'recent-path';
    path.textContent = `${star.libraryName || libraryName(star.library)}${star.relPath ? ` / ${star.relPath}` : ''}`;
    main.append(name, path);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'star-toggle';
    remove.textContent = '★';
    remove.title = '取消收藏';
    remove.setAttribute('aria-label', `取消收藏 ${star.name || star.relPath}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleStar(star.library, star.relPath);
    });
    row.append(main, remove);
    const open = async () => {
      if (!(await ensureLibraryContext(star.library))) return;
      await openRel(star.relPath, null, { library: star.library });
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    el.starredList.append(row);
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

const MAX_RENDERED_DOCS = 500;

function libraryInitial(lib) {
  const name = String((lib && lib.name) || '知').trim();
  return name ? name.charAt(0) : '知';
}

function renderLibraries() {
  el.libraryList.replaceChildren();
  if (state.libraries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = '还没有知识库';
    el.libraryList.append(empty);
  }
  for (const lib of state.libraries) {
    const active = Boolean(state.workspace && samePath(state.workspace.root, lib.path));
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'library-row';
    row.dataset.path = lib.path;
    row.classList.toggle('active', active);
    row.classList.toggle('missing', lib.exists === false);
    row.title = lib.exists === false ? `${lib.path}（路径不可用）` : lib.path;
    const icon = document.createElement('span');
    icon.className = 'library-icon';
    icon.textContent = libraryInitial(lib);
    const name = document.createElement('span');
    name.className = 'library-name';
    name.textContent = lib.name || baseName(lib.path);
    row.append(icon, name);
    row.addEventListener('click', () => switchLibrary(lib.path));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showLibraryMenu(event, lib);
    });
    el.libraryList.append(row);
  }
  renderLibraryCards();
}

function renderLibraryCards() {
  el.libraryCards.replaceChildren();
  for (const lib of state.libraries) {
    const active = Boolean(state.workspace && samePath(state.workspace.root, lib.path));
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'lib-card';
    card.dataset.path = lib.path;
    card.classList.toggle('active', active);
    card.classList.toggle('missing', lib.exists === false);
    card.title = lib.path;
    const icon = document.createElement('span');
    icon.className = 'lib-card-icon';
    icon.textContent = libraryInitial(lib);
    const name = document.createElement('span');
    name.className = 'lib-card-name';
    name.textContent = lib.name || baseName(lib.path);
    const path = document.createElement('span');
    path.className = 'lib-card-path';
    path.textContent = lib.exists === false ? '路径不可用' : lib.path;
    const meta = document.createElement('span');
    meta.className = 'lib-card-meta';
    meta.textContent = lib.exists === false
      ? '路径不可用'
      : (lib.lastOpenedAt ? `${lib.docCount || 0} 篇文档` : '尚未打开');
    card.append(icon, name, path, meta);
    card.addEventListener('click', () => switchLibrary(lib.path));
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showLibraryMenu(event, lib);
    });
    el.libraryCards.append(card);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'lib-card add';
  add.textContent = '＋ 添加知识库';
  add.addEventListener('click', addLibraryDialog);
  el.libraryCards.append(add);
}

function showLibraryMenu(event, lib) {
  showMenuAt(event, [
    { label: '打开', action: () => switchLibrary(lib.path) },
    { label: '重命名…', action: () => renameLibrary(lib) },
    {
      label: '在资源管理器中显示',
      action: () => bridge.reveal({ path: lib.path }).catch((error) => {
        showToast(`定位失败：${error.message}`, 'error');
      })
    },
    { label: '从列表移除…', danger: true, action: () => removeLibrary(lib) }
  ]);
}

function renderHome() {
  updateHomeHero();
  renderLibraries();
  renderRecent();
  renderStarred();
}

async function refreshHome() {
  if (!bridge) return;
  const token = ++state.homeToken;
  try {
    const data = await bridge.getHome();
    if (token !== state.homeToken) return;
    state.libraries = Array.isArray(data.libraries) ? data.libraries : state.libraries;
    state.recent = Array.isArray(data.recent) ? data.recent : state.recent;
    state.starred = Array.isArray(data.starred) ? data.starred : state.starred;
    renderHome();
  } catch (error) {
    logError(`刷新工作台失败：${error.stack || error}`);
  }
}

async function addLibraryDialog() {
  try {
    const result = await bridge.addLibrary();
    if (!result) return;
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    if (result.workspace) applyWorkspace(result.workspace);
    setView('library');
    scheduleCatalogRefresh(true);
    await refreshHome();
    showToast('已添加知识库', 'success');
  } catch (error) {
    showToast(`添加知识库失败：${error.message}`, 'error');
  }
}

async function switchLibrary(libraryPath) {
  const known = state.libraries.find((lib) => samePath(lib.path, libraryPath));
  if (known && known.exists === false) {
    showToast(`「${known.name || baseName(libraryPath)}」路径不可用，请从列表移除后重新添加`, 'warn', 6000);
    return;
  }
  const token = ++state.contextToken;
  try {
    const result = await bridge.openLibrary(libraryPath);
    if (token !== state.contextToken) return;
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    applyWorkspace(result.workspace);
    state.tagFilter = null;
    setView('library');
    scheduleCatalogRefresh(true);
    await refreshHome();
  } catch (error) {
    showToast(`切换知识库失败：${error.message}`, 'error');
  }
}

async function ensureLibraryContext(libraryPath) {
  if (!libraryPath) return false;
  if (state.workspace && samePath(state.workspace.root, libraryPath)) return true;
  const token = ++state.contextToken;
  try {
    const result = await bridge.openLibrary(libraryPath);
    if (token !== state.contextToken) return false;
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    applyWorkspace(result.workspace);
    scheduleCatalogRefresh(true);
    return true;
  } catch (error) {
    logError(`切换知识库失败：${error.stack || error}`);
    showToast(`切换知识库失败：${error.message}`, 'error');
    return false;
  }
}

async function removeLibrary(lib) {
  if (!lib) return;
  const localTabs = state.tabs.filter((tab) => tab.libraryRoot && samePath(tab.libraryRoot, lib.path));
  let blocked = false;
  for (const tab of localTabs) {
    if (tab.conflict || tab.missing || tab.recovered) {
      blocked = blocked || Boolean(tab.dirty || tab.recovered);
      continue;
    }
    if (!tab.dirty) continue;
    const ok = await requestSave(tab);
    if (!ok) blocked = true;
  }
  if (blocked) {
    showToast('该知识库有恢复中或保存失败的草稿，请先处理', 'warn');
    return;
  }
  const answer = await bridge.confirm({
    type: 'warning',
    title: '移除知识库',
    message: `从列表移除「${lib.name || baseName(lib.path)}」？`,
    detail: '只会从列表中移除，不会删除磁盘上的文件。该库内已打开的标签页会关闭。',
    buttons: ['取消', '移除'],
    defaultId: 0,
    cancelId: 0
  });
  if (answer.response !== 1) return;
  try {
    const result = await bridge.removeLibrary(lib.path);
    state.libraries = Array.isArray(result.libraries) ? result.libraries : [];
    if (result.workspace) {
      applyWorkspace(result.workspace);
    } else {
      state.workspace = null;
      state.catalog = { documents: [], tags: [], truncated: false };
      state.catalogLoading = false;
      updateWorkspaceChrome();
      renderTree();
      renderLibraryView();
    }
    const affected = state.tabs.filter((tab) => tab.libraryRoot && samePath(tab.libraryRoot, lib.path));
    if (affected.length > 0) {
      const wasActive = affected.some((tab) => tab.id === state.activeId);
      for (const tab of affected) clearRecovery(tab);
      state.tabs = state.tabs.filter((tab) => !affected.includes(tab));
      renderTabBar();
      if (wasActive) {
        const next = state.tabs[0] || null;
        state.activeId = null;
        if (next) activateTab(next.id, { focus: false });
        else showWelcome();
      }
    }
    if (!activeTab() && (!state.workspace || state.view === 'doc')) showWelcome();
    else if (activeTab()) afterTabActivated(activeTab());
    syncButtons();
    await refreshHome();
    showToast('已从列表移除知识库，磁盘文件未删除', 'success');
  } catch (error) {
    showToast(`移除知识库失败：${error.message}`, 'error');
  }
}

async function renameLibrary(lib) {
  if (!lib) return;
  const name = await promptName({
    title: '重命名知识库',
    description: lib.path,
    value: lib.name || baseName(lib.path),
    placeholder: '知识库名称'
  });
  if (!name || name === lib.name) return;
  try {
    const result = await bridge.renameLibrary({ library: lib.path, name });
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    renderHome();
    updateWorkspaceChrome();
    renderLibraryView();
    if (activeTab()) updateTitle();
  } catch (error) {
    showToast(`重命名知识库失败：${error.message}`, 'error');
  }
}

function renderLibraryView() {
  const workspace = state.workspace;
  if (!workspace) {
    el.libTitle.textContent = '';
    el.libPath.textContent = '';
    el.docList.replaceChildren();
    el.tagFilter.replaceChildren();
    el.tagFilter.hidden = true;
    el.libEmpty.hidden = true;
    el.libLoading.hidden = true;
    el.libTruncated.hidden = true;
    return;
  }
  el.libTitle.textContent = libraryName(workspace.root) || workspace.name;
  el.libPath.textContent = workspace.root;
  el.libSort.value = state.settings.librarySort;
  const tags = Array.isArray(state.catalog.tags) ? state.catalog.tags : [];
  el.tagFilter.replaceChildren();
  el.tagFilter.hidden = tags.length === 0 && !state.tagFilter;
  if (!el.tagFilter.hidden) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'tag-chip';
    all.classList.toggle('active', !state.tagFilter);
    all.textContent = '全部';
    all.addEventListener('click', () => {
      state.tagFilter = null;
      renderLibraryView();
    });
    el.tagFilter.append(all);
    for (const tag of tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.classList.toggle('active', Boolean(state.tagFilter && state.tagFilter.toLowerCase() === tag.name.toLowerCase()));
      const label = document.createElement('span');
      label.textContent = tag.name;
      const count = document.createElement('span');
      count.className = 'tag-count';
      count.textContent = String(tag.count);
      chip.append(label, count);
      chip.addEventListener('click', () => {
        state.tagFilter = state.tagFilter && state.tagFilter.toLowerCase() === tag.name.toLowerCase() ? null : tag.name;
        renderLibraryView();
      });
      el.tagFilter.append(chip);
    }
  }
  let documents = Array.isArray(state.catalog.documents) ? state.catalog.documents.slice() : [];
  if (state.tagFilter) {
    const needle = state.tagFilter.toLowerCase();
    documents = documents.filter((doc) => (doc.tags || []).some((tag) => tag.toLowerCase() === needle));
  }
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  if (state.settings.librarySort === 'name') {
    documents.sort((a, b) => collator.compare(a.title || a.name, b.title || b.name) || collator.compare(a.relPath, b.relPath));
  } else {
    documents.sort((a, b) => (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0)
      || collator.compare(a.title || a.name, b.title || b.name));
  }
  const visible = documents.slice(0, MAX_RENDERED_DOCS);
  el.docList.replaceChildren();
  for (const doc of visible) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'doc-row';
    row.title = doc.relPath;
    const title = document.createElement('span');
    title.className = 'doc-row-title';
    title.textContent = doc.title || stemName(doc.name);
    const path = document.createElement('span');
    path.className = 'doc-row-path';
    path.textContent = dirname(doc.relPath) || '根目录';
    const meta = document.createElement('span');
    meta.className = 'doc-row-meta';
    const time = document.createElement('span');
    time.textContent = formatTime(doc.mtimeMs);
    meta.append(time);
    if (Number.isFinite(doc.words)) {
      const words = document.createElement('span');
      words.textContent = `${doc.words.toLocaleString('zh-CN')} 字`;
      meta.append(words);
    }
    if (Array.isArray(doc.tags) && doc.tags.length > 0) {
      const tagWrap = document.createElement('span');
      tagWrap.className = 'doc-row-tags';
      for (const tag of doc.tags.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        tagWrap.append(chip);
      }
      meta.append(tagWrap);
    }
    row.append(title, path, meta);
    row.addEventListener('click', () => openRel(doc.relPath, null, { library: workspace.root }));
    el.docList.append(row);
  }
  el.libLoading.hidden = !state.catalogLoading;
  el.libEmpty.hidden = state.catalogLoading || visible.length > 0;
  el.libEmpty.textContent = state.tagFilter
    ? `没有带标签「${state.tagFilter}」的文档。`
    : '这个知识库还没有文档，点击「新建笔记」开始。';
  if (state.catalog.truncated) {
    el.libTruncated.hidden = false;
    el.libTruncated.textContent = '文档过多，索引仅覆盖前 3000 篇；目录树仍可打开全部文件。';
  } else if (documents.length > MAX_RENDERED_DOCS) {
    el.libTruncated.hidden = false;
    el.libTruncated.textContent = '仅显示前 500 篇，请用目录树或搜索定位其余文档。';
  } else {
    el.libTruncated.hidden = true;
    el.libTruncated.textContent = '';
  }
}

async function refreshCatalog(refresh = false) {
  if (!state.workspace) {
    state.catalog = { documents: [], tags: [], truncated: false };
    state.catalogLoading = false;
    renderLibraryView();
    return;
  }
  const root = state.workspace.root;
  const token = ++state.catalogToken;
  state.catalogLoading = true;
  renderLibraryView();
  try {
    const data = await bridge.getCatalog({ library: root, refresh: Boolean(refresh) });
    if (token !== state.catalogToken || !state.workspace || !samePath(state.workspace.root, root)) return;
    state.catalog = {
      documents: Array.isArray(data.documents) ? data.documents : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      truncated: Boolean(data.truncated)
    };
  } catch (error) {
    if (token !== state.catalogToken) return;
    showToast(`文档索引失败：${error.message}`, 'error');
    logError(`文档索引失败：${error.stack || error}`);
  }
  state.catalogLoading = false;
  renderLibraryView();
}

function scheduleCatalogRefresh(refresh = false) {
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(() => refreshCatalog(refresh), 500);
}

async function toggleStar(library = (activeTab() ? activeTab().libraryRoot : null), relPath = (activeTab() ? activeTab().relPath : null)) {
  if (!library || !relPath) return;
  try {
    const data = await bridge.toggleStar({ library, relPath });
    state.starred = Array.isArray(data.starred) ? data.starred : state.starred;
    renderStarButton();
    renderStarred();
  } catch (error) {
    showToast(`收藏操作失败：${error.message}`, 'error');
  }
}

async function openWikiLink(target) {
  const tab = activeTab();
  if (!tab || !tab.libraryRoot) {
    showToast('请先将文档保存到知识库', 'warn');
    return;
  }
  try {
    const resolved = await bridge.resolveWiki({ library: tab.libraryRoot, target });
    if (!resolved) {
      showToast(`未找到「${target}」`, 'warn');
      return;
    }
    if (!(await ensureLibraryContext(tab.libraryRoot))) return;
    await openRel(resolved.relPath, null, { library: tab.libraryRoot });
  } catch (error) {
    showToast(`打开双链失败：${error.message}`, 'error');
  }
}

function renderTabBar() {
  el.tabbar.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement('div');
    button.className = `tab${tab.id === state.activeId ? ' active' : ''}${tab.recovered ? ' recovered' : ''}`;
    button.dataset.id = String(tab.id);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeId));
    button.tabIndex = tab.id === state.activeId ? 0 : -1;
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
    close.tabIndex = -1;
    close.setAttribute('aria-label', `关闭 ${tab.name}`);
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

function jumpToLine(line) {
  if (!line) return;
  if (state.settings.viewMode === 'reading') updateSettings({ viewMode: 'split' });
  gotoLine(line);
}

function afterTabActivated(tab, options = {}) {
  renderDocRail();
  renderStarButton();
  if (tab) {
    refreshBacklinks();
    ensureLibraryContext(tab.libraryRoot);
    if (options.line) jumpToLine(options.line);
  }
}

function activateTab(id, options = {}) {
  if (state.activeId === id) {
    const current = activeTab();
    if (current) {
      showEditor();
      ensureLibraryContext(current.libraryRoot);
    }
    syncButtons();
    if (options.line) jumpToLine(options.line);
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
  afterTabActivated(tab, options);
  syncButtons();
  if (!options.line && options.focus !== false && cm) cm.focus();
}

function createTab(doc, options = {}) {
  const lib = doc.library ? { path: doc.library } : libraryForPath(doc.path);
  const tab = {
    id: state.nextTabId,
    path: doc.path || null,
    libraryRoot: doc.library || (lib ? lib.path : null),
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
  afterTabActivated(tab, options);
  syncButtons();
  if (!options.line && options.focus !== false && cm) cm.focus();
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
        afterTabActivated(next);
      } else {
        renderTabBar();
        showWelcome();
        updateStatus();
      }
    } else {
      renderTabBar();
    }
    renderTree();
    syncButtons();
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
      ...docPayload(tab),
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
  if (result.library !== undefined) tab.libraryRoot = result.library;
  if (result.relPath !== undefined) tab.relPath = result.relPath;
  tab.savedText = snapshot;
  tab.dirty = tab.text !== snapshot;
  clearRecovery(tab);
  if (tab.id === state.activeId) {
    updateTitle();
    updateStatus();
    updateBanners();
    if (state.workspace && samePath(tab.libraryRoot, state.workspace.root)) scheduleCatalogRefresh(false);
    scheduleBacklinkRefresh();
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
        library: tab.libraryRoot,
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
  if (entries.length > 0) $('recoveryRestore').focus();
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
        library: entry.library || (libraryForPath(entry.path) || {}).path || null,
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
  syncButtons();
  showToast(`已恢复 ${entries.length} 个草稿，请检查后保存`, 'warn', 6000);
  if (activeTab() && cm) cm.focus();
  else el.welcomeOpenFolder.focus();
}

async function discardRecovery() {
  el.recoveryModal.hidden = true;
  state.recoveryEntries = [];
  try {
    await bridge.clearAllRecovery();
  } catch {
    // 忽略。
  }
  if (activeTab() && cm) cm.focus();
  else el.welcomeOpenFolder.focus();
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
  if (state.settings.viewMode === 'editor') return;
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
    const result = await bridge.pickImage(docPayload(tab));
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
      ...docPayload(tab),
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
  if (state.settings.viewMode === 'reading') updateSettings({ viewMode: 'split' });
  if (state.view !== 'doc') setView('doc');
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
  const visible = Boolean(tab) && state.outline.length > 0;
  el.outlinePanel.hidden = !visible;
  el.outlineList.replaceChildren();
  if (!visible) {
    el.outlineCount.textContent = '';
    return;
  }
  el.outlineCount.textContent = `${state.outline.length}`;
  state.outline.forEach((heading, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `outline-item level-${heading.level}`;
    button.textContent = heading.text;
    button.title = heading.text;
    button.dataset.index = String(index);
    button.addEventListener('click', () => {
      if (state.settings.viewMode === 'reading') scrollPreviewToHeading(index);
      else gotoLine(heading.line + 1);
    });
    el.outlineList.append(button);
  });
  updateOutlineActive(cm ? cm.getCursor().line : 0);
}

function scrollPreviewToHeading(index) {
  const headings = previewHeadingElements();
  const target = headings[index];
  if (!target) return;
  const top = target.getBoundingClientRect().top - el.previewPane.getBoundingClientRect().top + el.previewPane.scrollTop - 8;
  el.previewPane.scrollTop = Math.max(0, top);
}

function updateOutlineActive(line) {
  if (el.outlinePanel.hidden || state.outline.length === 0) return;
  const active = outlineIndexForLine(line);
  const items = el.outlineList.querySelectorAll('.outline-item');
  items.forEach((item, index) => item.classList.toggle('active', index === active));
}

function isStarred(tab) {
  if (!tab || !tab.libraryRoot || !tab.relPath) return false;
  return state.starred.some((star) => samePath(star.library, tab.libraryRoot) && star.relPath === tab.relPath);
}

function renderStarButton() {
  const tab = activeTab();
  const starred = isStarred(tab);
  el.btnStar.textContent = starred ? '★' : '☆';
  el.btnStar.classList.toggle('starred', starred);
  el.btnStar.disabled = !tab || !tab.libraryRoot;
  el.btnStar.title = starred ? '取消收藏' : '收藏';
}

function renderDocRail() {
  const tab = activeTab();
  el.docRail.hidden = !tab;
  renderDocTags();
  renderBacklinks();
}

function renderDocTags() {
  el.docTags.replaceChildren();
  const tab = activeTab();
  const tags = tab ? T.parseFrontmatter(tab.text).tags : [];
  if (tags.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tag-empty';
    empty.textContent = tab ? '无标签' : '';
    el.docTags.append(empty);
    return;
  }
  for (const tag of tags) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-chip';
    button.textContent = tag;
    button.title = `筛选标签：${tag}`;
    button.addEventListener('click', () => {
      state.tagFilter = tag;
      setView('library');
      renderLibraryView();
    });
    el.docTags.append(button);
  }
}

function renderBacklinks() {
  el.backlinkList.replaceChildren();
  el.backlinkCount.textContent = state.backlinks.length > 0 ? String(state.backlinks.length) : '';
  const tab = activeTab();
  if (!tab || !tab.libraryRoot || !tab.relPath) {
    const empty = document.createElement('div');
    empty.className = 'backlink-empty';
    empty.textContent = tab ? '保存到知识库后可查看引用。' : '';
    el.backlinkList.append(empty);
    return;
  }
  if (state.backlinks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'backlink-empty';
    empty.textContent = '还没有文档引用这篇笔记。';
    el.backlinkList.append(empty);
    return;
  }
  for (const item of state.backlinks) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'backlink-item';
    button.title = item.relPath;
    const title = document.createElement('span');
    title.className = 'backlink-title';
    title.textContent = item.title || baseName(item.relPath);
    const path = document.createElement('span');
    path.className = 'backlink-path';
    path.textContent = item.relPath;
    button.append(title, path);
    button.addEventListener('click', () => openRel(item.relPath, null, { library: tab.libraryRoot }));
    el.backlinkList.append(button);
  }
}

async function refreshBacklinks() {
  const tab = activeTab();
  const token = ++state.backlinkToken;
  if (!tab || !tab.libraryRoot || !tab.relPath) {
    state.backlinks = [];
    state.backlinksKey = '';
    renderBacklinks();
    return;
  }
  const key = `${tab.libraryRoot}|${tab.relPath}`;
  if (state.backlinksKey !== key) {
    state.backlinksKey = key;
    state.backlinks = [];
    renderBacklinks();
  }
  try {
    const data = await bridge.getBacklinks({ library: tab.libraryRoot, relPath: tab.relPath });
    if (token !== state.backlinkToken) return;
    state.backlinks = Array.isArray(data.backlinks) ? data.backlinks : [];
  } catch (error) {
    if (token !== state.backlinkToken) return;
    state.backlinks = [];
    logError(`读取反向链接失败：${error.stack || error}`);
  }
  renderBacklinks();
}

function scheduleBacklinkRefresh() {
  clearTimeout(backlinkTimer);
  backlinkTimer = setTimeout(refreshBacklinks, 600);
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
      if (!isDir && tab && tab.libraryRoot && samePath(tab.libraryRoot, state.workspace.root) && tab.relPath === node.relPath) {
        row.classList.add('active');
      }
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
  const groups = [];
  const groupMap = new Map();
  for (const hit of data.results) {
    const key = String(hit.library || '').toLowerCase();
    let group = groupMap.get(key);
    if (!group) {
      group = {
        library: hit.library,
        name: hit.libraryName || libraryName(hit.library) || '知识库',
        count: 0,
        files: [],
        fileMap: new Map()
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.count += 1;
    let file = group.fileMap.get(hit.relPath);
    if (!file) {
      file = { relPath: hit.relPath, name: hit.name, hits: [] };
      group.fileMap.set(hit.relPath, file);
      group.files.push(file);
    }
    file.hits.push(hit);
  }
  const truncated = data.truncated ? '（已截断）' : '';
  el.searchSummary.textContent = data.results.length === 0
    ? '没有找到匹配内容'
    : `在 ${groups.length} 个知识库中找到 ${data.results.length} 条结果${truncated}，扫描 ${data.filesScanned || 0} 个文件`;
  if (data.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    const message = document.createElement('div');
    message.textContent = '没有找到匹配内容';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn small';
    action.textContent = '清除搜索';
    action.addEventListener('click', clearSearch);
    empty.append(message, action);
    el.searchResults.append(empty);
    return;
  }
  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'search-group';
    section.dataset.library = group.library || '';
    const head = document.createElement('div');
    head.className = 'search-group-head';
    const title = document.createElement('span');
    title.textContent = group.name;
    const count = document.createElement('span');
    count.textContent = `${group.count} 条`;
    head.append(title, count);
    section.append(head);
    for (const file of group.files) {
      const fileBlock = document.createElement('div');
      fileBlock.className = 'search-file';
      const fileHead = document.createElement('div');
      fileHead.className = 'search-file-head';
      const fileName = document.createElement('strong');
      fileName.textContent = file.name;
      const filePath = document.createElement('span');
      filePath.textContent = file.relPath;
      fileHead.append(fileName, filePath);
      fileBlock.append(fileHead);
      for (const hit of file.hits) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        button.dataset.library = hit.library || '';
        button.dataset.rel = hit.relPath;
        button.dataset.line = String(hit.line);
        const pathRow = document.createElement('div');
        pathRow.className = 'sr-path';
        const line = document.createElement('span');
        line.className = 'sr-line';
        line.textContent = `第 ${hit.line} 行`;
        pathRow.append(line);
        const text = document.createElement('div');
        text.className = 'sr-text';
        appendHighlighted(text, hit.text || '', query);
        button.append(pathRow, text);
        button.addEventListener('click', () => openSearchHit(hit));
        fileBlock.append(button);
      }
      section.append(fileBlock);
    }
    el.searchResults.append(section);
  }
}

async function openSearchHit(hit) {
  if (!(await ensureLibraryContext(hit.library))) return;
  await openRel(hit.relPath, hit.line, { library: hit.library });
}

async function runSearch() {
  const query = el.searchInput.value.trim();
  if (!query) {
    hideSearchResults();
    renderTree();
    return;
  }
  if (state.libraries.length === 0) {
    showToast('请先添加知识库', 'warn');
    return;
  }
  if (state.view !== 'search') state.viewBeforeSearch = state.view;
  setView('search');
  const token = ++state.searchToken;
  el.searchSummary.textContent = '正在搜索全部知识库…';
  el.searchResults.hidden = false;
  el.searchResults.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'search-loading';
  loading.textContent = '正在搜索全部知识库…';
  el.searchResults.append(loading);
  try {
    const data = await bridge.search({ query });
    if (token !== state.searchToken) return;
    state.searchData = data;
    renderSearchResults(data, query);
  } catch (error) {
    if (token !== state.searchToken) return;
    el.searchResults.replaceChildren();
    el.searchSummary.textContent = '搜索失败';
    const message = document.createElement('div');
    message.className = 'search-empty';
    message.textContent = `搜索失败：${error.message}`;
    el.searchResults.append(message);
  }
}

function resetSearchFilter() {
  state.searchToken += 1;
  state.searchData = null;
  el.searchInput.value = '';
  el.btnClearSearch.hidden = true;
  el.searchSummary.textContent = '';
  hideSearchResults();
}

function clearSearch() {
  resetSearchFilter();
  renderTree();
  if (state.view === 'search') {
    setView(activeTab() ? 'doc' : (state.workspace ? 'library' : 'home'));
  }
  el.searchInput.focus();
}

/* ---------- 弹框 ---------- */

function promptName(options) {
  if (modalResolve) {
    const previous = modalResolve;
    modalResolve = null;
    previous(null);
  }
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  const restore = value == null ? modalReturnFocus : null;
  modalReturnFocus = null;
  el.modal.hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(value);
  if (restore && restore.isConnected) restore.focus();
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

async function openRel(relPath, line = null, options = {}) {
  if (!relPath) return;
  const library = options.library || (state.workspace ? state.workspace.root : null);
  if (!library) return;
  const existing = state.tabs.find((tab) => tab.libraryRoot && samePath(tab.libraryRoot, library) && tab.relPath === relPath);
  if (existing) {
    activateTab(existing.id, { line });
    return;
  }
  try {
    if (!(await ensureLibraryContext(library))) {
      showToast('无法切换到知识库', 'error');
      return;
    }
    const doc = await bridge.readFile({ library, relPath });
    if (line && state.settings.viewMode === 'reading') await updateSettings({ viewMode: 'split' });
    openDoc(doc, { line, focus: true });
    state.selectedDir = dirname(relPath);
    ensureExpanded(relPath);
    renderTree();
    await refreshRecent();
  } catch (error) {
    showToast(`打开文件失败：${error.message}`, 'error');
  }
}

async function openFileDialog() {
  try {
    const result = await bridge.chooseFile();
    if (!result) return;
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    state.recent = result.recent || state.recent;
    renderLibraries();
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
    state.libraries = Array.isArray(result.libraries) ? result.libraries : state.libraries;
    state.recent = result.recent || state.recent;
    renderLibraries();
    renderRecent();
    if (result.workspace) applyWorkspace(result.workspace);
    if (result.file) openDoc(result.file, { focus: true });
  } catch (error) {
    showToast(`打开最近文档失败：${error.message}`, 'error');
  }
}

async function newNote(parentRelOverride) {
  if (!state.workspace) {
    await addLibraryDialog();
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
    const doc = await bridge.readFile({ library: state.workspace.root, relPath: result.entry.relPath });
    if (state.platform === 'win32' && !doc.content) doc.eol = 'crlf';
    openDoc(doc, { focus: true });
    scheduleCatalogRefresh(false);
    await refreshRecent();
    showToast(`已创建 ${result.entry.name}`, 'success');
  } catch (error) {
    showToast(`新建笔记失败：${error.message}`, 'error');
  }
}

async function newFolder(parentRelOverride) {
  if (!state.workspace) {
    showToast('请先添加知识库', 'warn');
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
    if (!tab.relPath || !tab.libraryRoot || !state.workspace || !samePath(tab.libraryRoot, state.workspace.root)) continue;
    if (tab.relPath === oldRel || tab.relPath.startsWith(`${oldRel}/`)) {
      const suffix = tab.relPath.slice(oldRel.length);
      tab.relPath = `${newRel}${suffix}`;
      tab.path = absFromRel(tab.libraryRoot, tab.relPath);
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
    scheduleCatalogRefresh(false);
    refreshBacklinks();
    await refreshHome();
    showToast('已重命名', 'success');
  } catch (error) {
    showToast(`重命名失败：${error.message}`, 'error');
  }
}

async function deleteNode(node) {
  const isDir = node.type === 'dir';
  const activeLibrary = state.workspace ? state.workspace.root : null;
  const affected = state.tabs.filter((tab) => tab.libraryRoot && activeLibrary
    && samePath(tab.libraryRoot, activeLibrary)
    && tab.relPath
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
        afterTabActivated(next);
      }
    }
    applyWorkspace(result.workspace);
    if (!activeTab()) showWelcome();
    syncButtons();
    renderTabBar();
    updateTitle();
    updateStatus();
    updateBanners();
    renderPreview();
    renderOutline();
    scheduleCatalogRefresh(false);
    refreshBacklinks();
    await refreshRecent();
    await refreshHome();
    showToast('已移到回收站', 'success');
  } catch (error) {
    showToast(`删除失败：${error.message}`, 'error');
  }
}

async function revealNode(node) {
  try {
    await bridge.reveal({ library: state.workspace ? state.workspace.root : null, relPath: node.relPath });
  } catch (error) {
    showToast(`定位失败：${error.message}`, 'error');
  }
}

async function revealCurrent() {
  const tab = activeTab();
  if (!tab) return;
  try {
    if (tab.relPath && tab.libraryRoot) await bridge.reveal({ library: tab.libraryRoot, relPath: tab.relPath });
    else if (tab.path) await bridge.reveal({ path: tab.path });
  } catch (error) {
    showToast(`定位失败：${error.message}`, 'error');
  }
}

async function openLocalLink(href) {
  const baseDir = baseDirForRender(activeTab());
  try {
    const result = await bridge.openLink({ baseDir, href });
    if (result.libraries) {
      state.libraries = result.libraries;
      renderLibraries();
    }
    if (result.workspace) {
      applyWorkspace(result.workspace);
      setView('library');
      scheduleCatalogRefresh(true);
    }
    if (result.file) openDoc(result.file, { focus: true });
  } catch (error) {
    showToast(`打开链接失败：${error.message}`, 'error');
  }
}

function applyWorkspace(workspace) {
  if (!workspace) return;
  const previousRoot = state.workspace ? state.workspace.root.toLowerCase() : '';
  const rootChanged = previousRoot !== workspace.root.toLowerCase();
  state.workspace = workspace;
  state.lastRefresh = Date.now();
  if (rootChanged) {
    resetSearchFilter();
    state.selectedDir = '';
    state.expanded = new Set();
    state.tagFilter = null;
    state.catalog = { documents: [], tags: [], truncated: false };
    state.catalogLoading = false;
    state.backlinks = [];
    state.backlinksKey = '';
    state.backlinkToken += 1;
    scheduleCatalogRefresh(true);
  }
  if (workspace.truncated) {
    showToast('文件夹内容过多，目录只显示了前 5000 项。', 'warn', 6500);
  }
  updateWorkspaceChrome();
  renderLibraries();
  renderTree();
  renderLibraryView();
  renderDocRail();
  if (activeTab()) {
    updateTitle();
    updateStatus();
  }
}

async function refreshWorkspace(silent = false, options = {}) {
  if (!state.workspace) return;
  try {
    const data = await bridge.refreshWorkspace();
    if (!data || !data.workspace) return;
    applyWorkspace(data.workspace);
    if (options.catalog !== false) scheduleCatalogRefresh(true);
    scheduleBacklinkRefresh();
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
      library: tab.libraryRoot,
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
    tab.libraryRoot = result.library || null;
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
    renderDocRail();
    renderStarButton();
    syncButtons();
    refreshBacklinks();
    if (result.library && state.workspace && samePath(result.library, state.workspace.root)) {
      if (result.relPath) {
        state.selectedDir = dirname(result.relPath);
        ensureExpanded(result.relPath);
      }
      await refreshWorkspace(true);
    } else {
      renderTree();
    }
    await refreshRecent();
    await refreshHome();
    showToast(`已另存为 ${result.name}`, 'success');
  } catch (error) {
    showToast(`另存为失败：${error.message}`, 'error');
  }
}

async function openHistory() {
  const tab = activeTab();
  if (!tab || !tab.path) return;
  historyReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await loadHistory(tab);
  el.historyModal.hidden = false;
  $('historyClose').focus();
}

function closeHistory() {
  el.historyModal.hidden = true;
  const target = historyReturnFocus;
  historyReturnFocus = null;
  if (target && target.isConnected) target.focus();
}

async function loadHistory(tab) {
  el.historyDesc.textContent = tab.name;
  el.historyList.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'history-empty';
  loading.textContent = '正在读取快照…';
  el.historyList.append(loading);
  try {
    const items = await bridge.listBackups(docPayload(tab));
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
    await bridge.createBackup(docPayload(tab));
    await loadHistory(tab);
    showToast('已创建快照', 'success');
  } catch (error) {
    showToast(`创建快照失败：${error.message}`, 'error');
  }
}

async function loadBackupIntoEditor(tab, id) {
  try {
    const backup = await bridge.readBackup({ ...docPayload(tab), id });
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
    closeHistory();
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
    const doc = await bridge.readFile(docPayload(tab));
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
  if (!['split', 'editor', 'reading'].includes(state.settings.viewMode)) state.settings.viewMode = 'split';
  if (state.settings.librarySort !== 'name') state.settings.librarySort = 'updated';
  applyTheme();
  applyLayout();
  syncButtons();
  renderPreview();
  renderOutline();
  renderDocRail();
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
  settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.settingsModal.hidden = false;
  const settings = state.settings;
  $('setTheme').value = settings.theme;
  $('setFontSize').value = String(settings.fontSize);
  $('setLineWidth').value = String(settings.lineWidth);
  $('setAutosaveDelay').value = String(settings.autosaveDelay);
  $('setWordGoal').value = String(settings.wordGoal);
  $('setAutosave').checked = settings.autosave;
  $('setSidebar').checked = settings.sidebar;
  $('setOutline').checked = settings.outline;
  $('setRemoteImages').checked = settings.remoteImages;
  $('setSyntaxHighlight').checked = settings.syntaxHighlight;
  $('setReadingTime').checked = settings.showReadingTime;
  $('setIgnoreDirs').value = (settings.ignoreDirs || []).join(', ');
  $('setTheme').focus();
}

function closeSettings() {
  el.settingsModal.hidden = true;
  const target = settingsReturnFocus;
  settingsReturnFocus = null;
  if (target && target.isConnected) target.focus();
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
    sidebar: $('setSidebar').checked,
    outline: $('setOutline').checked,
    remoteImages: $('setRemoteImages').checked,
    syntaxHighlight: $('setSyntaxHighlight').checked,
    showReadingTime: $('setReadingTime').checked,
    ignoreDirs
  });
  if (next) {
    closeSettings();
    if ((next.ignoreDirs || []).join('\u0000') !== previousIgnore) await refreshWorkspace(true);
    showToast('设置已保存', 'success');
  }
}

function toggleSidebar() {
  updateSettings({ sidebar: !state.settings.sidebar });
}

function toggleReading() {
  if (!activeTab()) return;
  const next = state.settings.viewMode === 'reading' ? 'split' : 'reading';
  if (next === 'reading') closeFind();
  updateSettings({ viewMode: next });
}

function toggleOutline() {
  updateSettings({ outline: !state.settings.outline });
}

function toggleTheme() {
  updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' });
}

/* ---------- 菜单动作 ---------- */

function focusSearch() {
  if (state.libraries.length === 0) {
    showToast('请先添加知识库', 'warn');
    return;
  }
  el.searchInput.focus();
  el.searchInput.select();
}

async function printDocument() {
  if (!activeTab()) {
    showToast('没有可打印的文档', 'warn');
    return;
  }
  setView('doc');
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
    case 'add-library': await addLibraryDialog(); break;
    case 'home': showHome(); break;
    case 'save': await requestSave(); break;
    case 'save-as': await saveAs(); break;
    case 'close-tab': if (activeTab()) await closeTab(state.activeId); break;
    case 'settings': openSettings(); break;
    case 'find': openFind(); break;
    case 'toggle-sidebar': toggleSidebar(); break;
    case 'toggle-reading': toggleReading(); break;
    case 'toggle-outline': toggleOutline(); break;
    case 'focus-search': focusSearch(); break;
    case 'print': await printDocument(); break;
    default: break;
  }
}

async function handleOpenPayload(payload) {
  if (!payload) return;
  if (payload.libraries) {
    state.libraries = payload.libraries;
    renderLibraries();
  }
  if (payload.recent) {
    state.recent = payload.recent;
    renderRecent();
  }
  if (payload.workspace) applyWorkspace(payload.workspace);
  if (payload.file) openDoc(payload.file, { focus: true });
  else if (payload.workspace) setView('library');
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  el.btnNewNote.addEventListener('click', () => newNote());
  el.btnHome.addEventListener('click', showHome);
  el.btnAddLibrary.addEventListener('click', addLibraryDialog);
  el.btnAddLibraryCard.addEventListener('click', addLibraryDialog);
  el.btnNewNoteSidebar.addEventListener('click', () => newNote());
  el.btnLibNewNote.addEventListener('click', () => newNote());
  el.btnLibRefresh.addEventListener('click', () => refreshWorkspace(false));
  el.btnOpenFolderSidebar.addEventListener('click', addLibraryDialog);
  el.welcomeOpenFolder.addEventListener('click', addLibraryDialog);
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
  el.btnSearchClose.addEventListener('click', clearSearch);
  el.btnStar.addEventListener('click', () => toggleStar());
  el.viewSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.disabled) return;
    updateSettings({ viewMode: button.dataset.mode });
    if (button.dataset.mode === 'reading') closeFind();
  });
  el.libSort.addEventListener('change', async () => {
    await updateSettings({ librarySort: el.libSort.value });
    renderLibraryView();
  });

  el.previewPane.addEventListener('scroll', () => {
    if (state.settings.viewMode !== 'split' || !cm) return;
    syncPreviewToEditor();
  });

  el.tabbar.addEventListener('keydown', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    const index = state.tabs.findIndex((item) => String(item.id) === tab.dataset.id);
    if (index < 0) return;
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % state.tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + state.tabs.length) % state.tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = state.tabs.length - 1;
    else if (event.key === 'Delete') {
      event.preventDefault();
      closeTab(state.tabs[index].id);
      return;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    const next = state.tabs[nextIndex];
    activateTab(next.id, { focus: false });
    const nextTab = el.tabbar.querySelector(`.tab[data-id="${next.id}"]`);
    if (nextTab) nextTab.focus();
  });

  el.preview.addEventListener('click', async (event) => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const wikiTarget = anchor.getAttribute('data-wiki-target');
    if (wikiTarget) {
      event.preventDefault();
      await openWikiLink(wikiTarget);
      return;
    }
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
    if (state.view === 'search') {
      setView(activeTab() ? 'doc' : (state.workspace ? 'library' : 'home'));
    }
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
    if (state.settings.viewMode !== 'split') return;
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
  $('settingsCancel').addEventListener('click', closeSettings);
  $('settingsLogs').addEventListener('click', () => bridge.openLogs().catch(() => {}));
  $('settingsCopyLog').addEventListener('click', () => bridge.copyLogPath().then(() => showToast('日志路径已复制', 'success')).catch(() => {}));
  $('settingsClearLog').addEventListener('click', () => bridge.clearLogs().then((ok) => { if (ok) showToast('日志已清空', 'success'); }).catch(() => {}));
  $('historyClose').addEventListener('click', closeHistory);
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
        closeHistory();
        return;
      }
      if (!el.settingsModal.hidden) {
        closeSettings();
        return;
      }
      if (state.find.open) {
        closeFind();
        return;
      }
      if (state.view === 'search') clearSearch();
    }
  });

  window.addEventListener('resize', () => {
    if (cm) cm.refresh();
  });
  window.addEventListener('focus', () => {
    if (!state.workspace) return;
    if (Date.now() - state.lastRefresh < 1500) return;
    refreshWorkspace(true, { catalog: state.view === 'library' });
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
  setView('home');
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
    state.libraries = Array.isArray(boot.libraries) ? boot.libraries : [];
    state.recent = Array.isArray(boot.recent) ? boot.recent : [];
    state.starred = Array.isArray(boot.starred) ? boot.starred : [];
    applySettings(boot.settings || DEFAULT_SETTINGS);
    if (boot.workspace) applyWorkspace(boot.workspace);
    renderLibraries();
    renderHome();
    renderRecent();
    if (boot.file) openDoc(boot.file, { focus: false });
    else setView(boot.workspace ? 'library' : 'home');
    updateWorkspaceChrome();
    updateStatus();
    if (boot.workspace) scheduleCatalogRefresh(true);
    if (Array.isArray(boot.recovery) && boot.recovery.length > 0) showRecoveryModal(boot.recovery);
    if (state.testMode) {
      window.__mdTest = {
        getState: () => ({
          workspaceRoot: state.workspace ? state.workspace.root : null,
          activeLibrary: state.workspace ? state.workspace.root : null,
          libraries: state.libraries.map((lib) => ({ path: lib.path, name: lib.name, active: Boolean(lib.active), exists: lib.exists })),
          view: state.view,
          viewMode: state.settings.viewMode,
          catalogCount: state.catalog.documents.length,
          starred: state.starred.map((item) => ({ ...item })),
          settings: { ...state.settings },
          recent: state.recent.map((item) => ({ ...item })),
          activeId: state.activeId,
          tabs: state.tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
            path: tab.path,
            libraryRoot: tab.libraryRoot,
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
        openLibrary: switchLibrary,
        updateSettings: (patch) => updateSettings(patch),
        refreshWorkspace,
        getCatalog: () => refreshCatalog(true),
        toggleStar: () => toggleStar(),
        openWiki: (target) => openWikiLink(target),
        getBacklinks: () => refreshBacklinks(),
        searchAll: (query) => bridge.search({ query }),
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
    setView('home');
  }
  document.body.dataset.ready = '1';
}

init();
