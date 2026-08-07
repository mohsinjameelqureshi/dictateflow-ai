import { BarChart3, BookMarked, History, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils.js'
import type { AppRoute } from '@shared/types.js'

interface Item {
  id: AppRoute
  label: string
  icon: LucideIcon
}

const ITEMS: Item[] = [
  { id: 'history', label: 'History', icon: History },
  { id: 'dictionary', label: 'Dictionary', icon: BookMarked },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
]

const itemClass = (active: boolean) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
    active
      ? 'bg-accent-soft font-medium text-accent'
      : 'text-ink-muted hover:bg-line-soft hover:text-ink',
  )

/**
 * §12 — icon + label, subtle active state. The nav list is deliberately short
 * and top-aligned: Dictionary, Snippets and Style get added here later
 * without a redesign.
 *
 * Settings sits apart at the bottom because it is not a destination in this
 * window — it opens a window of its own.
 */
export function Sidebar({
  route,
  onNavigate,
}: {
  route: AppRoute
  onNavigate: (r: AppRoute) => void
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
            className={itemClass(active)}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </button>
        )
      })}

      <button
        onClick={() => void window.wispr.settings.open()}
        className={cn(itemClass(false), 'mt-auto')}
      >
        <Settings size={16} strokeWidth={2} />
        Settings
      </button>
    </nav>
  )
}
