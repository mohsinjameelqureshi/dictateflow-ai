import { Minus, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils.js'

/**
 * Custom title bar (§12). The window is frameless, so this provides both the
 * drag region and the window controls.
 *
 * Windows control order is minimise / maximise / close, left to right — do
 * not "tidy" it into macOS order.
 */
export function TitleBar() {
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

  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface pl-5">
      <span className="text-[13px] font-medium tracking-tight text-ink-muted">Wispr AI</span>

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
