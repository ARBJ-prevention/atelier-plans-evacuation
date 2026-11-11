/* Pont sécurisé entre l'interface et le système (contextIsolation). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evac', {
  info: () => ipcRenderer.invoke('app:info'),
  openProjectDialog: () => ipcRenderer.invoke('project:open-dialog'),
  openProjectPath: (p) => ipcRenderer.invoke('project:open-path', p),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  pickFile: (kind) => ipcRenderer.invoke('file:pick', kind),
  saveBinary: (args) => ipcRenderer.invoke('file:save-binary', args),
  readBinary: (p) => ipcRenderer.invoke('file:read-binary', p),
  showInFolder: (p) => ipcRenderer.invoke('file:show', p),
  dwgStatus: () => ipcRenderer.invoke('dwg:status'),
  dwgChooseConverter: () => ipcRenderer.invoke('dwg:choose-converter'),
  dwgDownloadPage: () => ipcRenderer.invoke('dwg:download-page'),
  dwgConvert: (args) => ipcRenderer.invoke('dwg:convert', args),
  exportPdf: (args) => ipcRenderer.invoke('render:pdf', args),
  print: (args) => ipcRenderer.invoke('render:print', args),
  autosaveWrite: (args) => ipcRenderer.invoke('autosave:write', args),
  autosaveClear: (id) => ipcRenderer.invoke('autosave:clear', id),
  autosaveList: () => ipcRenderer.invoke('autosave:list'),
  recentList: () => ipcRenderer.invoke('recent:list'),
  setTitle: (t) => ipcRenderer.send('app:set-title', t),
  setDirty: (d) => ipcRenderer.send('app:set-dirty', d),
  forceClose: () => ipcRenderer.send('app:force-close'),
  selftestDone: (report) => ipcRenderer.invoke('selftest:done', report),
  updateCheck: (dir) => ipcRenderer.invoke('update:check', dir),
  updateSkip: (version) => ipcRenderer.invoke('update:skip', version),
  updateGetDir: () => ipcRenderer.invoke('update:get-dir'),
  updateChooseDir: () => ipcRenderer.invoke('update:choose-dir'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateGetOnline: () => ipcRenderer.invoke('update:get-online'),
  updateSetOnline: (v) => ipcRenderer.invoke('update:set-online', v),
  onMenu: (cb) => {
    const h = (_e, action, arg) => cb(action, arg);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.removeListener('menu', h);
  },
  onOpenFile: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('open-file', h);
    return () => ipcRenderer.removeListener('open-file', h);
  },
});
