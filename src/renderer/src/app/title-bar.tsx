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
 * Shared with the settings window, which is not resizable — a maximise button
 * that does nothing is worse than one that is absent.
 *
 * The leading slot is either the window title or the sidebar toggle, never
 * both. In the main window the name is carried by the sidebar's brand lockup,
 * so repeating it here would be a second wordmark two centimetres away.
 * Settings has no sidebar and keeps the title.
 */
export function TitleBar({
  title = 'Wispr AI',
  maximizable = true,
  sidebar,
}: {
  title?: string
  maximizable?: boolean
  sidebar?: { collapsed: boolean; onToggle: () => void }
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

  const toggleLabel = sidebar?.collapsed ? 'Show sidebar' : 'Hide sidebar'

  return (
    <header
      className={cn(
        'drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface',
        // The toggle is a hit target and carries its own padding; the title is
        // text and needs the indent.
        sidebar ? 'pl-1.5' : 'pl-5',
      )}
    >
      {sidebar ? (
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
      ) : (
        <span className="text-[13px] font-medium tracking-tight text-ink-muted">{title}</span>
      )}

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
