import {
  Database,
  FlaskConical,
  Info,
  Key,
  Mic,
  SlidersHorizontal,
  TriangleAlert,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog.js'
import { cn } from '@/lib/utils.js'
import type { SettingsTab } from '@shared/types.js'
import { AboutTab } from './about-tab.js'
import { ApiTab } from './api-tab.js'
import { DataTab } from './data-tab.js'
import { ExperimentalTab } from './experimental-tab.js'
import { GeneralTab } from './general-tab.js'
import { TranscriptionTab } from './transcription-tab.js'
import { TransformTab } from './transform-tab.js'
import { useSettings } from './use-settings.js'

/**
 * Settings, as a dialog over the main window.
 *
 * It was a third renderer entry point and its own BrowserWindow. It is neither
 * now: a second window meant a second taskbar entry, a second title bar, and a
 * surface to hunt for behind the main window every time. The content is
 * otherwise unchanged — the same tabs in the same rail.
 *
 * The rail stays a rail rather than becoming a row of tabs across the top, so
 * Settings keeps the same room to grow that §12 asks of the main sidebar.
 *
 * Mounted only while open, so the settings read and the microphone
 * enumeration happen when the user asks for Settings rather than on every
 * launch.
 */
const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'transcription', label: 'Transcription', icon: Mic },
  // Reads in order: what turns speech into text, what rewrites text, then the
  // keys both of them use. Same mark as the sidebar's Transform entry.
  { id: 'transform', label: 'Transform', icon: WandSparkles },
  { id: 'api', label: 'API', icon: Key },
  { id: 'data', label: 'Data', icon: Database },
  // Last before About, because nothing here is load-bearing and the rail reads
  // top to bottom in order of how settled a thing is.
  { id: 'experimental', label: 'Experimental', icon: FlaskConical },
  { id: 'about', label: 'About', icon: Info },
]

export function SettingsDialog({
  tab,
  onTab,
  onClose,
}: {
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onClose: () => void
}) {
  const store = useSettings()

  return (
    <Dialog open onClose={onClose} title="Settings" className="h-[640px] max-w-[880px]">
      {/* Same panelled layout as the main window: the dialog panel is the
          ground, and the rail and the tab content each float on it as their own
          block. The gap is the separator, so the rail drops its `border-r`. */}
      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-0">
        <nav
          aria-label="Settings"
          className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto rounded-panel border border-line bg-panel p-3"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => onTab(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  // Same selected treatment as the main sidebar — one rail
                  // pattern, not two.
                  active
                    ? 'bg-selected font-medium text-ink'
                    : 'text-ink-muted hover:bg-line-soft hover:text-ink',
                )}
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </button>
            )
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto rounded-panel border border-line bg-panel px-8 py-8">
          {store.error && (
            <p className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <TriangleAlert size={14} className="shrink-0" />
              {store.error}
            </p>
          )}

          {tab === 'general' && <GeneralTab {...store} />}
          {tab === 'transcription' && <TranscriptionTab {...store} />}
          {tab === 'transform' && <TransformTab {...store} />}
          {tab === 'api' && <ApiTab {...store} />}
          {tab === 'data' && <DataTab {...store} />}
          {tab === 'experimental' && <ExperimentalTab {...store} />}
          {tab === 'about' && <AboutTab />}
        </main>
      </div>
    </Dialog>
  )
}
