import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types.js'
import { Fact, Section } from './parts.js'

export function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.wispr.app.info().then(setInfo)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Wispr AI"
        description="Local-first dictation. Your history and settings never leave this machine — only the audio clip goes out, to Groq, to be transcribed."
      >
        {info && (
          <>
            <Fact label="Version" value={info.version} />
            <Fact label="Electron" value={info.electron} />
            <Fact label="Chromium" value={info.chrome} />
            <Fact label="Node" value={info.node} />
            <Fact label="Platform" value={info.platform} />
            <Fact label="Data folder" value={info.dbPath} />
          </>
        )}
      </Section>
    </div>
  )
}
