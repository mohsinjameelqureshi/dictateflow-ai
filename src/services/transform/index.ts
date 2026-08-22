import {
  TRANSFORM_PROVIDERS,
  isTransformProvider,
  type KeyCheck,
  type SecretId,
  type TransformModel,
  type TransformProviderId,
} from '../../shared/types.js'
import { GeminiTransformProvider } from './gemini.js'
import { GroqTransformProvider } from './groq.js'
import { TransformError, type TransformProvider } from './types.js'

export * from './types.js'

/**
 * The transform provider factory (docs/transform-feature-plan.md §6).
 *
 * Cached per provider rather than rebuilt per call, for the reason §3
 * established about connection reuse — and because each provider memoises its
 * model list, which is the thing the settings picker reads on every open.
 *
 * Both instances are kept, not just the selected one. Switching provider in
 * Settings and switching back should not re-fetch two model lists and rebuild
 * two clients for a decision the user is visibly still making.
 */
const cache = new Map<TransformProviderId, TransformProvider>()

export function getTransformProvider(id: string, apiKey: string | null): TransformProvider {
  const providerId: TransformProviderId = isTransformProvider(id) ? id : 'groq'
  const key = apiKey ?? ''

  const existing = cache.get(providerId)
  if (existing) {
    existing.setApiKey(key)
    return existing
  }

  const created: TransformProvider =
    providerId === 'gemini' ? new GeminiTransformProvider(key) : new GroqTransformProvider(key)

  cache.set(providerId, created)
  return created
}

/**
 * Drop the cached clients. Called when either key changes — the cached
 * provider holds the old one, and its memoised model list was fetched with it.
 */
export function resetTransformProvider(): void {
  cache.clear()
}

/**
 * The models the picker should offer for a provider.
 *
 * Never throws: a picker with nothing in it is a setting the user cannot use,
 * and "we could not reach Groq just now" is not a reason to make the whole
 * Transform tab unusable. Each provider falls back to its static list.
 */
export function listTransformModels(
  id: TransformProviderId,
  apiKey: string | null,
): Promise<TransformModel[]> {
  return getTransformProvider(id, apiKey).models()
}

/**
 * Ask the provider that owns a secret whether the key works.
 *
 * Routed by SECRET id rather than provider id because that is what the caller
 * has — the API tab shows a card per secret and does not know or care which
 * transform provider is currently selected.
 *
 * Never throws. A verification that fails to verify is an answer, not an error.
 */
export function verifySecretKey(id: SecretId, apiKey: string | null): Promise<KeyCheck> {
  if (!apiKey) return Promise.resolve<KeyCheck>({ state: 'rejected', problem: 'No key is saved.' })
  const providerId: TransformProviderId = id === 'gemini' ? 'gemini' : 'groq'
  return getTransformProvider(providerId, apiKey).verifyKey()
}

/**
 * The reason this provider cannot run right now, or null.
 *
 * Checked BEFORE the field is cut, so a missing key costs the user nothing.
 * Discovering it afterwards would mean their text had already been removed and
 * then pasted back, which looks like the app malfunctioning rather than like a
 * setting that needs filling in.
 */
export function transformReadiness(
  id: TransformProviderId,
  apiKey: string | null,
): TransformError | null {
  if (apiKey) return null
  const spec = TRANSFORM_PROVIDERS[isTransformProvider(id) ? id : 'groq']
  return new TransformError('no-key', `Add your ${spec.label} in Settings.`)
}
