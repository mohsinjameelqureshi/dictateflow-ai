import { BarChart3, History, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils.js'

export type Route = 'history' | 'insights' | 'settings'

interface Item {
  id: Route
  label: string
  icon: LucideIcon
}

const ITEMS: Item[] = [
  { id: 'history', label: 'History', icon: History },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]

/**
 * §12 — icon + label, subtle active state. The nav list is deliberately short
 * and top-aligned: Dictionary, Snippets and Style get added here later
 * without a redesign.
 */
export function Sidebar({
  route,
  onNavigate,
}: {
  route: Route
  onNavigate: (r: Route) => void
}) {
  return (
    <nav
      aria-label="Main"
      className="flex w-52 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3"
    >
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const active = route === id
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-muted hover:bg-line-soft hover:text-ink',
            )}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
