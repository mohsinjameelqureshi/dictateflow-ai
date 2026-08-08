import { Minus, Moon, PanelLeftClose, PanelLeftOpen, Square, Sun, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip.js'
import { useResolvedTheme } from '@/lib/theme.js'
import { cn } from '@/lib/utils.js'

/**
 * Custom title bar (§12). The window is frameless, so this provides both the
 * drag region and the window controls.
 *
 * Windows control order is minimise / maximise / close, left to right — do
 * not "tidy" it into macOS order.
 *
 * It carried a `title` and a `maximizable` flag while Settings was a second,
 * non-resizable window. Settings is a dialog now, this bar has exactly one
 * caller, and both props were branches nothing could reach.
 *
 * No wordmark in the leading slot: the name is carried by the sidebar's brand
 * lockup, so repeating it here would be a second wordmark two centimetres
 * away. The slot holds the sidebar toggle instead.
 *
 * It paints no background and carries no bottom border: it sits ON the window
 * ground, and the blocks below are what the gap separates it from. A border
 * here would draw a line the panelled layout has already made unnecessary.
 */
export function TitleBar({ sidebar }: { sidebar: { collapsed: boolean; onToggle: () => void } }) {
  const [maximized, setMaximized] = useState(false)
  const theme = useResolvedTheme(window.typeflow.theme)

  useEffect(() => {
    void window.typeflow.window.isMaximized().then(setMaximized)
  }, [])

  const controls = [
    {
      label: 'Minimize',
      icon: Minus,
      onClick: () => void window.typeflow.window.minimize(),
      danger: false,
    },
    {
      label: maximized ? 'Restore' : 'Maximize',
      icon: maximized ? Copy : Square,
      onClick: () => void window.typeflow.window.maximize().then(setMaximized),
      danger: false,
    },
    {
      label: 'Close',
      icon: X,
      onClick: () => void window.typeflow.window.close(),
      danger: true,
    },
  ]

  const toggleLabel = sidebar.collapsed ? 'Show sidebar' : 'Hide sidebar'

  /**
   * A two-way switch, so it writes 'light' or 'dark' and never 'system' —
   * clicking it is the user naming a theme, which is exactly what dropping
   * 'system' means. Settings keeps the three-way choice for putting it back.
   *
   * The icon shows what the click WILL do, not what is on (§12: a button's
   * label matches its result), and it renders from the value the main process
   * broadcast rather than from local state — so if the write fails, the icon
   * simply does not flip instead of lying about the theme.
   */
  const dark = theme === 'dark'
  const themeLabel = dark ? 'Switch to light mode' : 'Switch to dark mode'
  const ThemeIcon = dark ? Sun : Moon

  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between pl-1.5">
      <div className="no-drag flex items-center gap-0.5">
        <Tooltip label={themeLabel}>
          <button
            onClick={() => {
              void window.typeflow.settings.set('theme', dark ? 'light' : 'dark').catch(() => {})
            }}
            aria-label={themeLabel}
            className="flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-line-soft hover:text-ink"
          >
            <ThemeIcon size={16} strokeWidth={2} />
          </button>
        </Tooltip>

        <Tooltip label={toggleLabel}>
          <button
            onClick={sidebar.onToggle}
            aria-label={toggleLabel}
            aria-expanded={!sidebar.collapsed}
            aria-controls="app-sidebar"
            className="flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-line-soft hover:text-ink"
          >
            {sidebar.collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={2} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={2} />
            )}
          </button>
        </Tooltip>
      </div>

      <div className="no-drag flex h-full">
        {controls.map(({ label, icon: Icon, onClick, danger }) => (
          <Tooltip key={label} label={label} className="h-full">
            <button
              onClick={onClick}
              aria-label={label}
              className={cn(
                'flex h-full w-12 items-center justify-center text-ink-muted transition-colors',
                danger
                  ? 'hover:bg-danger hover:text-on-solid'
                  : 'hover:bg-line-soft hover:text-ink',
              )}
            >
              <Icon size={14} strokeWidth={2} />
            </button>
          </Tooltip>
        ))}
      </div>
    </header>
  )
}
