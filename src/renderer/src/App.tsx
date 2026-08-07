import { useEffect, useState } from 'react'
import type { AppRoute } from '@shared/types.js'
import { Sidebar } from './app/sidebar.js'
import { TitleBar } from './app/title-bar.js'
import { HistoryPage } from './features/dictation/history-page.js'
import { DictionaryPage } from './features/dictionary/dictionary-page.js'
import { InsightsPage } from './features/insights/insights-page.js'

/**
 * Plain state routing. There are two destinations and no URLs to preserve, so
 * a router would be weight without benefit. Settings is not among them — it
 * is its own window. Revisit if deep links appear.
 */
export default function App() {
  const [route, setRoute] = useState<AppRoute>('history')

  useEffect(() => window.wispr.app.onNavigate(setRoute), [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} onNavigate={setRoute} />
        <main className="min-w-0 flex-1 bg-panel">
          {route === 'history' && <HistoryPage />}
          {route === 'dictionary' && <DictionaryPage />}
          {route === 'insights' && <InsightsPage />}
        </main>
      </div>
    </div>
  )
}
