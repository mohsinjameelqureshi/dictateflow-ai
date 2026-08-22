import Groq, {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from 'groq-sdk'
import {
  FALLBACK_TRANSFORM_MODELS,
  orderTransformModels,
  type KeyCheck,
  type TransformModel,
} from '../../shared/types.js'
import {
  TransformError,
  buildSystemPrompt,
  maxTokensFor,
  sanitizeModelOutput,
  type TransformOptions,
  type TransformProvider,
} from './types.js'

/**
 * Transform via Groq chat completions.
 *
 * The client is built once and reused, for the reason §3 established: ~95% of
 * a request's wall-clock was connection setup rather than compute, and a
 * per-call client pays that every time. This is a third Groq client in the
 * process (speech, enhance, transform) because each holds its own connection
 * pool and merging them would couple three unrelated features' lifetimes.
 */
export class GroqTransformProvider implements TransformProvider {
  readonly id = 'groq' as const
  readonly label = 'Groq'

  #client: Groq
  #apiKey: string
  #models: TransformModel[] | null = null

  constructor(apiKey: string) {
    this.#apiKey = apiKey
    this.#client = new Groq({ apiKey, maxRetries: 0 })
  }

  setApiKey(apiKey: string): void {
    if (apiKey === this.#apiKey) return
    this.#apiKey = apiKey
    this.#client = new Groq({ apiKey, maxRetries: 0 })
    this.#models = null
  }

  async transform(rule: string, text: string, opts: TransformOptions): Promise<string> {
    if (!this.#apiKey) throw new TransformError('no-key', 'Add your Groq API key in Settings.')

    try {
      const res = await this.#complete(rule, text, opts, true)
      const out = sanitizeModelOutput(res)
      if (!out) throw new TransformError('empty', 'The model returned nothing.')
      return out
    } catch (err) {
      throw classify(err)
    }
  }

  /**
   * One completion, optionally asking the model not to emit its reasoning.
   *
   * `reasoning_format: 'hidden'` is a best-effort optimisation, not the
   * guarantee — `sanitizeModelOutput` is what actually keeps a `<think>` block
   * out of the user's field, because it works on our side of the wire and does
   * not depend on any provider supporting any parameter.
   *
   * It is still worth sending. `max_tokens` is scaled to the INPUT length, so a
   * reasoning model left to think freely can spend the entire budget on its
   * scratchpad and return no answer at all — the parameter prevents a failure,
   * not just some wasted tokens.
   *
   * A model that rejects the parameter gets one retry without it, the same
   * narrow fallback the Gemini thinking budget uses.
   */
  async #complete(
    rule: string,
    text: string,
    opts: TransformOptions,
    suppressReasoning: boolean,
  ): Promise<string> {
    try {
      const res = await this.#client.chat.completions.create(
        {
          model: opts.model,
          // Not in the SDK's typed parameters, so it is spread in rather than
          // named. Groq documents it; the type package has not caught up.
          ...(suppressReasoning ? ({ reasoning_format: 'hidden' } as object) : {}),
          // Low but not zero. A transform is a rewrite, and 0 makes long
          // rewrites repetitive; the determinism argument that pins the STT
          // call at 0 does not apply to a step with no ground truth to
          // reproduce.
          temperature: 0.3,
          max_tokens: maxTokensFor(text),
          messages: [
            { role: 'system', content: buildSystemPrompt(rule) },
            { role: 'user', content: text },
          ],
        },
        { signal: opts.signal },
      )

      // A refusal or a filtered completion arrives as null rather than an
      // error. It must not reach the field as the string "null".
      return res.choices[0]?.message?.content ?? ''
    } catch (err) {
      // Narrow on purpose: only a definitive rejection of the parameter, and
      // only once. A 429, a dead network or an abort must never be retried.
      if (suppressReasoning && isParameterRejection(err)) {
        return this.#complete(rule, text, opts, false)
      }
      throw err
    }
  }

  /**
   * The account's chat models, asked for rather than hardcoded.
   *
   * Groq lists transcription and safety models on the same endpoint, and
   * offering `whisper-large-v3-turbo` in a text-rewrite picker would be a
   * setting that fails at the moment the user tries to use it.
   */
  async models(): Promise<TransformModel[]> {
    if (this.#models) return this.#models
    if (!this.#apiKey) return FALLBACK_TRANSFORM_MODELS.groq

    try {
      const res = await this.#client.models.list()
      const chat = orderTransformModels(
        res.data
          .map((m) => m.id)
          .filter((id): id is string => typeof id === 'string')
          .filter((id) => !/whisper|tts|guard|^distil-/i.test(id)),
        'groq',
      )

      if (chat.length === 0) return FALLBACK_TRANSFORM_MODELS.groq
      this.#models = chat
      return chat
    } catch {
      // Never fatal. A picker that cannot reach the provider still has to
      // offer something, or the setting is unusable while offline.
      return FALLBACK_TRANSFORM_MODELS.groq
    }
  }

  /**
   * Ask Groq whether this key works.
   *
   * Listing models is the cheapest authenticated call available and exercises
   * exactly the credential path a transform will use. Replaces the old `gsk_`
   * prefix check — see TransformProvider.verifyKey for why guessing at a key's
   * shape was the wrong instrument.
   */
  async verifyKey(): Promise<KeyCheck> {
    if (!this.#apiKey) return { state: 'rejected', problem: 'No key is saved.' }
    try {
      await this.#client.models.list()
      return { state: 'ok' }
    } catch (err) {
      const failure = classify(err)
      if (failure.kind === 'unauthorized') {
        return { state: 'rejected', problem: 'Groq rejected this key.' }
      }
      return { state: 'unreachable', problem: 'Saved, but Groq could not be reached to check it.' }
    }
  }
}

/**
 * Whether a failure is specifically "this model does not accept that
 * parameter", and therefore worth one retry without it.
 *
 * `reasoning_format` only applies to reasoning models; the rest reject it. The
 * predicate is deliberately narrow — a 429, a dead network or a user abort must
 * never be retried into a second failure, which is the same reason
 * `maxRetries: 0` is set on the client.
 */
function isParameterRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const status = (err as { status?: number } | null)?.status
  return status === 400 && /reasoning_format|reasoning|unsupported|unrecognized|not supported/i.test(message)
}

/** Same mapping as the speech provider, onto the same widget states (§11). */
function classify(err: unknown): TransformError {
  if (err instanceof TransformError) return err
  if (err instanceof APIUserAbortError) return new TransformError('cancelled', 'Cancelled.')
  if (err instanceof RateLimitError) {
    return new TransformError('rate-limited', 'Rate limited. Try again.')
  }
  if (err instanceof AuthenticationError) {
    return new TransformError('unauthorized', 'Groq rejected the API key.')
  }
  if (err instanceof APIConnectionError) return new TransformError('offline', 'No connection.')

  // AbortError arrives raw when the signal fires before the SDK wraps it.
  if (err instanceof Error && err.name === 'AbortError') {
    return new TransformError('cancelled', 'Cancelled.')
  }

  return new TransformError('failed', err instanceof Error ? err.message : String(err))
}
