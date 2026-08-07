import { app } from 'electron'

/**
 * The Windows login item.
 *
 * Lives apart from the IPC layer so that importing a backup can re-apply it
 * without importing `ipc/handlers.ts`, which imports the database, the
 * dictation session and the windows in turn.
 */
export function applyLoginItem(openAtLogin: boolean): void {
  // A dev run would otherwise register the Electron binary itself as a
  // startup item, which then launches an app that no longer exists.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin, path: process.execPath })
}
