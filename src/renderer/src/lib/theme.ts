import { useEffect, useState } from 'react'
import type { ResolvedTheme } from '@shared/types.js'

/**
 * Stamps the resolved theme on <html>, where theme.css picks it up as
 * `:root[data-theme='dark']`.
 *
 * The value always arrives from the main process already resolved — a
 * renderer never decides what 'system' means, so the three windows cannot
 * disagree with each other or with the window background Electron paints.
 */
function stamp(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme
}

/**
 * Apply the theme, optionally as a cross-fade.
 *
 * The fade is a View Transition, NOT a blanket CSS transition on every element.
 * That was the first attempt and it looked worse than no animation: animating
 * colour on a few thousand elements repaints the whole tree on the main thread,
 * so the sidebar, the content and the cards each landed on a different frame —
 * the switch appeared to flash through in stages rather than move as one.
 *
 * A view transition snapshots the before and after states and cross-fades the
 * two images on the compositor. One layer, one animation, the whole window
 * moving together, and no per-element paint at all.
 *
 * The cost is that the page is a static image for the length of the fade, so
 * keep it short and never run it for a change the user did not ask for.
 */
export function applyTheme(theme: ResolvedTheme, crossfade = false): void {
  const root = document.documentElement
  const previous = root.dataset['theme']

  if (previous === theme) return

  // `previous` unset is the first stamp at launch: there is nothing to fade
  // FROM, and fading here would wash the window in from the default light
  // palette on a dark install.
  //
  // Reduced motion is checked here rather than left to CSS so the frozen frame
  // does not happen either — for someone who asked for less motion, a page that
  // stops responding for 260ms is the same complaint in a different form (§14).
  const animate =
    crossfade &&
    previous !== undefined &&
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!animate) {
    stamp(theme)
    return
  }

  /**
   * `theme-switching` freezes every element's OWN transition for the length of
   * the switch, and it has to go on inside the callback so the browser captures
   * the "after" snapshot with it already applied.
   *
   * Without it, anything carrying `transition-colors` — the dictation cards and
   * their action buttons — animates on its own 150ms clock while the view
   * transition runs. The snapshot then freezes those elements mid-way, still
   * wearing the old theme, and they pop to the new one the instant the fade
   * ends and the live DOM is revealed. Everything else changed smoothly because
   * everything else changes instantly underneath the cross-fade, which is
   * exactly what these need to do too.
   */
  const transition = document.startViewTransition(() => {
    root.classList.add('theme-switching')
    stamp(theme)
  })

  void transition.finished.finally(() => root.classList.remove('theme-switching'))
}

export interface ThemeSource {
  get: () => Promise<ResolvedTheme>
  onChange: (cb: (theme: ResolvedTheme) => void) => () => void
}

/**
 * Both preload surfaces expose this shape — the widget's included.
 *
 * `crossfade` is opt-in rather than the default because the widget window is
 * transparent (§6.2): a view transition there cross-fades two part-transparent
 * snapshots over whatever the user is dictating into. The main window opts in;
 * the widget takes the instant stamp.
 */
export function useTheme(source: ThemeSource, crossfade = false): void {
  useEffect(() => {
    const apply = (theme: ResolvedTheme) => applyTheme(theme, crossfade)
    void source.get().then(apply)
    return source.onChange(apply)
  }, [source, crossfade])
}

/**
 * The same value as state, for UI that has to SHOW which theme is on — the
 * title bar's toggle. `useTheme` writes to the DOM and returns nothing, so a
 * component that needs to render against the answer cannot use it.
 *
 * The initial read comes off the stamped attribute rather than defaulting to
 * light: `useTheme` runs first and the main process already painted the window
 * background, so guessing here would show the wrong icon for one frame on a
 * dark install.
 */
export function useResolvedTheme(source: ThemeSource): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light',
  )

  useEffect(() => {
    void source.get().then(setTheme)
    return source.onChange(setTheme)
  }, [source])

  return theme
}
