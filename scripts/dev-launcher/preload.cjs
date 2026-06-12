'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getState: () => ipcRenderer.invoke('launcher:state'),
  start: (id) => ipcRenderer.invoke('launcher:start', id),
  stop: (id) => ipcRenderer.invoke('launcher:stop', id),
  open: (url) => ipcRenderer.invoke('launcher:open', url),
  onState: (cb) => ipcRenderer.on('launcher:state-changed', (_e, snap) => cb(snap)),
  onLog: (cb) => ipcRenderer.on('launcher:log', (_e, payload) => cb(payload)),
});
