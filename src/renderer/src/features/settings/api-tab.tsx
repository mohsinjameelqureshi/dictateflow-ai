import { ApiKeyCard } from './api-key-card.js'
import type { SettingsStore } from './use-settings.js'

export function ApiTab({ settings }: SettingsStore) {
  const local = settings?.speechProvider === 'moonshine'

  return (
    <div className="flex flex-col gap-4">
      {/* §2.4.5 — never present the key as an empty required field for an
          engine that has nothing to authenticate against. The card stays
          reachable because a saved key is the fallback when the local model is
          missing, and because switching back to Groq should not mean hunting
          for where the key went. */}
      {local && (
        <section className="rounded-panel border border-line bg-panel p-5">
          <h2 className="text-sm font-medium text-ink">No key needed</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Moonshine runs on this machine, so there is nothing to sign in to. A
            Groq key is only used if you switch engines back.
          </p>
        </section>
      )}
      <ApiKeyCard />
    </div>
  )
}
