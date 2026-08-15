import { Row, Section, Toggle } from "./parts.js";
import type { SettingsStore } from "./use-settings.js";

/**
 * Where a feature lives while it is still being judged.
 *
 * Everything here is off by default and everything here can change or leave.
 * The tab exists so that stays true of the rest of Settings — §9 keeps v1
 * narrow, and this is the pressure valve rather than an exception to it.
 */
export function ExperimentalTab({ settings, save }: SettingsStore) {
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Experimental"
        description="Unfinished ideas. They start off, and they can change or disappear between versions."
      >
        {/* §9 lists voice commands as deferred. This is the first one, and the
            only one that needs nothing but a suffix match on the transcript. */}
        <Row
          label="Press Enter command"
          hint="Automatically press Enter when you say 'press enter' at the end of a dictation. Those words are removed from the text that gets typed your raw transcript in History still has them."
        >
          <Toggle
            label="Press Enter command"
            checked={settings?.pressEnterCommand === "true"}
            onChange={(next) => void save("pressEnterCommand", String(next))}
          />
        </Row>

        {/* §4 — measured deleting a word from the same sentence on three runs,
            including with an explicit NEVER DELETE A WORD instruction. It ships
            here, off, with §10's detector as a hard gate: if a word goes
            missing the whole pass is thrown away and the raw transcript is
            used, so the worst case is that nothing happened. */}
        <Row
          label="Grammar cleanup"
          hint="Sends the transcript to Groq's Llama 3.3 for grammar and punctuation, adding about 300ms. If the model drops a word, which it did in testing, the result is discarded and your raw transcript is used instead. Needs a Groq API key and a connection, including when you transcribe with Moonshine."
        >
          <Toggle
            label="Grammar cleanup"
            checked={settings?.enhanceEnabled === "true"}
            onChange={(next) => void save("enhanceEnabled", String(next))}
          />
        </Row>
      </Section>
    </div>
  );
}
