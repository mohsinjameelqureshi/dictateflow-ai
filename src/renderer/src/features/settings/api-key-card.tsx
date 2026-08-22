import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  SECRETS,
  type ApiKeyStatus,
  type KeyCheck,
  type SecretId,
} from "@shared/types.js";

/**
 * One stored key. Groq for transcription and grammar cleanup, Gemini for
 * transforms — the card is the same either way, so it takes an id rather than
 * being written twice.
 *
 * The value is never read back into the renderer — `status()` returns whether
 * one exists, not what it is. Both are encrypted by the OS and neither appears
 * in an export (§2).
 *
 * **Save, then verify.** The card used to reject a key whose prefix did not
 * match a hardcoded string, and that check was wrong for Gemini — Google issues
 * `AQ.` keys as well as `AIza` ones, so a valid key was refused outright. Now
 * the key is stored on any plausible input and the PROVIDER is asked whether it
 * works. That ordering matters: a key entered offline is still saved, and
 * reported as unchecked rather than as rejected.
 */
export function ApiKeyCard({ id }: { id: SecretId }) {
  const spec = SECRETS[id];

  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [checking, setChecking] = useState(false);

  // Keyed on `id` so the card can be reused for the other secret without
  // showing the previous one's status for a frame.
  useEffect(() => {
    let live = true;
    setStatus(null);
    setDraft("");
    setError(null);
    setCheck(null);
    void window.dictateflow.apiKey.status(id).then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const verify = async () => {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await window.dictateflow.apiKey.verify(id));
    } catch {
      // The bridge itself failed, which is not the provider's verdict on the
      // key. Say nothing rather than blame the credential.
      setCheck(null);
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setCheck(null);
    try {
      setStatus(await window.dictateflow.apiKey.set(id, draft));
      setDraft("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      await verify();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setError(null);
    setCheck(null);
    setStatus(await window.dictateflow.apiKey.clear(id));
  };

  return (
    <section className="rounded-panel border border-line bg-panel p-5">
      <h2 className="text-sm font-medium text-ink">{spec.label}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Encrypted by Windows and stored on this machine only. Get one free at{" "}
        {spec.console}.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) void save();
          }}
          placeholder={
            status?.present
              ? "A key is saved — enter a new one to replace it"
              : spec.hint
          }
          aria-label={spec.label}
          autoComplete="off"
          spellCheck={false}
          className="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-ink-subtle focus-visible:border-accent"
        />
        <Button onClick={() => void save()} disabled={!draft.trim() || saving}>
          {justSaved ? "Saved" : "Save"}
        </Button>
        {status?.present && (
          <Button variant="secondary" onClick={() => void clear()}>
            Remove
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={14} className="shrink-0" />
          {error}
        </p>
      )}

      {status && !status.encryptionAvailable && (
        <p className="mt-3 flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={14} className="shrink-0" />
          Windows encryption is unavailable, so the key cannot be stored safely.
        </p>
      )}

      {status?.present && !error && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            {checking ? (
              <>
                <Loader2 size={14} className="shrink-0 animate-spin text-ink-subtle" />
                Checking the key with {spec.console.split("/")[0]}…
              </>
            ) : check?.state === "ok" ? (
              <>
                <Check size={14} className="shrink-0 text-success" />
                Key saved and working.
              </>
            ) : check?.state === "rejected" ? (
              // The provider's verdict, not ours. This is the message the old
              // prefix check was trying to produce, from the only source that
              // can actually produce it.
              <span className="flex items-center gap-2 text-danger">
                <TriangleAlert size={14} className="shrink-0" />
                {check.problem}
              </span>
            ) : check?.state === "unreachable" ? (
              <>
                <ShieldCheck size={14} className="shrink-0 text-ink-subtle" />
                {check.problem}
              </>
            ) : (
              <>
                <ShieldCheck size={14} className="shrink-0 text-success" />
                Key saved.
              </>
            )}
          </p>

          {!checking && (
            <Button size="sm" variant="ghost" onClick={() => void verify()}>
              {check ? "Check again" : "Check it works"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
