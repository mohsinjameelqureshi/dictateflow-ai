import { useCallback, useEffect, useRef, useState } from 'react'
import type { SettingKey, Settings } from '@shared/types.js'

/**
 * The settings table, as the window sees it.
 *
 * Writes are optimistic — a control that lags a round trip feels broken — but
 * a failed write snaps the value back rather than leaving the UI claiming
 * something that was never stored (§14: every failure path is surfaced).
 */
export interface SettingsStore {
  settings: Settings | null
  error: string | null
  save: (key: SettingKey, value: string) => Promise<void>
}

export function useSettings(): SettingsStore {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read by `save` to find the value to roll back to. A ref rather than a
  // state updater's argument, because StrictMode double-invokes updaters and
  // the second pass would capture the new value as the old one.
  const latest = useRef<Settings | null>(null)
  useEffect(() => {
    latest.current = settings
  }, [settings])

  useEffect(() => {
    void window.typeflow.settings
      .getAll()
      .then(setSettings)
      .catch(() => setError('Could not read your settings.'))
  }, [])

  const save = useCallback(async (key: SettingKey, value: string) => {
    const previous = latest.current?.[key] ?? ''
    setError(null)
    setSettings((s) => (s ? { ...s, [key]: value } : s))

    try {
      await window.typeflow.settings.set(key, value)
    } catch {
      setSettings((s) => (s ? { ...s, [key]: previous } : s))
      setError('That change could not be saved.')
    }
  }, [])

  return { settings, error, save }
}
