import { useEffect, useState } from 'react'
import {
  Database,
  Info,
  Mic,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { TitleBar } from '@/app/title-bar.js'
import { useTheme } from '@/lib/theme.js'
import { cn } from '@/lib/utils.js'
import type { SettingsTab } from '@shared/types.js'
import { AboutTab } from './about-tab.js'
import { DataTab } from './data-tab.js'
import { GeneralTab } from './general-tab.js'
import { TranscriptionTab } from './transcription-tab.js'
import { useSettings } from './use-settings.js'

/**
 * Settings, as its own window (see main/windows/settings-window.ts).
 *
 * A third renderer entry point rather than a route in the main window: it is a
 * different window with different rules, the same reason the widget is one.
 */
const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'transcription', label: 'Transcription', icon: Mic },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'about', label: 'About', icon: Info },
]

export function SettingsApp() {
  const [tab, setTab] = useState<SettingsTab>('general')
  const store = useSettings()

  useTheme(window.wispr.theme)

  // The tray, or the main window, can ask for a specific tab.
  useEffect(() => window.wispr.settings.onNavigate(setTab), [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar title="Settings" maximizable={false} />

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings"
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
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

        <main className="min-w-0 flex-1 overflow-y-auto bg-surface px-8 py-8">
          {store.error && (
            <p className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <TriangleAlert size={14} className="shrink-0" />
              {store.error}
            </p>
          )}

          {tab === 'general' && <GeneralTab {...store} />}
          {tab === 'transcription' && <TranscriptionTab {...store} />}
          {tab === 'data' && <DataTab />}
          {tab === 'about' && <AboutTab />}
        </main>
      </div>
    </div>
  )
}
