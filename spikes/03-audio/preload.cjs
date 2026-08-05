const { contextBridge, ipcRenderer } = require('electron')

// Typed-ish bridge. The real app's surface lives in src/preload and is
// generated from shared/ipc-channels — this is the throwaway version.
contextBridge.exposeInMainWorld('spike', {
  saveWav: (bytes, meta) => ipcRenderer.invoke('save-wav', { bytes, meta }),
  reveal: () => ipcRenderer.invoke('reveal'),
})
