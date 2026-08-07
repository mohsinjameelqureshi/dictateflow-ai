import { Minus, PanelLeftClose, PanelLeftOpen, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip.js'
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
 */
export function TitleBar({ sidebar }: { sidebar: { collapsed: boolean; onToggle: () => void } }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.wispr.window.isMaximized().then(setMaximized)
  }, [])

  const controls = [
    {
      label: 'Minimize',
      icon: Minus,
      onClick: () => void window.wispr.window.minimize(),
      danger: false,
    },
    {
      label: maximized ? 'Restore' : 'Maximize',
      icon: maximized ? Copy : Square,
      onClick: () => void window.wispr.window.maximize().then(setMaximized),
      danger: false,
    },
    {
      label: 'Close',
      icon: X,
      onClick: () => void window.wispr.window.close(),
      danger: true,
    },
  ]

  const toggleLabel = sidebar.collapsed ? 'Show sidebar' : 'Hide sidebar'

  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface pl-1.5">
      <div className="no-drag flex items-center">
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
