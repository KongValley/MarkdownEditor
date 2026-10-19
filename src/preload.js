'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getRecent: () => ipcRenderer.invoke('app:recent'),
  removeRecent: (target) => ipcRenderer.invoke('recent:remove', target),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  openLogs: () => ipcRenderer.invoke('logs:open'),
  copyLogPath: () => ipcRenderer.invoke('logs:copy'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  listBackups: (payload) => ipcRenderer.invoke('backups:list', payload),
  createBackup: (payload) => ipcRenderer.invoke('backups:create', payload),
  readBackup: (payload) => ipcRenderer.invoke('backups:read', payload),

  saveRecovery: (entry) => ipcRenderer.invoke('recovery:save', entry),
  clearRecovery: (key) => ipcRenderer.invoke('recovery:clear', key),
  clearAllRecovery: () => ipcRenderer.invoke('recovery:clearAll'),

  pickImage: (payload) => ipcRenderer.invoke('image:pick', payload),
  saveImageBuffer: (payload) => ipcRenderer.invoke('image:saveBuffer', payload),
  editAction: (action) => ipcRenderer.invoke('edit:action', action),

  chooseFolder: () => ipcRenderer.invoke('workspace:choose'),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),

  chooseFile: () => ipcRenderer.invoke('file:choose'),
  openRecent: (target) => ipcRenderer.invoke('file:recent', target),
  readFile: (payload) => ipcRenderer.invoke('file:read', payload),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),

  createEntry: (payload) => ipcRenderer.invoke('entry:create', payload),
  renameEntry: (payload) => ipcRenderer.invoke('entry:rename', payload),
  deleteEntry: (payload) => ipcRenderer.invoke('entry:delete', payload),
  reveal: (payload) => ipcRenderer.invoke('entry:reveal', payload),

  search: (query) => ipcRenderer.invoke('search:query', query),
  openLink: (payload) => ipcRenderer.invoke('link:open', payload),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  confirm: (payload) => ipcRenderer.invoke('ui:confirm', payload),
  print: () => ipcRenderer.invoke('ui:print'),

  logError: (payload) => ipcRenderer.invoke('app:log', payload),

  onOpen: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('app:open', (event, payload) => callback(payload));
  },
  onMenu: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('menu:action', (event, action) => callback(action));
  }
});
