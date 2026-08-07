import { BrowserWindow, nativeTheme } from 'electron'
import { IPC_EVENT } from '../shared/ipc-channels.js'
import { isThemeChoice, type ResolvedTheme } from '../shared/types.js'
import { readSetting } from './settings.js'
import { getWidgetWindow } from './windows/widget-window.js'

/**
 * Theme, decided in one place.
 *
 * The main process owns the answer — including what 'system' currently means —
 * and pushes the RESOLVED value to all three renderers. If each window worked
 * it out for itself they could disagree, and the widget cannot work it out at
 * all: its preload surface is microphone-only by design (§6.7).
 *
 * `nativeTheme.themeSource` is doing real work here rather than being a
 * formality — it is what makes Electron follow the OS while the setting says
 * 'system', and what makes `shouldUseDarkColors` the single source of truth.
 */

/** Matches --color-surface in theme.css. Used to stop a white flash on load. */
const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: '#f1f1f4',
  dark: '#0f0f11',
}

export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** For a window being constructed, which has missed the last broadcast. */
export function windowBackground(): string {
  return WINDOW_BACKGROUND[resolvedTheme()]
}

export function applyTheme(choice: string): void {
  // A corrupt stored value degrades to following the OS rather than throwing
  // in the main process at boot.
  nativeTheme.themeSource = isThemeChoice(choice) ? choice : 'system'
  broadcastTheme()
}

export function broadcastTheme(): void {
  const theme = resolvedTheme()
  const widget = getWidgetWindow()

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC_EVENT.theme, theme)

    // The widget is transparent (§6.2) — painting a background would put an
    // opaque rectangle over whatever the user is dictating into.
    if (win !== widget) win.setBackgroundColor(WINDOW_BACKGROUND[theme])
  }
}

export function initTheme(): void {
  applyTheme(readSetting('theme'))

  // Fires when the OS switches while the setting says 'system'. Without it,
  // 'system' would only be read once, at launch.
  nativeTheme.on('updated', broadcastTheme)
}
