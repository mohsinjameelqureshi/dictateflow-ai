/**
 * Every IPC channel in the app. Typed channels only (§7) — a string literal
 * at a call site is a bug waiting to happen.
 *
 * The map in shared/types.ts binds each channel to its request and response
 * types, so main and renderer cannot drift.
 */
export const IPC = {
  /* window chrome — the title bar is custom (§12) */
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',

  /* settings */
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',

  /* history — read paths land in Phase 3, the shape is fixed now */
  dictationsList: 'dictations:list',
  dictationsCreate: 'dictations:create',

  /* diagnostics */
  appInfo: 'app:info',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
