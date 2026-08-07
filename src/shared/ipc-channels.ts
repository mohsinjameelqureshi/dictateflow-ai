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
  /** Settings lives in its own window; this is how anything asks for it. */
  settingsOpen: 'settings:open',

  /* Pauses the global hook while the user records a new combo, so the OLD
     shortcut cannot start a dictation mid-rebind. */
  shortcutSuspend: 'shortcut:suspend',

  /* microphone list, enumerated by the widget on behalf of Settings */
  devicesList: 'devices:list',

  /* history — read paths land in Phase 3, the shape is fixed now */
  dictationsList: 'dictations:list',
  dictationsCreate: 'dictations:create',

  /* the Groq key. safeStorage only — never the settings table (§2). */
  apiKeyStatus: 'apiKey:status',
  apiKeySet: 'apiKey:set',
  apiKeyClear: 'apiKey:clear',

  /* capture loop. The widget renderer owns the microphone; main owns
     everything else. Both directions are enumerated here. */
  widgetClip: 'widget:clip',
  widgetMicError: 'widget:micError',
  widgetDevices: 'widget:devices',

  /* diagnostics */
  appInfo: 'app:info',
} as const

/**
 * Main -> renderer pushes. Separate from IPC because these are `send`/`on`,
 * not `invoke` — there is no reply and the renderer cannot initiate them.
 */
export const IPC_EVENT = {
  /** main -> widget: start, stop or discard a recording */
  widgetCommand: 'widget:command',
  /** main -> widget: which of the nine states to render (§11) */
  widgetState: 'widget:state',
  /** main -> widget: list the audio inputs and reply on `widget:devices` */
  widgetEnumerate: 'widget:enumerate',
  /** main -> main window: history changed, reload it */
  dictationsChanged: 'dictations:changed',
  /** main -> main window: the tray asked for a page */
  navigate: 'app:navigate',
  /** main -> settings window: select a tab */
  settingsNavigate: 'settings:navigate',
} as const

/**
 * Passed to the widget window via `additionalArguments` so the single
 * sandboxed preload bundle knows which surface to expose. See preload/index.ts.
 */
export const WIDGET_ROLE_ARG = '--wispr-role=widget'

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]
