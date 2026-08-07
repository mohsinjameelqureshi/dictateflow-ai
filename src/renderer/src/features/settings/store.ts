import { create } from 'zustand'
import type { SettingsTab } from '@shared/types.js'

/**
 * Whether the settings dialog is open, and on which tab.
 *
 * A store rather than state in App, because the things that open Settings are
 * not all children of the thing that renders it: the empty-state prompt on the
 * history page is several levels down and has nothing else to say to its
 * ancestors. Threading a callback through those layers would be the only
 * reason any of them knew Settings existed.
 *
 * It is also what removes a renderer -> main -> same renderer round trip. That
 * prompt used to ask the main process to open Settings, which meant an IPC
 * call whose only effect was an event sent straight back to the window that
 * made it. Main still has `openSettings` — the tray genuinely needs it, since
 * the window may not exist yet — but nothing inside the window does.
 */
interface SettingsDialogState {
  /** The open tab, or null when the dialog is closed. */
  tab: SettingsTab | null
  open: (tab?: SettingsTab) => void
  close: () => void
}

export const useSettingsDialog = create<SettingsDialogState>((set) => ({
  tab: null,
  open: (tab = 'general') => set({ tab }),
  close: () => set({ tab: null }),
}))
