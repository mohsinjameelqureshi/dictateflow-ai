import { useEffect, useState } from 'react'
import { Page } from '@/components/page.js'
import type { AppInfo, Settings } from '@shared/types.js'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line-soft py-3 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="selectable text-right font-mono text-xs text-ink">{value}</span>
    </div>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.wispr.settings.getAll().then(setSettings)
    void window.wispr.app.info().then(setInfo)
  }, [])

  return (
    <Page
      title="Settings"
      description="Full controls arrive in Phase 5. These are the stored defaults."
    >
      <section className="rounded-panel border border-line bg-panel px-5 py-1">
        <h2 className="sr-only">Stored settings</h2>
        {Object.entries(settings).map(([k, v]) => (
          <Row key={k} label={k} value={v === '' ? '(unset)' : String(v)} />
        ))}
      </section>

      {info && (
        <section className="mt-4 rounded-panel border border-line bg-panel px-5 py-1">
          <h2 className="sr-only">About</h2>
          <Row label="Version" value={info.version} />
          <Row label="Electron" value={info.electron} />
          <Row label="Chromium" value={info.chrome} />
          <Row label="Node" value={info.node} />
          <Row label="Data folder" value={info.dbPath} />
        </section>
      )}
    </Page>
  )
}
