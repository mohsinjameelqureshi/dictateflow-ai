import {
  FALLBACK_TRANSFORM_MODELS,
  NON_TEXT_MODEL_PATTERN,
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
 * Transform via Google Gemini, over plain `fetch`.
 *
 * No SDK. This is two REST calls against a stable versioned endpoint, and
 * `@google/genai` would add a dependency — with its own transitive tree and
 * its own release cadence — to a main process that already has global `fetch`
 * from Electron 43's Node. The cost of the SDK is real; the benefit here is a
 * JSON shape that fits on one screen.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * A generous ceiling, not a target.
 *
 * There is no retry and no visible progress: the widget shows a spinner and
 * the user's text is sitting in a variable in this process. A request that
 * hangs forever is indistinguishable from a crash, so it has to end.
 */
const TIMEOUT_MS = 60_000

interface GeminiPart {
  text?: string
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

interface GeminiModelEntry {
  name?: string
  displayName?: string
  supportedGenerationMethods?: string[]
}

export class GeminiTransformProvider implements TransformProvider {
  readonly id = 'gemini' as const
  readonly label = 'Google Gemini'

  #apiKey: string
  #models: TransformModel[] | null = null

  constructor(apiKey: string) {
    this.#apiKey = apiKey
  }

  setApiKey(apiKey: string): void {
    if (apiKey === this.#apiKey) return
    this.#apiKey = apiKey
    this.#models = null
  }

  async transform(rule: string, text: string, opts: TransformOptions): Promise<string> {
    if (!this.#apiKey) throw new TransformError('no-key', 'Add your Gemini API key in Settings.')

    const build = (thinking: boolean): unknown => ({
      // The rule goes in `systemInstruction`, never concatenated into the user
      // turn. Gemini treats the two differently, and the separation is the
      // whole prompt-injection defence — see buildSystemPrompt.
      systemInstruction: { parts: [{ text: buildSystemPrompt(rule) }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokensFor(text),
        // MEASURED: 1.57s -> 690ms on gemini-2.5-flash, for identical quality.
        // A transform is a rewrite, not a reasoning task — thinking tokens here
        // are pure latency, and the user is watching a spinner for every one of
        // them. §3 budgets 800–1200ms perceived; the default blows through it.
        ...(thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    })

    const url = `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`

    let res: GeminiResponse
    try {
      res = await this.#post<GeminiResponse>(url, build(false), opts.signal)
    } catch (err) {
      // Not every model accepts a zero thinking budget — some reasoning models
      // require one, and reject the request outright. Retrying without it costs
      // one round trip on those models and keeps them USABLE, rather than
      // bricking a model choice for the sake of an optimisation.
      //
      // Narrow on purpose: only a definitive rejection, and only once. A 429, a
      // dead network or an abort must not be retried into a second failure.
      if (!isThinkingRejection(err)) throw err
      res = await this.#post<GeminiResponse>(url, build(true), opts.signal)
    }

    const candidate = res.candidates?.[0]

    // A safety block comes back as a 200 with no candidate. Left unhandled it
    // reaches the field as an empty paste, which reads as the app losing the
    // user's text rather than the model declining to rewrite it.
    if (!candidate) {
      const reason = res.promptFeedback?.blockReason
      throw new TransformError(
        'empty',
        reason ? `Gemini declined this text (${reason}).` : 'Gemini returned nothing.',
      )
    }

    const out = sanitizeModelOutput(
      (candidate.content?.parts ?? []).map((p) => p.text ?? '').join(''),
    )

    if (!out) {
      // MAX_TOKENS with no text at all means the whole budget went to thinking.
      const hint =
        candidate.finishReason === 'MAX_TOKENS'
          ? 'Gemini ran out of room. Try a shorter selection.'
          : 'Gemini returned nothing.'
      throw new TransformError('empty', hint)
    }

    return out
  }

  /**
   * The models this key can actually call, asked for rather than hardcoded.
   *
   * A hardcoded list of Gemini model ids is wrong within months — the ids
   * carry a version number and the old ones are retired. Asking means the
   * picker is right the day Google ships something new and the day they
   * remove something old, with no release from us.
   */
  async models(): Promise<TransformModel[]> {
    if (this.#models) return this.#models
    if (!this.#apiKey) return FALLBACK_TRANSFORM_MODELS.gemini

    try {
      const res = await this.#get<{ models?: GeminiModelEntry[] }>(`${BASE}/models?pageSize=200`)

      const named = (res.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
        // Image, music, robotics, computer-use, research-agent and native-audio
        // models all answer `generateContent` and all carry the same metadata
        // shape as a chat model — VERIFIED against the live list, there is no
        // structural field that separates them. The name is the only signal.
        // See NON_TEXT_MODEL_PATTERN for why this is a convenience, not a
        // guarantee.
        .filter((id) => !NON_TEXT_MODEL_PATTERN.test(id))
      const usable = orderTransformModels(named, 'gemini')

      if (usable.length === 0) return FALLBACK_TRANSFORM_MODELS.gemini
      this.#models = usable
      return usable
    } catch {
      return FALLBACK_TRANSFORM_MODELS.gemini
    }
  }

  /**
   * Ask Google whether this key works.
   *
   * The cheapest authenticated call there is — listing models costs no tokens
   * and no quota worth worrying about, and it exercises exactly the credential
   * path a transform will use.
   */
  async verifyKey(): Promise<KeyCheck> {
    if (!this.#apiKey) return { state: 'rejected', problem: 'No key is saved.' }
    try {
      await this.#get<{ models?: GeminiModelEntry[] }>(`${BASE}/models?pageSize=1`)
      return { state: 'ok' }
    } catch (err) {
      if (err instanceof TransformError && err.kind === 'unauthorized') {
        return { state: 'rejected', problem: 'Google rejected this key.' }
      }
      return {
        state: 'unreachable',
        problem: 'Saved, but Google could not be reached to check it.',
      }
    }
  }

  /* ----------------------------------------------------------- http ---- */

  #headers(): Record<string, string> {
    // Header rather than a `?key=` query parameter: a URL carrying a secret
    // ends up in error messages, logs and stack traces. A header does not.
    return { 'x-goog-api-key': this.#apiKey, 'content-type': 'application/json' }
  }

  async #post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.#send<T>(url, { method: 'POST', body: JSON.stringify(body) }, signal)
  }

  async #get<T>(url: string): Promise<T> {
    return this.#send<T>(url, { method: 'GET' })
  }

  async #send<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    // The caller's signal (Esc) and the timeout both have to be able to end
    // this. `AbortSignal.any` composes them without either one needing to know
    // about the other.
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    let res: Response
    try {
      res = await fetch(url, { ...init, headers: this.#headers(), signal: combined })
    } catch (err) {
      // Distinguishing the two aborts matters: one is the user pressing Esc,
      // the other is a request that never came back. They are different states
      // on the widget and different things for the user to do next.
      if (signal?.aborted) throw new TransformError('cancelled', 'Cancelled.')
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new TransformError('failed', 'Gemini did not respond. Try again.')
      }
      throw new TransformError('offline', 'No connection.')
    }

    if (!res.ok) throw await httpError(res)

    try {
      return (await res.json()) as T
    } catch {
      throw new TransformError('failed', 'Gemini sent a reply that could not be read.')
    }
  }
}

/**
 * Whether a failure is specifically "this model will not accept that thinking
 * budget", and therefore worth one retry without it.
 *
 * Deliberately narrow. A 429, a dead network or a user abort must never be
 * retried into a second failure — the point of `maxRetries: 0` everywhere else
 * in this app is that the user sees the real problem immediately.
 */
function isThinkingRejection(err: unknown): boolean {
  return (
    err instanceof TransformError &&
    err.kind === 'failed' &&
    /thinking|thought|budget/i.test(err.message)
  )
}

/**
 * Map an HTTP status onto the same widget states the Groq path uses (§11).
 *
 * Gemini puts a human-readable reason in `error.message`, and it is genuinely
 * useful — "API key not valid" versus "quota exceeded for this model" send the
 * user to two different places. Read it when the status alone is ambiguous.
 */
async function httpError(res: Response): Promise<TransformError> {
  let detail = ''
  try {
    const body = (await res.json()) as GeminiResponse
    detail = body.error?.message ?? ''
  } catch {
    // A non-JSON error body (a proxy's HTML page) tells us nothing the status
    // does not already say.
  }

  if (res.status === 429) return new TransformError('rate-limited', 'Rate limited. Try again.')
  if (res.status === 401 || res.status === 403) {
    return new TransformError('unauthorized', 'Gemini rejected the API key.')
  }
  if (res.status === 400 && /API key/i.test(detail)) {
    return new TransformError('unauthorized', 'Gemini rejected the API key.')
  }
  if (res.status === 404) {
    return new TransformError('failed', 'That Gemini model is unavailable. Pick another in Settings.')
  }
  if (res.status >= 500) return new TransformError('failed', 'Gemini is having trouble. Try again.')

  return new TransformError('failed', detail || `Gemini returned ${res.status}.`)
}
