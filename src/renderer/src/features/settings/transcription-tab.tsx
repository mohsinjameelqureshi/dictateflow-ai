import { MOONSHINE_SIZES, MOONSHINE_MODELS, isMoonshineSize } from "@shared/types.js";
import { ModelCard } from "./model-card.js";
import { Row, Section, Select } from "./parts.js";
import type { SettingsStore } from "./use-settings.js";

/**
 * Whisper takes an ISO-639-1 code. Naming the language skips detection and is
 * slightly faster; auto-detect is kept for anyone who switches mid-day.
 *
 * This list belongs to Groq. The local engine is English-only and never reads
 * or writes `language`, which is exactly what makes switching engines lossless:
 * a user with Spanish selected still has Spanish when they switch back.
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
  const engine = settings?.speechProvider ?? "groq";
  const local = engine === "moonshine";

  const rawSize = settings?.moonshineModelSize ?? "medium";
  const size = isMoonshineSize(rawSize) ? rawSize : "medium";

  // Only warn when there is something to lose. A user already on English is
  // not being told anything by "this will transcribe in English".
  const groqLanguage = settings?.language ?? "en";
  const losingLanguage = local && groqLanguage !== "en" && groqLanguage !== "";

  return (
    <div className="flex flex-col gap-4">
      <Section title="Engine">
        <Row
          label="Transcribe with"
          htmlFor="provider"
          hint={
            local
              ? "Runs on this machine. No key, no account, and your audio never leaves the device."
              : "Fast and multilingual. Needs a free API key and a connection."
          }
        >
          <Select
            id="provider"
            value={engine}
            onChange={(next) => void save("speechProvider", next)}
          >
            <option value="groq">Groq · cloud, ~99 languages</option>
            <option value="moonshine">Moonshine · on this device, English</option>
          </Select>
        </Row>

        <Row
          label="Language"
          htmlFor="language"
          hint={
            local
              ? // §2.4.2 — disabled and visible, not removed. The user should
                // see WHY it cannot change.
                "Moonshine runs on-device and DictateFlow ships English only. Switch to Groq for other languages."
              : "Naming it is a little faster than detecting it."
          }
        >
          <Select
            id="language"
            value={local ? "en" : groqLanguage}
            onChange={(next) => void save("language", next)}
            disabled={local}
          >
            {local ? (
              <option value="en">English</option>
            ) : (
              LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))
            )}
          </Select>
        </Row>

        {losingLanguage && (
          <p className="border-b border-line-soft py-4 text-[13px] text-ink-muted last:border-0">
            Your Groq language is{" "}
            {LANGUAGES.find(([c]) => c === groqLanguage)?.[1] ?? groqLanguage}.
            Moonshine transcribes English until you switch back. The setting is
            kept, not overwritten.
          </p>
        )}
      </Section>

      {local && (
        <>
          <Section
            title="Local model"
            description="Downloaded once and kept in your profile, so an app update never re-fetches it."
          >
            <Row
              label="Size"
              htmlFor="model-size"
              hint="Bigger is more accurate and slower. Medium beats Whisper Large v3 at a sixth of the parameters."
            >
              <Select
                id="model-size"
                value={size}
                onChange={(next) => void save("moonshineModelSize", next)}
              >
                {MOONSHINE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {MOONSHINE_MODELS[s].label} · {MOONSHINE_MODELS[s].wer} errors
                  </option>
                ))}
              </Select>
            </Row>
          </Section>

          <ModelCard size={size} />
        </>
      )}

      {!local && (
        <Section title="Grammar cleanup">
          {/* §4 — measured, three times, with an explicit NEVER DELETE A WORD
              instruction. The model is not disobeying: Whisper's output is
              genuinely ungrammatical and making it coherent requires cutting
              something. It now exists as a toggle in Experimental, guarded by
              §10's detector, so this note points there rather than describing
              something that cannot be switched on. */}
          <p className="py-4 text-[13px] text-ink-muted">
            Off by default. An LLM pass that fixes grammar also deleted words in
            testing. One vanished from the same sentence every attempt, so it
            lives in Experimental, where a dropped word discards the whole
            result. Your raw transcript is kept either way.
          </p>
        </Section>
      )}
    </div>
  );
}
