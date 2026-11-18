import type { SessionIssue, SessionIssueState, WidgetStatePayload } from '../shared/types.js'

const DEFAULT_MESSAGES: Record<SessionIssueState, string> = {
  error: 'The action could not finish. Check your microphone, engine, and API settings, then try again.',
  offline: 'The cloud service could not be reached. Check your connection and try again.',
  'rate-limited': 'The provider is receiving too many requests. Wait a moment and try again.',
  blocked: 'Windows prevented typing into the target window. Try a window running with the same permissions as DictateFlow.',
  'no-speech': 'No speech was detected. Check the selected microphone and hold the shortcut while speaking.',
  'no-text': 'No text was available to transform. Select text in an editable field and try the shortcut again.',
}

let issues: SessionIssue[] = []
let nextId = 0

export function listSessionIssues(): SessionIssue[] {
  return [...issues]
}

export function clearSessionIssues(): void {
  issues = []
}

export function recordSessionIssue(payload: WidgetStatePayload): SessionIssue[] | null {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_MESSAGES, payload.state)) return null
  const state = payload.state as SessionIssueState
  const issue: SessionIssue = {
    id: ++nextId,
    createdAt: Date.now(),
    source: payload.source ?? 'dictation',
    state,
    message: payload.message?.trim() || (
      state === 'blocked' && payload.source === 'dictation'
        ? `${DEFAULT_MESSAGES[state]} Your transcript is saved in Dictation, where you can copy it manually.`
        : DEFAULT_MESSAGES[state]
    ),
    ...(payload.detail ? { detail: payload.detail } : {}),
  }
  issues = [issue, ...issues].slice(0, 20)
  return listSessionIssues()
}
