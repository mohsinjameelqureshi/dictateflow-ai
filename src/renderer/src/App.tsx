import { useCallback, useEffect, useState } from 'react'
import type { AppRoute } from '@shared/types.js'
import { useTheme } from './lib/theme.js'
import { Sidebar } from './app/sidebar.js'
import { TitleBar } from './app/title-bar.js'
import { HistoryPage } from './features/dictation/history-page.js'
import { DictionaryPage } from './features/dictionary/dictionary-page.js'
import { InsightsPage } from './features/insights/insights-page.js'
import { TransformPage } from './features/transform/transform-page.js'

/**
 * Whether the sidebar is collapsed is a per-window view preference, not app
 * data — it does not belong in the settings table, which is read by the main
 * process and shared across windows. localStorage also reads synchronously,
 * so the rail does not render expanded and then snap narrow on first paint.
 */
const SIDEBAR_KEY = 'wispr.sidebarCollapsed'

/**
 * Plain state routing. There are two destinations and no URLs to preserve, so
 * a router would be weight without benefit. Settings is not among them — it
 * is its own window. Revisit if deep links appear.
 */
export default function App() {
  const [route, setRoute] = useState<AppRoute>('history')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')

  useTheme(window.wispr.theme)
  useEffect(() => window.wispr.app.onNavigate(setRoute), [])
  useEffect(() => localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'), [collapsed])

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
        />
        <main className="min-w-0 flex-1 bg-panel">
          {route === 'history' && <HistoryPage />}
          {route === 'dictionary' && <DictionaryPage />}
          {route === 'transform' && <TransformPage />}
          {route === 'insights' && <InsightsPage />}
        </main>
      </div>
    </div>
  )
}
