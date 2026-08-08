import { useEffect, useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import type { ApiKeyStatus } from "@shared/types.js";

/**
 * The Groq key. It is the only secret in the app (§2) and the only thing
 * standing between a fresh install and a working dictation, which is why it
 * lands in Phase 2 rather than waiting for the rest of Settings in Phase 5.
 *
 * The value is never read back into the renderer — `status()` returns whether
 * one exists, not what it is.
 */
export function ApiKeyCard() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    void window.typeflow.apiKey.status().then(setStatus);
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setStatus(await window.typeflow.apiKey.set(draft));
      setDraft("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setError(null);
    setStatus(await window.typeflow.apiKey.clear());
  };

  return (
    <section className="rounded-panel border border-line bg-panel p-5">
      <h2 className="text-sm font-medium text-ink">Groq API key</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Encrypted by Windows and stored on this machine only. Get one free at
        console.groq.com.
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
              ? "A key is saved enter a new one to replace it"
              : "gsk_…"
          }
          aria-label="Groq API key"
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
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          {justSaved ? (
            <Check size={14} className="shrink-0 text-success" />
          ) : (
            <ShieldCheck size={14} className="shrink-0 text-success" />
          )}
          Key saved.
        </p>
      )}
    </section>
  );
}
