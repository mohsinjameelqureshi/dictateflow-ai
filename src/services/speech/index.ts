import { GroqSpeechProvider } from './groq.js'
import { SpeechError, type SpeechProvider } from './types.js'

export * from './types.js'

/**
 * Provider factory (§7). One implementation ships in v1; the point of the
 * indirection is that adding Parakeet or local whisper.cpp touches this file
 * and nothing else.
 *
 * The instance is cached because §15.1 rests on connection reuse — building
 * a provider per dictation would pay DNS + TCP + TLS every time and quietly
 * undo the optimisation.
 */
let cached: GroqSpeechProvider | null = null

export function getSpeechProvider(providerId: string, apiKey: string | null): SpeechProvider {
  if (!apiKey) {
    throw new SpeechError('no-key', 'Add your Groq API key in Settings.')
  }

  switch (providerId) {
    case 'groq':
    default: {
      if (cached) cached.setApiKey(apiKey)
      else cached = new GroqSpeechProvider(apiKey)
      return cached
    }
  }
}

/** Called when the key changes or is cleared, so the next call rebuilds. */
export function resetSpeechProvider(): void {
  cached = null
}
