import { useEffect } from 'react'
import type { ResolvedTheme } from '@shared/types.js'

/**
 * Stamps the resolved theme on <html>, where theme.css picks it up as
 * `:root[data-theme='dark']`.
 *
 * The value always arrives from the main process already resolved — a
 * renderer never decides what 'system' means, so the three windows cannot
 * disagree with each other or with the window background Electron paints.
 */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme
}

export interface ThemeSource {
  get: () => Promise<ResolvedTheme>
  onChange: (cb: (theme: ResolvedTheme) => void) => () => void
}

/** Both preload surfaces expose this shape — the widget's included. */
export function useTheme(source: ThemeSource): void {
  useEffect(() => {
    void source.get().then(applyTheme)
    return source.onChange(applyTheme)
  }, [source])
}
