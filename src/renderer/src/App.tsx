import { useCallback, useEffect, useState } from 'react'
import type { AppRoute } from '@shared/types.js'
import { useTheme } from './lib/theme.js'
import { Sidebar } from './app/sidebar.js'
import { TitleBar } from './app/title-bar.js'
import { HistoryPage } from './features/dictation/history-page.js'
import { DictionaryPage } from './features/dictionary/dictionary-page.js'
import { InsightsPage } from './features/insights/insights-page.js'
import { SettingsDialog } from './features/settings/settings-dialog.js'
import { useSettingsDialog } from './features/settings/store.js'
import { TransformPage } from './features/transform/transform-page.js'

/**
 * Whether the sidebar is collapsed is a per-window view preference, not app
 * data — it does not belong in the settings table, which is read by the main
 * process and shared across windows. localStorage also reads synchronously,
 * so the rail does not render expanded and then snap narrow on first paint.
 */
const SIDEBAR_KEY = 'wispr.sidebarCollapsed'

/**
 * Plain state routing. There are four destinations and no URLs to preserve, so
 * a router would be weight without benefit. Settings is not among them — it is
 * a dialog over whichever page you were on, not a page you navigate away to.
 * Revisit if deep links appear.
 */
export default function App() {
  const [route, setRoute] = useState<AppRoute>('history')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')

  const settingsTab = useSettingsDialog((s) => s.tab)
  const openSettings = useSettingsDialog((s) => s.open)
  const closeSettings = useSettingsDialog((s) => s.close)

  useTheme(window.wispr.theme)
  useEffect(() => window.wispr.app.onNavigate(setRoute), [])
  useEffect(() => localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'), [collapsed])

  // The tray asks for Settings by naming a tab. That both opens the dialog and
  // selects within it — the request is "show me this", and it arrives whether
  // or not Settings is already up.
  useEffect(() => window.wispr.settings.onNavigate(openSettings), [openSettings])

  // One toggle, two triggers: the title bar button and the sidebar's own edge.
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar sidebar={{ collapsed, onToggle: toggleSidebar }} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          route={route}
          collapsed={collapsed}
          onNavigate={setRoute}
          onToggle={toggleSidebar}
          onOpenSettings={openSettings}
        />
        <main className="min-w-0 flex-1 bg-panel">
          {route === 'history' && <HistoryPage />}
          {route === 'dictionary' && <DictionaryPage />}
          {route === 'transform' && <TransformPage />}
          {route === 'insights' && <InsightsPage />}
        </main>
      </div>

      {settingsTab && (
        <SettingsDialog tab={settingsTab} onTab={openSettings} onClose={closeSettings} />
      )}
    </div>
  )
}
