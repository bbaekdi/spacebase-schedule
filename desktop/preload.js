const { contextBridge, ipcRenderer } = require('electron');

// 설정 화면(setup.html)에서만 쓰는 기능
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  discover: () => ipcRenderer.invoke('discover'),
  printNow: () => ipcRenderer.invoke('print:do'),
  savePdf: () => ipcRenderer.invoke('print:save'),
  closePreview: () => ipcRenderer.invoke('print:close'),
});

// 스케줄 화면에서 인쇄 버튼을 누르면 미리보기 창을 연다
contextBridge.exposeInMainWorld('sbDesktop', { printPreview: () => ipcRenderer.invoke('print:preview') });
