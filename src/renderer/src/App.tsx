import { useEffect, useState } from 'react'
import { Sidebar, type Route } from './app/sidebar.js'
import { TitleBar } from './app/title-bar.js'
import { HistoryPage } from './features/dictation/history-page.js'
import { InsightsPage } from './features/insights/insights-page.js'
import { SettingsPage } from './features/settings/settings-page.js'

/**
 * Plain state routing. There are three destinations and no URLs to preserve,
 * so a router would be weight without benefit. Revisit if deep links appear.
 */
export default function App() {
  const [route, setRoute] = useState<Route>('history')

  // The tray's "Settings" entry navigates from the main process.
  useEffect(() => window.wispr.app.onNavigate(setRoute), [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} onNavigate={setRoute} />
        <main className="min-w-0 flex-1 bg-panel">
          {route === 'history' && <HistoryPage />}
          {route === 'insights' && <InsightsPage />}
          {route === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
