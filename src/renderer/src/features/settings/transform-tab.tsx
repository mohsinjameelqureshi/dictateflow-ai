import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  TRANSFORM_PROVIDERS,
  TRANSFORM_PROVIDER_IDS,
  isTransformProvider,
  type TransformModel,
  type TransformProviderId,
} from '@shared/types.js'
import { ApiKeyCard } from './api-key-card.js'
import { Row, Section, Select } from './parts.js'
import type { SettingsStore } from './use-settings.js'

/**
 * Settings → Transform (docs/transform-feature-plan.md §1).
 *
 * One engine for every transform rule, deliberately. A per-rule provider would
 * mean two more controls on every row of the Transform page for a choice
 * nobody makes twice — and two more things to check when a transform starts
 * failing.
 *
 * The tab sits between Transcription and API because it reads in that order:
 * what turns speech into text, what rewrites text, and then the keys both use.
 */
export function TransformTab({ settings, save }: SettingsStore) {
  const raw = settings?.transformProvider ?? 'groq'
  const providerId: TransformProviderId = isTransformProvider(raw) ? raw : 'groq'
  const spec = TRANSFORM_PROVIDERS[providerId]

  const [models, setModels] = useState<TransformModel[] | null>(null)

  // Asked of the provider on every open rather than cached in the renderer: a
  // key added in the card below changes the answer, and a picker that needs a
  // restart to notice is a picker that looks broken.
  useEffect(() => {
    let live = true
    setModels(null)
    void window.dictateflow.transforms
      .models(providerId)
      .then((list) => {
        if (live) setModels(list)
      })
      .catch(() => {
        if (live) setModels([])
      })
    return () => {
      live = false
    }
  }, [providerId, settings?.transformProvider])

  const model = settings?.[spec.modelKey] ?? ''
  const local = settings?.speechProvider === 'moonshine'

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Engine"
        description="Which model rewrites your text when a transform runs. The same engine is used for every rule."
      >
        <Row label="Transform with" htmlFor="transform-provider" hint={spec.hint}>
          <Select
            id="transform-provider"
            value={providerId}
            onChange={(next) => void save('transformProvider', next)}
          >
            {TRANSFORM_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {TRANSFORM_PROVIDERS[id].label}
              </option>
            ))}
          </Select>
        </Row>

        <Row
          label="Model"
          htmlFor="transform-model"
          hint={
            models === null
              ? 'Asking the provider what it has…'
              : models.length === 0
                ? 'Could not reach the provider. Add a key, or try again.'
                : 'Read live from the provider, so a retired model never sits in this list.'
          }
        >
          <Select
            id="transform-model"
            value={model}
            disabled={models === null || models.length === 0}
            onChange={(next) => void save(spec.modelKey, next)}
          >
            {/* The stored value is offered even when the fetched list does not
                contain it. Dropping it would silently reassign the user's
                model the moment the provider renamed one. */}
            {models !== null && !models.some((m) => m.id === model) && model && (
              <option value={model}>{model} (not listed)</option>
            )}
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Row>
      </Section>

      {/* §4's argument, applied to a second cloud step. A Moonshine user chose
          local for a reason, and a transform is the one action in the app that
          leaves the machine anyway. Say it here rather than in a footnote. */}
      {local && (
        <section className="rounded-panel border border-line bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <TriangleAlert size={14} className="shrink-0 text-ink-subtle" />
            Transforms are not local
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            You transcribe on this machine with Moonshine, but both transform engines are cloud
            services. Text you transform is sent to {spec.label}. Dictation stays offline.
          </p>
        </section>
      )}

      {/* The key for the SELECTED engine, right where the choice was made.
          Both cards also live on the API tab, which is where someone goes
          looking for a key they have already set. */}
      <ApiKeyCard id={spec.secret} />
    </div>
  )
}
