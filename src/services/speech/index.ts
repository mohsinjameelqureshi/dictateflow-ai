import { GroqSpeechProvider } from './groq.js'
import { MoonshineSpeechProvider } from './moonshine.js'
import { SpeechError, type SpeechProvider } from './types.js'

export * from './types.js'

/**
 * Provider factory (§7). Two implementations now: Groq in the cloud, and
 * Moonshine on this machine.
 *
 * Instances are cached because §15.1 rests on connection reuse for Groq —
 * building a provider per dictation would pay DNS + TCP + TLS every time and
 * quietly undo the optimisation. Moonshine is cached for the same shape rather
 * than the same reason: it holds no state, but the model behind it does, and
 * that lives in the utilityProcess for the life of the app.
 */
let groq: GroqSpeechProvider | null = null
let moonshine: MoonshineSpeechProvider | null = null

export function getSpeechProvider(providerId: string, apiKey: string | null): SpeechProvider {
  switch (providerId) {
    case 'moonshine':
      // Deliberately reached WITHOUT checking for an API key. The local engine
      // needs no account, and the missing-key error used to be thrown before
      // this switch — which would have made "no key" the failure mode of an
      // engine that has nothing to authenticate against.
      return (moonshine ??= new MoonshineSpeechProvider())

    case 'groq':
    default: {
      if (!apiKey) {
        throw new SpeechError('no-key', 'Add your Groq API key in Settings.')
      }
      if (groq) groq.setApiKey(apiKey)
      else groq = new GroqSpeechProvider(apiKey)
      return groq
    }
  }
}

/** Called when the key changes or is cleared, so the next call rebuilds. */
export function resetSpeechProvider(): void {
  groq = null
}
