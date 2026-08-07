import { ApiKeyCard } from "./api-key-card.js";
import { Row, Section, Select } from "./parts.js";
import type { SettingsStore } from "./use-settings.js";

/**
 * Whisper takes an ISO-639-1 code. Naming the language skips detection and is
 * slightly faster; auto-detect is kept for anyone who switches mid-day.
 */
const LANGUAGES: [code: string, label: string][] = [
  ["", "Auto-detect"],
  ["en", "English"],
  ["ar", "Arabic"],
  ["zh", "Chinese"],
  ["nl", "Dutch"],
  ["fr", "French"],
  ["de", "German"],
  ["hi", "Hindi"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["es", "Spanish"],
  ["tr", "Turkish"],
  ["ur", "Urdu"],
];

export function TranscriptionTab({ settings, save }: SettingsStore) {
  return (
    <div className="flex flex-col gap-4">
      <ApiKeyCard />

      <Section title="Speech">
        <Row
          label="Provider"
          htmlFor="provider"
          hint="Only Groq is built so far."
        >
          {/* §7 — the provider interface exists so this becomes a real choice
              without a rewrite. One implementation is not yet a menu. */}
          <Select
            id="provider"
            value={settings?.speechProvider ?? "groq"}
            onChange={() => {}}
            disabled
          >
            <option value="groq">Groq · Whisper Large v3 Turbo</option>
          </Select>
        </Row>

        <Row
          label="Language"
          htmlFor="language"
          hint="Naming it is a little faster than detecting it."
        >
          <Select
            id="language"
            value={settings?.language ?? "en"}
            onChange={(next) => void save("language", next)}
          >
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Row>
      </Section>

      <Section title="Grammar cleanup">
        {/* §4 — measured, three times, with an explicit NEVER DELETE A WORD
            instruction. The model is not disobeying: Whisper's output is
            genuinely ungrammatical and making it coherent requires cutting
            something. This is a note, not a disabled toggle, because there is
            nothing behind it to switch on yet. */}
        <p className="py-4 text-[13px] text-ink-muted">
          Off. Running the transcript through an LLM to fix grammar deleted
          words in testing one word vanished from the same sentence every
          attempt. It returns as a setting once it can be trusted, and your raw
          transcript is always kept either way.
        </p>
      </Section>
    </div>
  );
}
