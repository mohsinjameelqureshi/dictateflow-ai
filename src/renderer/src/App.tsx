import { useCallback, useEffect, useState } from 'react'
import type { AppRoute } from '@shared/types.js'
import { useTheme } from './lib/theme.js'
import { Sidebar, SidebarHandle } from './app/sidebar.js'
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
const SIDEBAR_KEY = 'dictateflow.sidebarCollapsed'

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

  // `true` — the main window cross-fades theme changes; the widget does not.
  useTheme(window.dictateflow.theme, true)
  useEffect(() => window.dictateflow.app.onNavigate(setRoute), [])
  useEffect(() => localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'), [collapsed])

  // The tray asks for Settings by naming a tab. That both opens the dialog and
  // selects within it — the request is "show me this", and it arrives whether
  // or not Settings is already up.
  useEffect(() => window.dictateflow.settings.onNavigate(openSettings), [openSettings])

  // One toggle, two triggers: the title bar button and the sidebar's own edge.
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), [])

  return (
    // Panelled layout: the window itself is the ground (`surface`), and the
    // sidebar and the content each float on it as their own rounded block. The
    // gap between them is what separates the two regions, which is why neither
    // block needs a shared border — remove the padding here and the seam has to
    // come back as a divider line. That gap is also the collapse toggle; see
    // SidebarHandle.
    <div className="flex h-full flex-col bg-surface">
      <TitleBar sidebar={{ collapsed, onToggle: toggleSidebar }} />
      {/* No `gap` here: SidebarHandle is the gap, so that space is clickable
          rather than dead. */}
      <div className="flex min-h-0 flex-1 p-2 pt-0">
        <Sidebar
          route={route}
          collapsed={collapsed}
          onNavigate={setRoute}
          onOpenSettings={openSettings}
        />
        <SidebarHandle onToggle={toggleSidebar} />
        {/* `overflow-hidden` is load-bearing, not tidiness: the pages scroll,
            and without it the scrolled content paints over the rounded
            corners. */}
        <main className="min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-panel">
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
