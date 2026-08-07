import { Minus, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils.js'

/**
 * Custom title bar (§12). The window is frameless, so this provides both the
 * drag region and the window controls.
 *
 * Windows control order is minimise / maximise / close, left to right — do
 * not "tidy" it into macOS order.
 *
 * Shared with the settings window, which is not resizable — a maximise button
 * that does nothing is worse than one that is absent.
 */
export function TitleBar({
  title = 'Wispr AI',
  maximizable = true,
}: {
  title?: string
  maximizable?: boolean
} = {}) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (maximizable) void window.wispr.window.isMaximized().then(setMaximized)
  }, [maximizable])

  const controls = [
    {
      label: 'Minimize',
      icon: Minus,
      onClick: () => void window.wispr.window.minimize(),
      danger: false,
    },
    ...(maximizable
      ? [
          {
            label: maximized ? 'Restore' : 'Maximize',
            icon: maximized ? Copy : Square,
            onClick: () => void window.wispr.window.maximize().then(setMaximized),
            danger: false,
          },
        ]
      : []),
    {
      label: 'Close',
      icon: X,
      onClick: () => void window.wispr.window.close(),
      danger: true,
    },
  ]

  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface pl-5">
      <span className="text-[13px] font-medium tracking-tight text-ink-muted">{title}</span>

      <div className="no-drag flex h-full">
        {controls.map(({ label, icon: Icon, onClick, danger }) => (
          <button
            key={label}
            onClick={onClick}
            aria-label={label}
            title={label}
            className={cn(
              'flex h-full w-12 items-center justify-center text-ink-muted transition-colors',
              danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-line-soft hover:text-ink',
            )}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        ))}
      </div>
    </header>
  )
}
